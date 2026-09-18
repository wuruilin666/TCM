/* ===================== 稳定性回归测试（第一阶段修复） =====================
 * 运行： node tests/stability.test.mjs
 *
 * 覆盖四类防御性修复，防止异常输入造成资源消耗或状态不一致：
 *   1. TCM1P 分段备份 total 上限（超大 total 不再触发超大循环）
 *   2. gzip 解压后端字节数上限（压缩炸弹拦截）
 *   3. 已完成病例记录达到上限后，新完成记录不被永久截掉（保留最新 1000 条）
 *   4. viewAnswer 后已完成病例不再残留闯关队列（该点在 jsdom 全链路回归中验证）
 *
 * 本文件为纯逻辑 + 便携 localStorage，不依赖 jsdom / DOM。
 * ================================================================ */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const backupService = await import(pathToFileURL(join(ROOT, 'js/storage/backup-service.js')).href);
const backupCode = await import(pathToFileURL(join(ROOT, 'js/storage/backup-code.js')).href);
const progressStore = await import(pathToFileURL(join(ROOT, 'js/storage/progress-storage.js')).href);
const { MAX_DECOMPRESSED_BYTES, MAX_BACKUP_PARTS, gunzipBytes, encodeProgressCode, splitProgressCode } = backupCode;

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; failures.push(name + (detail ? '  → ' + detail : '')); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}

/* 本地便携 localStorage（不引入 jsdom，够 progress-storage 用即可） */
const memStore = new Map();
globalThis.localStorage = {
    getItem: k => (memStore.has(k) ? memStore.get(k) : null),
    setItem: (k, v) => memStore.set(k, String(v)),
    removeItem: k => memStore.delete(k),
    clear: () => memStore.clear()
};
// Node 22 已全局提供 CompressionStream / DecompressionStream，测试端直接可用。

/* 生成 P 个合法且唯一的 SAFE_CASE_ID（前缀用双射 base26，数字后缀固定） */
const L = 'abcdefghijklmnopqrstuvwxyz';
function safeId(i) {
    let s = '', n = i;
    do { s = L[n % 26] + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s + '-' + String(i % 1000).padStart(3, '0');
}

console.log('\n=== 1. TCM1P 分段备份 total 上限 ===\n');
{
    const r = await backupService.parseProgressBackupCode('TCM1P:999999999:1:xxxx');
    check('TCM1P:999999999:1:xxxx → ok=false（快速拒绝，不进入大循环）', r.ok === false && !!r.error, JSON.stringify(r).slice(0, 120));
    const r0 = await backupService.parseProgressBackupCode('TCM1P:0:1:abc');
    check('total 为 0 被拒绝', r0.ok === false, JSON.stringify(r0).slice(0, 120));
    const rNeg = await backupService.parseProgressBackupCode(`TCM1P:${MAX_BACKUP_PARTS + 1}:1:abc`);
    check(`total 超过 MAX_BACKUP_PARTS(${MAX_BACKUP_PARTS}) 被拒绝`, rNeg.ok === false, JSON.stringify(rNeg).slice(0, 120));
    const rOver = await backupService.parseProgressBackupCode('TCM1P:99999999999999999999:1:abc');
    check('超大 total（超出安全整数）被拒绝', rOver.ok === false, JSON.stringify(rOver).slice(0, 120));
    const rPartOver = await backupService.parseProgressBackupCode('TCM1P:5:9:abc');
    check('partNumber > total（在合法范围内）被拒绝', rPartOver.ok === false, JSON.stringify(rPartOver).slice(0, 120));

    // 正常分段备份仍可恢复（不破坏既有协议）。
    // 纯重复文本 gzip 会压到几乎为零，必须用“有差异”的内容才能让解压后的正文超过单段上限，
    // 因此用一个确定性伪随机中文串（不依赖 Math.random，保证测试可复现）构造多条错题。
    function pseudoChinese(len, salt) {
        let s = '';
        for (let k = 0; k < len; k++) s += String.fromCharCode(0x4E00 + ((k * 167031 + salt * 9973) % (0x9FA5 - 0x4E00)));
        return s;
    }
    const multiWrong = Array.from({ length: 8 }, (_, i) => ({
        id: safeId(i), difficulty: 'basic', date: '2026-01-01T00:00:00.000Z',
        title: 't', chiefComplaint: 'c', syndrome: 's', disease: 'd',
        basis: pseudoChinese(900, i + 1)
    }));
    const multiPayload = {
        app: 'TCM', type: 'learning-progress', version: 1,
        exportedAt: '2026-01-01T00:00:00.000Z',
        completedCases: ['basic-001'], wrongCases: multiWrong
    };
    const checksum = await backupService.computeChecksum(backupService.canonizePayload(multiPayload));
    const parts = splitProgressCode(await encodeProgressCode(multiPayload, checksum));
    check('长备份自动分段（parts 数量 > 1）', parts.parts.length > 1, `${parts.parts.length} 段`);
    const parsedParts = await backupService.parseProgressBackupCode(parts.parts.join('\n'));
    check('分段备份仍可拼接恢复', parsedParts.ok === true, JSON.stringify(parsedParts).slice(0, 120));
}

console.log('\n=== 2. gzip 解压后端字节数上限 ===\n');
{
    // 本地压缩辅助：text → gzip 字节
    async function gzip(bytes, type = 'gzip') {
        const cs = new CompressionStream(type);
        const w = cs.writable.getWriter();
        const wc = w.write(bytes).then(() => w.close()).catch(() => {});
        const ab = await new Response(cs.readable).arrayBuffer();
        await wc.catch(() => {});
        return new Uint8Array(ab);
    }

    // 控制组：正常小数据可解压还原
    const src = new TextEncoder().encode('正常备份内容'.repeat(200));
    const back = await gunzipBytes(await gzip(src));
    check('正常小数据可解压且字节数一致', back.length === src.length, `${back.length} vs ${src.length}`);

    // 压缩炸弹：5MB 全零 → gzip 后极小，但解压会超过上限 → 必须在累计超限时立即拒绝
    const bomb = new Uint8Array(MAX_DECOMPRESSED_BYTES + 2048);
    const gzBomb = await gzip(bomb);
    check('高压压缩率输入（解压 > 上限）确实很小',
        gzBomb.length < MAX_DECOMPRESSED_BYTES / 100, `gzip 后 ${gzBomb.length} 字节`);
    let bombRejected = false;
    await gunzipBytes(gzBomb).catch(() => { bombRejected = true; });
    check('解压超过 MAX_DECOMPRESSED_BYTES 立即拒绝（不卡死）', bombRejected === true);

    // 端到端：构造解压后 > 上限的备份码，经 parseProgressBackupCode 应返回 ok=false
    const bigBasis = '据'.repeat(4500); // 4500×3B(UTF-8) ≈ 13500B/条
    const wrongCases = Array.from({ length: 500 }, (_, i) => ({
        id: safeId(i), difficulty: 'basic', date: '2026-01-01T00:00:00.000Z',
        title: 't', chiefComplaint: 'c', syndrome: 's', disease: 'd', basis: bigBasis
    }));
    const bigPayload = {
        app: 'TCM', type: 'learning-progress', version: 1,
        exportedAt: '2026-01-01T00:00:00.000Z',
        completedCases: ['basic-001'], wrongCases
    };
    const bigChecksum = await backupService.computeChecksum(backupService.canonizePayload(bigPayload));
    const bigCode = await encodeProgressCode(bigPayload, bigChecksum);
    const bigRes = await backupService.parseProgressBackupCode(bigCode);
    check('解压后超限的备份码 → ok=false', bigRes.ok === false, JSON.stringify(bigRes).slice(0, 120));
    check('超限错误为结构化错误（不抛未捕获异常）', bigRes.ok === false && typeof bigRes.error === 'string',
        JSON.stringify(bigRes).slice(0, 120));
}

console.log('\n=== 3. 已完成病例上限：新记录不被永久截掉 ===\n');
{
    // 造出 1100 条合法唯一已完成记录，置入本地存储
    const ids = Array.from({ length: 1100 }, (_, i) => safeId(i));
    progressStore.replaceProgress({ completedCases: ids, wrongCases: [] });

    const got = progressStore.getCompletedCases();
    check('记录达到上限后被压缩为 1000 条', got.length === 1000, `${got.length}`);
    check('保留的是「最新」的 1000 条（最旧的一条被淘汰）', !got.includes(ids[0]), `ids[0]=${ids[0]}`);
    check('最新一条仍在其中', got.includes(ids[1099]), JSON.stringify(got.slice(-3)));
    check('去重后仍为最新 1000 条', [...new Set(got)].length === 1000);

    // 关键回归：此时再完成一个新病例，不得被 1000 上限永久丢掉
    progressStore.markCaseCompleted('zzz-500');
    const after = progressStore.getCompletedCases();
    check('新完成记录仍被写入且在下一次读取中保留', after.includes('zzz-500'),
        JSON.stringify(after.slice(-3)));
    check('写入新记录后总数仍被限制在 1000', after.length === 1000, `${after.length}`);
}

console.log('\n=== 结果 ===');
console.log(`通过 ${pass}，失败 ${fail}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
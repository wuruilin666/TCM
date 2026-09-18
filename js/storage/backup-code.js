/* ===================== 备份码编解码（纯逻辑，无 DOM / 无 Storage / 无游戏状态） =====================
 * 职责：
 *   - 备份数据 → gzip 压缩 → Base64URL → TCM1: 前缀
 *   - 超长时切分为 TCM1P: 分段码
 *   - 备份码解析：分段识别 → Base64URL 解码 → gzip 解压 → JSON → checksum 完整性校验
 *   - 传输损坏诊断（仅输出元数据，不泄露备份码内容）
 *
 * 禁止：
 *   - 修改 game state
 *   - 修改页面 / 控制 modal / alert
 *   - 读写 localStorage
 *
 * checksum 计算复用的规范序列化函数由调用方注入，避免本模块依赖备份数据结构。
 * ================================================================================== */

const BACKUP_PREFIX = 'TCM1:';
const BACKUP_PREFIX_V2 = 'TCM2:'; // 仅用于识别旧版备份码并提示，不再生成
const BACKUP_PARTS_PREFIX = 'TCM1P:'; // 分段备份前缀（TCM1 Parts），仅在单条 TCM1 超长时自动生成
const BACKUP_SEGMENT_SIZE = 1500; // 每段 Base64URL 正文长度，明显低于聊天软件常见文本上限，留足余量
const MAX_BACKUP_CODE_LEN = 6000000;

// 备份码长度分级（按字符数，用于提示聊天软件截断风险，不阻止复制）
const LEN_OK = 1800;     // <= 1800：直接复制，无额外提示
const LEN_WARN = 2048;   // 1800~2048：提示聊天长度限制；> 2048：重点提示
const PARTS_FILE_RECOMMEND = 5;          // >=5 段：主动推荐“保存备份文件”
const PARTS_FILE_STRONGLY_RECOMMEND = 10; // >=10 段：明显推荐“保存备份文件”

export { LEN_OK, LEN_WARN, PARTS_FILE_RECOMMEND, PARTS_FILE_STRONGLY_RECOMMEND, BACKUP_PREFIX };

/* ===================== 错误文案 ===================== */
const MSG_FORMAT = '这不是有效的学习进度备份码。\n请检查是否复制了完整的备份码。';
const MSG_MODIFIED = '备份码内容不完整或已被修改。\n请重新复制完整的备份码，或使用「保存备份文件」进行恢复。';
const MSG_LEGACY = '该备份码属于旧版格式，当前版本不再支持直接读取。\n请在生成它的旧版网站中恢复后，重新「备份」生成新的备份码；也可以尝试使用原来的备份文件恢复。';
const MSG_TRUNCATED = '备份码可能在传输过程中被截断。\n请重新复制完整的备份码，\n或使用「保存备份文件」进行恢复。';
const MSG_PARTS_MISSING = '分段备份不完整，缺少第 {n} 段。\n请复制全部备份分段后再恢复。';
const MSG_PARTS_DUPLICATE = '分段备份存在重复段，请重新复制完整备份码。';
const MSG_PARTS_INCONSISTENT = '分段备份不一致，请重新复制完整备份码。';

/* ===================== Base64URL ===================== */
function utf8ToBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 二进制 ↔ Base64URL（分块处理，避免大数组一次性 fromCharCode 导致栈溢出）
function bytesToBase64Url(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

/* ===================== gzip（浏览器原生，无依赖） ===================== */
// 不支持或失败时：gzipBytes 返回 null（调用方退回旧非压缩格式）；gunzipBytes 抛错（调用方按损坏处理）。
async function gzipBytes(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
        const cs = new CompressionStream('gzip');
        const writer = cs.writable.getWriter();
        const writeChain = writer.write(bytes).then(() => writer.close()).catch(() => {});
        const ab = await new Response(cs.readable).arrayBuffer().catch(() => null);
        await writeChain.catch(() => {});
        if (!ab) return null;
        return new Uint8Array(ab);
    } catch (e) { return null; }
}

async function gunzipBytes(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream unsupported');
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    // 显式接住写端 promise，避免可读流报错导致的未处理 rejection
    const writeChain = writer.write(bytes).then(() => writer.close()).catch(() => {});
    let ab;
    try {
        ab = await new Response(ds.readable).arrayBuffer();
    } catch (e) {
        await writeChain.catch(() => {});
        throw new Error('gunzip failed');
    }
    await writeChain.catch(() => {});
    return new Uint8Array(ab);
}

/* ===================== 输入规范化 ===================== */
// 清理聊天软件可能附带的无害格式字符（BOM / 零宽 / 换行 / 制表 / 空格）；不修改任何有效载荷字符
function normalizeBackupInput(raw) {
    return String(raw)
        .replace(/[\uFEFF\u200B\u200C\u200D\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
        .replace(/[\r\n\t\f\v]+/g, '')
        .replace(/ +/g, '')
        .trim();
}
// 仅清除“不可见”字符（BOM / 零宽 / 双向控制），保留换行与空格——
// 换行/空格在分段备份里是段与段之间的分隔，或聊天软件夹在正文中的无害字符，需后续按段解析时再处理。
function stripInvisible(text) {
    return String(text).replace(/[\uFEFF\u200B\u200C\u200D\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
}
// 在文本中找出所有 TCM1: / TCM1P: 候选段：从每个前缀开始，取到下一个前缀之前（或文本末尾）。
// 这样无论分段之间是换行还是被聊天软件替换成的空格，都能正确切分；正文里夹杂的空格/换行会在后续清洗中去除。
function extractCandidates(text) {
    const prefixes = [BACKUP_PREFIX, BACKUP_PARTS_PREFIX];
    const positions = [];
    for (const p of prefixes) {
        let idx = text.indexOf(p);
        while (idx >= 0) { positions.push({ idx, prefix: p }); idx = text.indexOf(p, idx + 1); }
    }
    positions.sort((a, b) => a.idx - b.idx);
    const cands = [];
    for (let i = 0; i < positions.length; i++) {
        const start = positions[i].idx + positions[i].prefix.length;
        const end = (i + 1 < positions.length) ? positions[i + 1].idx : text.length;
        cands.push({ prefix: positions[i].prefix, content: text.slice(start, end) });
    }
    return cands;
}

/* ===================== 诊断状态（仅内存，不写 localStorage、不上传服务器） ===================== */
let lastGeneratedBackupCode = '';        // 本次复制的备份码原文（仅用于同设备对比，不持久化）
let lastRestoreDiag = null;              // 最近一次恢复诊断（安全，不含备份码内容）

export function getLastGeneratedBackupCode() { return lastGeneratedBackupCode; }
export function getLastRestoreDiag() { return lastRestoreDiag; }

/* ===================== SHA-256 / 历史 FNV checksum =====================
 * 说明：
 *   - sha256Hex 永远返回标准 SHA-256 的 64 位小写十六进制；
 *   - 优先使用 crypto.subtle（原生、快），不可用或调用失败时回退到纯 JS 实现，
 *     确保 https / http / file:// 等所有环境生成与校验一致；
 *   - 不再把 FNV-1a 作为新备份码的生成算法。
 * 输入统一经 TextEncoder() 得到 UTF-8 字节；产出不含学习内容，可安全用于诊断摘要。
 * ====================================================================== */
const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

// 纯 JS SHA-256：输入为 UTF-8 字节数组，返回 64 位小写十六进制（与标准实现完全一致）
function sha256BytesToHex(bytes) {
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const ml = bytes.length;
    const bitLen = ml * 8;
    // 填充：1 字节 0x80 + 8 字节长度（64 位大端），总长对齐到 64 字节块
    const paddedLen = (Math.ceil((ml + 1 + 8) / 64)) * 64;
    const msg = new Uint8Array(paddedLen);
    msg.set(bytes, 0);
    msg[ml] = 0x80;
    const dv = new DataView(msg.buffer);
    dv.setUint32(paddedLen - 8, Math.floor(bitLen / 4294967296));
    dv.setUint32(paddedLen - 4, bitLen >>> 0);

    const w = new Uint32Array(64);
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < paddedLen; i += 64) {
        for (let j = 0; j < 16; j++) {
            w[j] = (msg[i + j * 4] << 24) | (msg[i + j * 4 + 1] << 16) | (msg[i + j * 4 + 2] << 8) | (msg[i + j * 4 + 3]);
        }
        for (let j = 16; j < 64; j++) {
            const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
            const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
            w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
        }
        let A = a, B = b, C = c, D = d, E = e, F = f, G = g, T = h;
        for (let j = 0; j < 64; j++) {
            const S1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
            const ch = (E & F) ^ (~E & G);
            const t1 = (T + S1 + ch + SHA256_K[j] + w[j]) >>> 0;
            const S0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
            const maj = (A & B) ^ (A & C) ^ (B & C);
            const t2 = (S0 + maj) >>> 0;
            T = G; G = F; F = E; E = (D + t1) >>> 0; D = C; C = B; B = A;
            A = (t1 + t2) >>> 0;
        }
        a = (a + A) >>> 0; b = (b + B) >>> 0; c = (c + C) >>> 0; d = (d + D) >>> 0;
        e = (e + E) >>> 0; f = (f + F) >>> 0; g = (g + G) >>> 0; h = (h + T) >>> 0;
    }
    return [a, b, c, d, e, f, g, h].map(v => v.toString(16).padStart(8, '0')).join('');
}

// 对字符串做 SHA-256（64 位小写 hex）：优先 crypto.subtle，失败/不可用则纯 JS 兜底
export async function sha256Hex(str) {
    const bytes = new TextEncoder().encode(String(str));
    try {
        if (globalThis.crypto && globalThis.crypto.subtle && globalThis.crypto.subtle.digest) {
            const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch (e) { /* 回退纯 JS */ }
    return sha256BytesToHex(bytes);
}

// 历史兼容：旧版 8 位 FNV-1a 32 位 checksum（仅供旧备份码恢复校验，不再用于生成新码）
export function fnv1aHex(str) {
    const bytes = new TextEncoder().encode(String(str));
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

// 统一校验：生成端永远产出 64 位 SHA-256，恢复端按期望长度选择算法，跨环境一致。
// 64 位十六进制 → SHA-256；8 位十六进制 → 历史 FNV-1a；其他长度/格式 → 失败。
export async function verifyChecksum(expected, canonicalJson) {
    const exp = String(expected || '');
    if (!/^[0-9a-fA-F]+$/.test(exp)) return false;
    if (exp.length === 8) return fnv1aHex(canonicalJson) === exp.toLowerCase();
    if (exp.length === 64) return (await sha256Hex(canonicalJson)).toLowerCase() === exp.toLowerCase();
    return false;
}

// 字符类别（不输出字符本身，只输出类别，避免泄露备份码）
function diffCategory(ch) {
    if (/[A-Z]/.test(ch)) return 'uppercase';
    if (/[a-z]/.test(ch)) return 'lowercase';
    if (/[0-9]/.test(ch)) return 'digit';
    if (ch === '-') return '-';
    if (ch === '_') return '_';
    return 'other';
}

// 同设备诊断：比较原始码与粘贴码的“第一处差异”，只输出位置与类别
export function diagnoseFirstDiff(orig, pasted) {
    const a = orig || '', b = pasted || '';
    const minLen = Math.min(a.length, b.length);
    let diffPos = -1;
    for (let i = 0; i < minLen; i++) {
        if (a[i] !== b[i]) { diffPos = i; break; }
    }
    if (diffPos < 0) diffPos = minLen; // 共同长度内无差异 -> 差异在结尾（截断/追加）
    return {
        originalLength: a.length,
        pastedLength: b.length,
        firstDiffPos: diffPos,
        originalCharCat: diffPos < a.length ? diffCategory(a[diffPos]) : '(none)',
        pastedCharCat: diffPos < b.length ? diffCategory(b[diffPos]) : '(none)'
    };
}

// 安全诊断：仅输出元数据（长度 / 前缀位置 / 是否存在非 Base64URL 字符 / 各阶段成败 / checksum 前 8 位），
// 绝不输出完整备份码、完整 JSON 或学习记录内容。
function debugBackup(stage, raw, normalized, extra) {
    extra = extra || {};
    const rawStr = typeof raw === 'string' ? raw : '';
    const normStr = typeof normalized === 'string' ? normalized : '';
    const prefixIndex = normStr.indexOf(BACKUP_PREFIX);
    const body = typeof extra.body === 'string' ? extra.body
        : (prefixIndex >= 0 ? normStr.slice(prefixIndex + BACKUP_PREFIX.length) : '');
    const cleanBody = typeof extra.cleanBody === 'string' ? extra.cleanBody : body.replace(/[^A-Za-z0-9_-]/g, '');
    const metrics = {
        stage,
        rawLength: rawStr.length,
        normalizedLength: normStr.length,
        prefixFound: prefixIndex >= 0,
        prefixIndex: prefixIndex < 0 ? null : prefixIndex,
        bodyLength: body.length,
        cleanBodyLength: cleanBody.length,
        nonBase64Chars: Math.max(0, body.length - cleanBody.length),
        base64LengthChanged: (typeof extra.expectedBase64Len === 'number') ? (cleanBody.length !== extra.expectedBase64Len) : null,
        decodeOk: extra.decodeOk,
        jsonOk: extra.jsonOk,
        validateOk: extra.validateOk,
        checksumMatch: extra.checksumMatch,
        note: extra.note || ''
    };
    if (extra.expect) metrics.checksumExpected = String(extra.expect).slice(0, 8) + '…';
    if (extra.actual) metrics.checksumActual = String(extra.actual).slice(0, 8) + '…';
    console.log('[TCM Backup Debug]', JSON.stringify(metrics));
}

/* ===================== 生成 ===================== */
// 生成当前进度的备份码（统一数据源：与备份文件同一份 payload）。
// 流程：JSON → 计算 checksum → UTF-8 → gzip 压缩 → Base64URL → TCM1:
// 不支持 gzip 或压缩后并未更短时，退回旧的非压缩 TCM1（UTF-8 → Base64URL），保证兼容与尽量短。
export async function encodeProgressCode(payload, checksum) {
    const withChecksum = { ...payload, checksum };
    const jsonStr = JSON.stringify(withChecksum);
    const bytes = new TextEncoder().encode(jsonStr);
    const gz = await gzipBytes(bytes);
    const compB64 = gz ? bytesToBase64Url(gz) : null;
    const rawB64 = utf8ToBase64Url(jsonStr);
    // 选择更短的输出：压缩不一定更短（极小数据可能原样更短），但都能被新解析器恢复
    return BACKUP_PREFIX + (compB64 && compB64.length <= rawB64.length ? compB64 : rawB64);
}

// 生成备份码，并视长度自动决定是否分段。
// 返回 { code, parts }：
//   code  —— 单条 TCM1（始终存在，供兼容/兜底显示）
//   parts —— 数组；若单条长度 <= 安全长度，则 parts=[code]（等同于单码）；
//            若超过安全长度，则自动切成多条 TCM1P 分段（每段独立、均低于聊天软件上限）。
// 注意：先生成“完整”的 TCM1（JSON→checksum→gzip→Base64URL），再对最终 Base64URL 做切分；
//       绝不逐段单独压缩，保证恢复时拼接后整体校验 checksum。
export function splitProgressCode(single) {
    const body = single.slice(BACKUP_PREFIX.length);
    if (single.length <= LEN_OK) {
        return { code: single, parts: [single] };
    }
    const total = Math.ceil(body.length / BACKUP_SEGMENT_SIZE);
    const parts = [];
    for (let i = 0; i < total; i++) {
        const frag = body.slice(i * BACKUP_SEGMENT_SIZE, (i + 1) * BACKUP_SEGMENT_SIZE);
        parts.push(BACKUP_PARTS_PREFIX + total + ':' + (i + 1) + ':' + frag);
    }
    return { code: single, parts };
}

// 备份码 UTF-8 字节大小（用于提示，而非硬性限制）
export function getBackupCodeBytes(code) {
    return new TextEncoder().encode(code).length;
}

// 根据备份码字符长度给出提示等级，供 UI 决定展示哪种文案（本模块不产出 HTML）。
export function getBackupSizeLevel(code) {
    const n = code ? code.length : 0;
    if (n <= LEN_OK) return 'ok';
    if (n <= LEN_WARN) return 'warn';
    return 'danger';
}

export function rememberGeneratedCode(code) { lastGeneratedBackupCode = code; }

/* ===================== 解析 ===================== */
// 聊天工具常见的“整条消息长度上限”参考值（不写死唯一值，未来不同平台/版本可能不同）
const TRUNC_LIMITS = [1024, 1400, 1536, 1800, 2000, 2048, 4096, 8192, 16000];
function nearTruncationLimit(len) {
    return typeof len === 'number' && TRUNC_LIMITS.some(L => Math.abs(len - L) <= 12);
}

// 解析并校验备份码，返回 { ok, data?, error?, kind? }
// kind: format(非备份码) / modified(内容被改或损坏/分段异常) / legacy(旧版TCM2) / version(高版本)
// 同时支持普通单条 TCM1 与分段 TCM1P（多条一次性粘贴，自动识别并拼接）。
//
// validatePayload: 由调用方（Backup Service）注入的数据结构校验函数，避免本模块依赖备份数据契约。
// config: { currentVersion, canonize, computeChecksum }
export async function decodeProgressCode(raw, validatePayload, config) {
    const { currentVersion, canonize, computeChecksum } = config;
    // “宽容输入、严格验真”：先按前缀找出所有候选段，再逐阶段校验。每步写入安全诊断（不含备份码/学习数据）。
    const diag = {
        prefixFound: false, rawLength: 0, normalizedLength: 0, base64Length: 0,
        decodeOk: null, jsonOk: null, validateOk: null, checksumOk: null, stage: '', kind: ''
    };
    const fail = (stage) => { diag.stage = stage; lastRestoreDiag = diag; };

    if (typeof raw !== 'string') {
        diag.kind = 'format'; fail('type-error');
        debugBackup('type-error', raw, '');
        return { ok: false, error: MSG_FORMAT, kind: 'format' };
    }
    // 仅去除不可见字符；换行/空格保留（分段分隔或正文无害夹杂），交给候选提取与按段清洗处理
    const stripped = stripInvisible(raw);
    diag.rawLength = raw.length;
    diag.normalizedLength = stripped.length;
    // 同设备参考：若本会话复制过备份码，可用其长度做变化比对（跨设备通常无此值）
    const expectedBase64Len = (lastGeneratedBackupCode && lastGeneratedBackupCode.indexOf(BACKUP_PREFIX) === 0)
        ? lastGeneratedBackupCode.length - BACKUP_PREFIX.length : undefined;
    debugBackup('normalized', raw, stripped, { expectedBase64Len });
    if (stripped.length > MAX_BACKUP_CODE_LEN) {
        diag.kind = 'format'; fail('too-long');
        debugBackup('too-long', raw, stripped);
        return { ok: false, error: MSG_FORMAT, kind: 'format' };
    }
    // 旧版 TCM2（gzip）已停用，给出明确提示，不尝试解压
    if (stripped.indexOf(BACKUP_PREFIX_V2) === 0) {
        diag.kind = 'legacy'; fail('legacy');
        debugBackup('legacy', raw, stripped);
        return { ok: false, error: MSG_LEGACY, kind: 'legacy' };
    }
    // 找出所有 TCM1: / TCM1P: 候选段
    const cands = extractCandidates(stripped);
    if (cands.length === 0) {
        diag.kind = 'format'; fail('prefix-not-found');
        debugBackup('prefix-not-found', raw, stripped);
        return { ok: false, error: MSG_FORMAT, kind: 'format' };
    }
    // 含 TCM1P 候选 → 走分段解析；否则按普通单条 TCM1 处理第一个候选
    const hasParts = cands.some(c => c.prefix === BACKUP_PARTS_PREFIX);
    if (hasParts) {
        return await parseParts(cands, raw, stripped, diag, fail, validatePayload, config);
    }
    diag.prefixFound = true;
    const cand = cands[0];
    const cleanBody = cand.content.replace(/[^A-Za-z0-9_-]/g, '');
    diag.base64Length = cleanBody.length;
    debugBackup('extracted', raw, stripped, { body: cand.content, cleanBody, expectedBase64Len });
    if (!cleanBody) {
        diag.kind = 'modified'; fail('empty-body');
        debugBackup('empty-body', raw, stripped, { body: cand.content, cleanBody });
        return { ok: false, error: MSG_MODIFIED, kind: 'modified' };
    }
    return await decodeAndVerify(cleanBody, raw, stripped, cand.content, diag, fail, validatePayload, config);
}

// 单条 TCM1 正文（已清洗的 Base64URL）的解码与校验：gzip 识别 → JSON → 版本 → 结构 → checksum
async function decodeAndVerify(cleanBody, raw, stripped, bodyForDiag, diag, fail, validatePayload, config) {
    const { currentVersion, canonize, computeChecksum } = config;
    let bytes;
    try { bytes = base64UrlToBytes(cleanBody); diag.decodeOk = true; }
    catch (e) {
        diag.kind = 'modified'; diag.decodeOk = false; fail('decode-fail');
        debugBackup('decode-fail', raw, stripped, { body: bodyForDiag, cleanBody, note: 'Base64URL 解码失败，可能发生截断/字符损坏' });
        return { ok: false, error: MSG_MODIFIED, kind: 'modified' };
    }
    // gzip 识别：魔术字节 0x1f 0x8b → 解压得 JSON；否则按旧版非压缩 TCM1（UTF-8 JSON）处理。
    // gzip 魔术字节已命中却解压失败，视为损坏（不会误当旧版）。
    let jsonStr;
    const looksGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (looksGzip) {
        try {
            jsonStr = new TextDecoder().decode(await gunzipBytes(bytes));
            debugBackup('gunzip', raw, stripped, { body: bodyForDiag, cleanBody, note: 'gzip 解压成功' });
        } catch (e) {
            diag.kind = 'modified'; fail('gunzip-fail');
            debugBackup('gunzip-fail', raw, stripped, { body: bodyForDiag, cleanBody, note: 'gzip 解压失败' });
            return { ok: false, error: MSG_MODIFIED, kind: 'modified' };
        }
    } else {
        jsonStr = new TextDecoder().decode(bytes); // 旧版非压缩 TCM1
    }
    // JSON 解析
    let parsed;
    try { parsed = JSON.parse(jsonStr); diag.jsonOk = true; }
    catch (e) {
        diag.kind = 'modified'; diag.jsonOk = false; fail('json-fail');
        const truncated = nearTruncationLimit(raw.length);
        const note = truncated
            ? '可能被聊天工具截断（Base64URL 可解码但 JSON 解析失败）'
            : 'Base64URL 可解码但 JSON 解析失败';
        debugBackup('json-fail', raw, stripped, { body: bodyForDiag, cleanBody, note });
        return { ok: false, error: truncated ? MSG_TRUNCATED : MSG_MODIFIED, kind: 'modified' };
    }
    // 版本检查（高版本备份不应误判为“损坏”）
    if (parsed && typeof parsed.version === 'number' && parsed.version > currentVersion) {
        diag.stage = 'version'; diag.kind = 'version'; lastRestoreDiag = diag;
        return { ok: false, error: '这个备份来自更新版本的网站，当前版本暂时无法读取。请先更新网站后再尝试恢复。', kind: 'version' };
    }
    // 数据结构校验
    const res = validatePayload(parsed);
    if (!res.ok) {
        diag.kind = 'modified'; diag.validateOk = false; fail('validate-fail');
        debugBackup('validate-fail', raw, stripped, { body: bodyForDiag, cleanBody, note: '数据结构校验失败' });
        return { ok: false, error: MSG_MODIFIED, kind: 'modified' };
    }
    diag.validateOk = true;
    // checksum 完整性校验（旧备份无 checksum 时跳过，仅做结构校验，保持兼容）。
    // checksum 是判断“微信等传输是否真正改变了有效载荷”的最终保险，绝不跳过、绝不猜测。
    if (typeof parsed.checksum === 'string') {
        let verified = false;
        let checksumError = false;
        let actual = '';
        try {
            // 统一校验：SHA-256（64 位）/ 历史 FNV-1a（8 位）由 verifyChecksum 按长度选择，
            // 不再依赖当前环境是否支持 crypto.subtle，跨环境结果一致。
            actual = await sha256Hex(canonize(parsed));
            verified = await verifyChecksum(parsed.checksum, canonize(parsed));
        } catch (e) {
            checksumError = true;
        }
        if (checksumError) {
            diag.kind = 'modified'; diag.checksumOk = false; fail('checksum-error');
            debugBackup('checksum-error', raw, stripped, { body: bodyForDiag, cleanBody, expect: parsed.checksum, note: 'checksum 计算失败' });
            return { ok: false, error: MSG_MODIFIED, kind: 'modified' };
        }
        if (!verified) {
            diag.kind = 'modified'; diag.checksumOk = false; fail('checksum-mismatch');
            debugBackup('checksum-mismatch', raw, stripped, { body: bodyForDiag, cleanBody, expect: parsed.checksum, actual, note: 'Base64URL 可以解码，但有效载荷已经发生改变' });
            return { ok: false, error: MSG_MODIFIED, kind: 'modified' };
        }
        diag.checksumOk = true;
        debugBackup('verified', raw, stripped, { body: bodyForDiag, cleanBody, expect: parsed.checksum, actual });
    } else {
        diag.checksumOk = null;
        debugBackup('no-checksum(legacy)', raw, stripped, { body: bodyForDiag, cleanBody });
    }
    lastRestoreDiag = diag;
    return { ok: true, data: res.data };
}

// 分段备份（TCM1P）解析：提取每段的总段数/段号/正文，校验缺段/重复/一致性，按序拼接后复用单码校验流程。
async function parseParts(cands, raw, stripped, diag, fail, validatePayload, config) {
    diag.prefixFound = true;
    const segMap = new Map();
    let total = null, duplicate = false, inconsistent = false;
    for (const c of cands) {
        if (c.prefix !== BACKUP_PARTS_PREFIX) continue; // 忽略混入的普通 TCM1，避免混淆
        const content = c.content.replace(/[\r\n\t\f\v ]+/g, ''); // 只清洗正文里的空白/换行，不破坏协议头冒号
        const m = /^(\d+):(\d+):(.+)$/.exec(content);
        if (!m) { inconsistent = true; break; }
        const t = parseInt(m[1], 10), no = parseInt(m[2], 10);
        const frag = m[3].replace(/[^A-Za-z0-9_-]/g, '');
        if (total === null) total = t; else if (total !== t) inconsistent = true;
        if (!Number.isInteger(no) || no < 1 || no > t) inconsistent = true;
        if (segMap.has(no)) duplicate = true;
        segMap.set(no, frag);
    }
    const received = segMap.size;
    const missing = [];
    if (total !== null) { for (let i = 1; i <= total; i++) if (!segMap.has(i)) missing.push(i); }
    if (inconsistent) {
        diag.kind = 'modified'; fail('parts-inconsistent');
        console.log('[TCM Backup Debug]', JSON.stringify({ stage: 'parts-inconsistent', totalParts: total, receivedParts: received, duplicate }));
        return { ok: false, error: MSG_PARTS_INCONSISTENT, kind: 'modified' };
    }
    if (duplicate) {
        diag.kind = 'modified'; fail('parts-duplicate');
        console.log('[TCM Backup Debug]', JSON.stringify({ stage: 'parts-duplicate', duplicate: 1 }));
        return { ok: false, error: MSG_PARTS_DUPLICATE, kind: 'modified' };
    }
    if (missing.length > 0) {
        diag.kind = 'modified'; fail('parts-missing');
        console.log('[TCM Backup Debug]', JSON.stringify({ stage: 'parts-missing', missing }));
        return { ok: false, error: MSG_PARTS_MISSING.replace('{n}', missing.join('、')), kind: 'modified' };
    }
    // 按段号顺序拼接为完整 Base64URL 正文（每段已单独清洗），随后走单码校验流程
    let body = '';
    for (let i = 1; i <= total; i++) body += segMap.get(i);
    diag.base64Length = body.length;
    console.log('[TCM Backup Debug]', JSON.stringify({ stage: 'parts-detected', totalParts: total, receivedParts: received, missingParts: 0, duplicateParts: 0, bodyLength: body.length }));
    return await decodeAndVerify(body, raw, stripped, body, diag, fail, validatePayload, config);
}

/* ===================== 诊断文本 ===================== */
// 将最近一次恢复诊断整理为安全文本（不含备份码、JSON、学习数据），供用户复制后反馈。
export function buildDiagnosticText(diag) {
    if (!diag) return '';
    const stage = v => (v === true ? '成功' : (v === false ? '失败' : '未执行'));
    const yn = v => (v === true ? '一致' : (v === false ? '失败' : '未校验'));
    return [
        'TCM1备份诊断',
        '前缀：' + (diag.prefixFound ? '已找到' : '未找到'),
        '原始输入长度：' + diag.rawLength,
        '规范化后长度：' + diag.normalizedLength,
        'Base64URL长度：' + diag.base64Length,
        '解码：' + stage(diag.decodeOk),
        'JSON：' + stage(diag.jsonOk),
        '数据结构：' + stage(diag.validateOk),
        'checksum：' + yn(diag.checksumOk),
        '失败阶段：' + (diag.stage || '-')
    ].join('\n');
}

// 供复制端与恢复端共用同一套规范化规则（保证两端判断一致）
export { normalizeBackupInput };

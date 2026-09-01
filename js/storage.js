/* ===================== 本地存储（localStorage） ===================== */
// 本模块负责学习记录的读写、数据统计与重置。localStorage key 保持原样：
//   tcm_completed_cases / tcm_wrong_cases

import {
    isSafeCaseId, diffMap, getAllCases, MAX_STORED_TEXT_LENGTH, escapeHtml
} from './data.js';

export function safeGetStorage(key, fallback) { try { const data = localStorage.getItem(key); return data ? JSON.parse(data) : fallback; } catch (e) { return fallback; } }
export function safeSetStorage(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('本地学习记录保存失败', e); } }

export function getCompletedCases() {
    const value = safeGetStorage('tcm_completed_cases', []);
    return Array.isArray(value) ? [...new Set(value.filter(isSafeCaseId))].slice(0, 1000) : [];
}

export function markCaseCompleted(caseId) {
    const arr = getCompletedCases();
    if (!arr.includes(caseId)) { arr.push(caseId); safeSetStorage('tcm_completed_cases', arr); }
}

export function sanitizeStoredText(value, maxLength = MAX_STORED_TEXT_LENGTH) { return typeof value === 'string' ? value.slice(0, maxLength) : ''; }

export function getWrongCases() {
    const value = safeGetStorage('tcm_wrong_cases', []);
    if (!Array.isArray(value)) return [];
    return value.filter(w => w && isSafeCaseId(w.id)).slice(-1000).map(w => ({
        id: w.id, title: sanitizeStoredText(w.title, 200), chiefComplaint: sanitizeStoredText(w.chiefComplaint),
        difficulty: diffMap[w.difficulty] ? w.difficulty : '', date: sanitizeStoredText(w.date, 40),
        syndrome: sanitizeStoredText(w.syndrome, 200), disease: sanitizeStoredText(w.disease, 200), basis: sanitizeStoredText(w.basis)
    }));
}

// 保存错题。为避免模块间循环依赖，caseObj / difficulty 由调用方传入。
export function saveWrongCase(data, caseObj, difficulty) {
    if (!caseObj) return;
    const wrongs = getWrongCases().filter(w => w.id !== caseObj.id);
    wrongs.push({
        id: caseObj.id,
        title: sanitizeStoredText(caseObj.title, 200),
        chiefComplaint: sanitizeStoredText(caseObj.chiefComplaint),
        difficulty: difficulty,
        date: new Date().toISOString(),
        syndrome: sanitizeStoredText(data.syndrome, 200),
        disease: sanitizeStoredText(data.disease, 200),
        basis: sanitizeStoredText(data.basis)
    });
    safeSetStorage('tcm_wrong_cases', wrongs);
}

export function removeWrongCase(caseId) {
    safeSetStorage('tcm_wrong_cases', getWrongCases().filter(w => w.id !== caseId));
}

export function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* ===================== 本地数据统计与重置 ===================== */
export function renderDataStats() {
    const total = getAllCases().length;
    const done = getCompletedCases().length;
    const wrong = getWrongCases().length;
    const remaining = Math.max(0, total - done);
    const el = document.getElementById('dataStats');
    if (el) el.textContent = `已完成 ${done} · 错题 ${wrong} · 未完成 ${remaining}`;
}

export function resetAllProgress() {
    if (!confirm('确定要清空所有学习进度和错题吗？此操作不可恢复。')) return;
    safeSetStorage('tcm_completed_cases', []);
    safeSetStorage('tcm_wrong_cases', []);
    renderDataStats();
    alert('已重置全部本地学习数据。');
}

// 供错题渲染使用（保留 export，避免未使用告警）
export { escapeHtml };

/* ===================== 学习进度导出 / 导入（纯前端，不依赖服务器） ===================== */
const PROGRESS_VERSION = 1;

function safeDateStr(value) {
    if (typeof value === 'string' && value && !isNaN(Date.parse(value))) return value;
    return new Date().toISOString();
}

// 统一构建备份数据（备份码与备份文件共用同一结构）
function buildProgressPayload() {
    return {
        app: 'TCM',
        type: 'learning-progress',
        version: PROGRESS_VERSION,
        exportedAt: new Date().toISOString(),
        completedCases: getCompletedCases(),
        wrongCases: getWrongCases()
    };
}

// 导出当前学习进度为 JSON 文件并下载
export function exportProgress() {
    const payload = buildProgressPayload();
    const completed = payload.completedCases;
    const wrongs = payload.wrongCases;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tcm-learning-progress-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    alert('✅ 学习进度已导出\n已完成 ' + completed.length + ' 例 · 错题 ' + wrongs.length + ' 条');
}

// 严格校验导入文件，返回 { ok, data?, error? }
export function validateProgressData(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: '文件格式不正确' };
    if (obj.app !== 'TCM' || obj.type !== 'learning-progress') return { ok: false, error: '文件格式不正确' };
    if (typeof obj.version !== 'number') return { ok: false, error: '文件格式不正确' };
    if (obj.version !== PROGRESS_VERSION) {
        if (obj.version > PROGRESS_VERSION) return { ok: false, error: '该进度文件来自更新版本的网站，请先升级网站后再尝试导入。' };
        return { ok: false, error: '无法导入：不支持的进度文件版本。' };
    }
    if (!Array.isArray(obj.completedCases) || !Array.isArray(obj.wrongCases)) return { ok: false, error: '文件格式不正确' };

    // 已完成病例：仅保留格式合法的 ID，按 ID 去重
    const completedCases = [];
    for (const id of obj.completedCases) {
        if (isSafeCaseId(id) && !completedCases.includes(id)) completedCases.push(id);
    }

    // 错题：逐条校验与转义（即使病例已从当前题库删除，只要 ID 格式合法就保留）
    const wrongCases = [];
    for (const w of obj.wrongCases) {
        if (!w || !isSafeCaseId(w.id)) continue;
        const clean = {
            id: w.id,
            title: sanitizeStoredText(w.title, 200),
            chiefComplaint: sanitizeStoredText(w.chiefComplaint),
            difficulty: diffMap[w.difficulty] ? w.difficulty : '',
            date: sanitizeStoredText(safeDateStr(w.date), 40),
            syndrome: sanitizeStoredText(w.syndrome, 200),
            disease: sanitizeStoredText(w.disease, 200),
            basis: sanitizeStoredText(w.basis)
        };
        const hasContent = clean.title || clean.chiefComplaint || clean.syndrome || clean.disease || clean.basis;
        if (!hasContent) continue; // 丢弃完全空的错题对象
        wrongCases.push(clean);
    }
    return { ok: true, data: { completedCases, wrongCases } };
}

// 错题去重依据：病例 ID + 日期 + 用户答案（证型/病名/辨证依据）
function wrongKey(w) {
    return [w.id, w.date, w.syndrome || '', w.disease || '', w.basis || ''].join('');
}

function mergeWrongCases(current, imported) {
    const seen = new Set();
    const result = [];
    for (const w of current.concat(imported)) {
        const key = wrongKey(w);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(w);
    }
    return result.slice(-1000);
}

function applyImportData(mode, data) {
    if (mode === 'cover') {
        safeSetStorage('tcm_completed_cases', data.completedCases);
        safeSetStorage('tcm_wrong_cases', data.wrongCases);
    } else {
        const mergedCompleted = [...new Set(getCompletedCases().concat(data.completedCases))].slice(0, 1000);
        safeSetStorage('tcm_completed_cases', mergedCompleted);
        safeSetStorage('tcm_wrong_cases', mergeWrongCases(getWrongCases(), data.wrongCases));
    }
    renderDataStats();
    // 若用户正打开错题 / 题库，实时重新渲染
    if (document.getElementById('recordsModal')?.style.display === 'flex' && typeof window.openRecords === 'function') window.openRecords();
    if (document.getElementById('caseBankModal')?.style.display === 'flex' && typeof window.filterCaseBank === 'function') window.filterCaseBank();
}

let pendingImport = null;

export function closeImportModal() { pendingImport = null; const m = document.getElementById('importModal'); if (m) m.style.display = 'none'; }

function openImportModal() { const m = document.getElementById('importModal'); if (m) m.style.display = 'flex'; }

function showImportError(msg, showDiag) {
    const body = document.getElementById('importModalBody');
    const m = document.getElementById('importModal');
    if (!body || !m) { alert('❌ ' + msg); return; }
    const html = escapeHtml(msg).replace(/\n/g, '<br>');
    // 仅备份码恢复失败时，提供“复制诊断信息”按钮（复制内容不含备份码 / 学习数据）
    const diagBtn = (showDiag && lastRestoreDiag)
        ? '<div style="text-align:center;margin-top:10px;"><button type="button" class="btn btn--ghost btn--sm" onclick="copyDiagnosticInfo()">📋 复制诊断信息</button></div>'
        : '';
    body.innerHTML = '<div class="result-box fail" style="margin:6px 0;">❌ ' + html + '</div>' +
        '<div style="text-align:center;margin-top:12px;"><button class="btn btn--outline btn--sm" onclick="closeImportModal()">知道了</button></div>' + diagBtn;
    openImportModal();
}

// 将最近一次恢复诊断整理为安全文本（不含备份码、JSON、学习数据），供用户复制后发给我
function buildDiagnosticText(diag) {
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

export function copyDiagnosticInfo() {
    const text = buildDiagnosticText(lastRestoreDiag);
    if (!text) { alert('暂无可复制的诊断信息'); return; }
    const ok = () => alert('✅ 诊断信息已复制（不含备份码内容）');
    const fail = () => {
        try {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.focus(); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta); ok();
        } catch (e) { alert(text); }
    };
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(ok, fail);
        } else { fail(); }
    } catch (e) { fail(); }
}

function showImportConfirm(data) {
    const body = document.getElementById('importModalBody');
    if (!body) return;
    const dateStr = data.exportedAt ? formatDate(data.exportedAt) : '';
    body.innerHTML =
        '<div style="font-size:1.15em;color:var(--accent);font-weight:700;margin-bottom:10px;">✅ 找到学习进度</div>' +
        '<div style="background:#fdfaf5;border:1px dashed var(--border);border-radius:10px;padding:12px 14px;font-size:0.92em;line-height:1.8;">' +
        '已完成：<strong>' + data.completedCases.length + '</strong> 例<br>' +
        '错题：<strong>' + data.wrongCases.length + '</strong> 条<br>' +
        '备份时间：' + (dateStr || '未知') + '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">' +
        '<button class="btn btn--primary btn--sm" style="animation:none;" onclick="applyImportMode(\'merge\')">🤝 合并到当前进度</button>' +
        '<button class="btn btn--outline btn--sm" onclick="applyImportMode(\'cover\')">♻️ 覆盖当前进度</button>' +
        '<button class="btn btn--ghost btn--sm" onclick="closeImportModal()">取消</button>' +
        '</div>' +
        '<p style="color:var(--text-muted);font-size:0.85em;margin:12px 0 0;line-height:1.6;">合并：保留当前记录　覆盖：使用备份中的记录替换当前记录</p>';
    openImportModal();
}

export function applyImportMode(mode) {
    if (!pendingImport) return;
    if (mode === 'cover') {
        const body = document.getElementById('importModalBody');
        if (body) body.innerHTML =
            '<div style="font-size:1.15em;color:var(--accent);font-weight:700;margin-bottom:8px;">⚠️ 覆盖当前进度</div>' +
            '<p style="color:var(--text-light);line-height:1.8;margin-bottom:14px;">这会替换当前浏览器中的学习记录，当前记录可能丢失。</p>' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
            '<button class="btn btn--ghost btn--sm" onclick="closeImportModal()">取消</button>' +
            '<button class="btn btn--primary btn--sm" style="animation:none;background:var(--accent);" onclick="confirmCoverImport()">确认覆盖</button>' +
            '</div>';
        return;
    }
    doApplyImport('merge');
}

export function confirmCoverImport() { doApplyImport('cover'); }

function doApplyImport(mode) {
    const data = pendingImport;
    pendingImport = null;
    if (!data) return;
    applyImportData(mode, data);
    const body = document.getElementById('importModalBody');
    if (body) {
        body.innerHTML =
            '<div class="result-box success" style="margin:6px 0;">✅ 学习进度导入成功</div>' +
            '<div style="background:#fdfaf5;border:1px dashed var(--border);border-radius:10px;padding:12px 14px;font-size:0.92em;line-height:1.8;margin-top:10px;">' +
            '已完成病例：<strong>' + data.completedCases.length + '</strong> 例<br>' +
            '错题记录：<strong>' + data.wrongCases.length + '</strong> 条</div>' +
            '<div style="text-align:center;margin-top:14px;"><button class="btn btn--outline btn--sm" onclick="closeImportModal()">知道了</button></div>';
    }
}

/* ===================== 学习进度备份码（复制 / 粘贴，纯前端，不依赖服务器） ===================== */
// 备份码统一采用 TCM1: 前缀 + 同一份备份数据：JSON → gzip 压缩 → Base64URL（浏览器原生，无依赖）。
// 不支持 gzip 时退回旧的非压缩 TCM1（UTF-8 → Base64URL），两种格式均可恢复。不含加密、不含 HTML、不含不可见字符。
// 注：旧版的 TCM2（gzip）备份码已停用，解析时给出“旧版格式”提示，不影响 TCM1 与备份文件。
const BACKUP_PREFIX = 'TCM1:';
const BACKUP_PREFIX_V2 = 'TCM2:'; // 仅用于识别旧版备份码并提示，不再生成
const MAX_BACKUP_CODE_LEN = 6000000;
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
// 备份码长度分级（按字符数，用于提示聊天软件截断风险，不阻止复制）
const LEN_OK = 1800;     // <= 1800：直接复制，无额外提示
const LEN_WARN = 2048;   // 1800~2048：提示聊天长度限制；> 2048：重点提示

function utf8ToBase64Url(str) {
    let b64;
    try {
        const bytes = new TextEncoder().encode(str);
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        b64 = btoa(bin);
    } catch (e) {
        b64 = btoa(unescape(encodeURIComponent(str)));
    }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUtf8(b64url) {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    } catch (e) {
        return decodeURIComponent(escape(atob(b64)));
    }
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

// gzip 压缩 / 解压（浏览器原生 CompressionStream / DecompressionStream，纯前端，无依赖）。
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

// ============ 备份码健壮性辅助（跨设备聊天软件传输） ============
// 备份码只使用 ASCII 安全的 Base64URL 字符集 [A-Za-z0-9_-]，不出现 + / = 与任何 Unicode。
const MSG_FORMAT = '这不是有效的学习进度备份码';
const MSG_MODIFIED = '备份码内容不完整或已被修改\n请从原设备重新复制备份码。如果通过微信传输失败，可以尝试：先保存到备忘录、文本文件或其他不会修改内容的方式，再复制。';
const MSG_LEGACY = '该备份码属于旧版格式，当前版本不再支持直接读取。\n请在生成它的旧版网站中恢复后，重新「备份」生成新的备份码；也可以尝试使用原来的备份文件恢复。';
const MSG_TRUNCATED = '备份码可能被聊天工具截断。\n请重新复制完整备份码，或使用「保存备份文件」进行恢复。';

// 聊天工具常见的“整条消息长度上限”参考值（不写死唯一值，未来不同平台/版本可能不同）
const TRUNC_LIMITS = [1024, 1400, 1536, 1800, 2000, 2048, 4096, 8192, 16000];
function nearTruncationLimit(len) {
    return typeof len === 'number' && TRUNC_LIMITS.some(L => Math.abs(len - L) <= 12);
}

// 规范化校验对象（排除 checksum 字段），保证生成与校验使用相同序列化顺序
function canonicalizePayload(obj) {
    return JSON.stringify({
        app: obj.app,
        type: obj.type,
        version: obj.version,
        exportedAt: obj.exportedAt,
        completedCases: obj.completedCases,
        wrongCases: obj.wrongCases
    });
}
// 完整性校验：优先 SHA-256（crypto.subtle），非安全上下文回退 FNV-1a 32 位（仅用于本地完整性检测，非加密）
async function computeChecksum(canonicalJson) {
    const data = new TextEncoder().encode(canonicalJson);
    if (globalThis.crypto && globalThis.crypto.subtle && globalThis.crypto.subtle.digest) {
        try {
            const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) { /* 回退 */ }
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}
// 清理聊天软件可能附带的无害格式字符（BOM / 零宽 / 换行 / 制表 / 空格）；不修改任何有效载荷字符
function normalizeBackupInput(raw) {
    return String(raw)
        .replace(/[\uFEFF\u200B\u200C\u200D\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
        .replace(/[\r\n\t\f\v]+/g, '')
        .replace(/ +/g, '')
        .trim();
}
// 诊断状态（仅内存，不写 localStorage、不上传服务器）
let lastGeneratedBackupCode = '';        // 本次复制的备份码原文（仅用于同设备对比，不持久化）
let lastGeneratedSummary = { length: 0, digest: '' }; // 不可逆摘要，用于调试
let lastRestoreDiag = null;              // 最近一次恢复诊断（安全，不含备份码内容）

// 对字符串做 SHA-256（仅用于诊断摘要，不可逆，不含学习内容）
async function sha256Hex(str) {
    try {
        const data = new TextEncoder().encode(String(str));
        if (globalThis.crypto && globalThis.crypto.subtle && globalThis.crypto.subtle.digest) {
            const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch (e) {}
    return '';
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
function diagnoseFirstDiff(orig, pasted) {
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
    try {
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
    } catch (e) {}
}

// 生成当前进度的备份码（统一数据源：与备份文件同一份 payload）。
// 流程：JSON → 计算 checksum → UTF-8 → gzip 压缩 → Base64URL → TCM1:
// 不支持 gzip 或压缩后并未更短时，退回旧的非压缩 TCM1（UTF-8 → Base64URL），保证兼容与尽量短。
export async function createProgressBackupCode() {
    const payload = buildProgressPayload();
    payload.checksum = await computeChecksum(canonicalizePayload(payload));
    const jsonStr = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(jsonStr);
    const gz = await gzipBytes(bytes);
    const compB64 = gz ? bytesToBase64Url(gz) : null;
    const rawB64 = utf8ToBase64Url(jsonStr);
    // 选择更短的输出：压缩不一定更短（极小数据可能原样更短），但都能被新解析器恢复
    return BACKUP_PREFIX + (compB64 && compB64.length <= rawB64.length ? compB64 : rawB64);
}

// 备份码 UTF-8 字节大小（用于提示，而非硬性限制）
export function getBackupCodeBytes(code) {
    try { return new TextEncoder().encode(code).length; }
    catch (e) { return code.length; }
}

// 根据备份码字符长度给出可选提示（不阻止复制），用于规避聊天软件消息长度截断
function sizeHintHtml(code) {
    const n = code ? code.length : 0;
    if (n <= LEN_OK) return '';
    if (n <= LEN_WARN) {
        return '<div class="form-hint" style="margin:0;">⚠️ 当前备份码较长，直接发送到聊天软件可能存在长度限制。建议使用「保存备份文件」长期保存。</div>';
    }
    return '<div class="form-hint" style="margin:0;">⚠️ 当前备份码较长，不建议直接粘贴到聊天消息中。建议使用「保存备份文件」进行跨设备传输。</div>';
}

// 解析并校验备份码，返回 { ok, data?, error?, kind? }
// kind: format(非备份码) / modified(内容被改或损坏) / legacy(旧版TCM2) / version(高版本)
export async function parseProgressBackupCode(raw) {
    // 本函数“宽容输入、严格验真”：先定位 TCM1: 前缀并提取其后合法 Base64URL 字符，
    // 再逐阶段校验。每一步都写入安全诊断（不含备份码/学习数据内容）。
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
    // 统一清理无害格式字符（BOM / 零宽 / 双向控制 / 换行 / Tab / 空格）
    const code = normalizeBackupInput(raw);
    diag.rawLength = raw.length;
    diag.normalizedLength = code.length;
    // 同设备参考：若本会话复制过备份码，可用其 Base64URL 长度做变化比对（跨设备通常无此值）
    const expectedBase64Len = (lastGeneratedBackupCode && lastGeneratedBackupCode.indexOf(BACKUP_PREFIX) === 0)
        ? lastGeneratedBackupCode.length - BACKUP_PREFIX.length : undefined;
    debugBackup('normalized', raw, code, { expectedBase64Len });
    if (code.length > MAX_BACKUP_CODE_LEN) {
        diag.kind = 'format'; fail('too-long');
        debugBackup('too-long', raw, code);
        return { ok: false, error: MSG_FORMAT, kind: 'format' };
    }
    // 旧版 TCM2（gzip）已停用，给出明确提示，不尝试解压
    if (code.indexOf(BACKUP_PREFIX_V2) === 0) {
        diag.kind = 'legacy'; fail('legacy');
        return { ok: false, error: MSG_LEGACY, kind: 'legacy' };
    }
    // 查找 TCM1: 前缀（前缀前允许无害空白 / BOM / 零宽字符，已在 normalize 阶段清理）
    const prefixIndex = code.indexOf(BACKUP_PREFIX);
    if (prefixIndex < 0) {
        diag.kind = 'format'; fail('prefix-not-found');
        debugBackup('prefix-not-found', raw, code);
        return { ok: false, error: MSG_FORMAT, kind: 'format' };
    }
    diag.prefixFound = true;
    // 只处理 TCM1: 之后的内容，绝不对整段文本做全局 Base64URL 拼接
    const body = code.slice(prefixIndex + BACKUP_PREFIX.length);
    const cleanBody = body.replace(/[^A-Za-z0-9_-]/g, '');
    diag.base64Length = cleanBody.length;
    debugBackup('extracted', raw, code, { body, cleanBody, expectedBase64Len });
    if (!cleanBody) {
        diag.kind = 'modified'; fail('empty-body');
        debugBackup('empty-body', raw, code, { body, cleanBody });
        return { ok: false, error: MSG_MODIFIED, kind: 'modified' };
    }
    // Base64URL → 二进制（分块安全）
    let bytes;
    try { bytes = base64UrlToBytes(cleanBody); diag.decodeOk = true; }
    catch (e) {
        diag.kind = 'modified'; diag.decodeOk = false; fail('decode-fail');
        debugBackup('decode-fail', raw, code, { body, cleanBody, note: 'Base64URL 解码失败，可能发生截断/字符损坏' });
        return { ok: false, error: MSG_MODIFIED, kind: 'modified' };
    }
    // 解压：先判断是否 gzip（魔术字节 0x1f 0x8b）；是则解压得到 JSON，否则按旧版非压缩 TCM1（UTF-8 JSON）处理。
    // gzip 解压失败不立即判损坏——它可能是旧版非压缩 TCM1，但这里 gzip 魔术字节已命中，失败即视为损坏。
    let jsonStr = null;
    const looksGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (looksGzip) {
        try {
            const gz = await gunzipBytes(bytes);
            jsonStr = new TextDecoder().decode(gz);
            debugBackup('gunzip', raw, code, { body, cleanBody, note: 'gzip 解压成功' });
        } catch (e) {
            diag.kind = 'modified'; fail('gunzip-fail');
            debugBackup('gunzip-fail', raw, code, { body, cleanBody, note: 'gzip 解压失败' });
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
        debugBackup('json-fail', raw, code, { body, cleanBody, note });
        return { ok: false, error: truncated ? MSG_TRUNCATED : MSG_MODIFIED, kind: 'modified' };
    }
    // 版本检查（高版本备份不应误判为“损坏”）
    if (parsed && typeof parsed.version === 'number' && parsed.version > PROGRESS_VERSION) {
        diag.stage = 'version'; diag.kind = 'version'; lastRestoreDiag = diag;
        return { ok: false, error: '这个备份来自更新版本的网站，当前版本暂时无法读取。请先更新网站后再尝试恢复。', kind: 'version' };
    }
    // 数据结构校验
    const res = validateProgressData(parsed);
    if (!res.ok) {
        diag.kind = 'modified'; diag.validateOk = false; fail('validate-fail');
        debugBackup('validate-fail', raw, code, { body, cleanBody, note: '数据结构校验失败' });
        return { ok: false, error: MSG_MODIFIED, kind: 'modified' };
    }
    diag.validateOk = true;
    // checksum 完整性校验（旧备份无 checksum 时跳过，仅做结构校验，保持兼容）。
    // checksum 是判断“微信等传输是否真正改变了有效载荷”的最终保险，绝不跳过、绝不猜测。
    if (typeof parsed.checksum === 'string') {
        const actual = await computeChecksum(canonicalizePayload(parsed));
        if (parsed.checksum.toLowerCase() !== actual.toLowerCase()) {
            diag.kind = 'modified'; diag.checksumOk = false; fail('checksum-mismatch');
            debugBackup('checksum-mismatch', raw, code, { body, cleanBody, expect: parsed.checksum, actual, note: 'Base64URL 可以解码，但有效载荷已经发生改变' });
            return { ok: false, error: MSG_MODIFIED, kind: 'modified' };
        }
        diag.checksumOk = true;
        debugBackup('verified', raw, code, { body, cleanBody, expect: parsed.checksum, actual });
    } else {
        diag.checksumOk = null;
        debugBackup('no-checksum(legacy)', raw, code, { body, cleanBody });
    }
    lastRestoreDiag = diag;
    return { ok: true, data: res.data };
}

/* ===== 备份学习进度 模态框 ===== */
export function openBackupModal() {
    const m = document.getElementById('backupModal');
    if (!m) return;
    m.style.display = 'flex';
    renderBackupChoice();
}
export function closeBackupModal() {
    const m = document.getElementById('backupModal');
    if (m) m.style.display = 'none';
}
export function renderBackupChoice() {
    const body = document.getElementById('backupModalBody');
    if (!body) return;
    body.innerHTML =
        '<p style="color:var(--text-light);line-height:1.7;margin-bottom:12px;">当前：已完成 <strong>' + getCompletedCases().length + '</strong> 例 · 错题 <strong>' + getWrongCases().length + '</strong> 条</p>' +
        '<div class="backup-options">' +
        '<button type="button" class="backup-option" onclick="showBackupCode()"><div class="backup-option-icon">📋</div><div class="backup-option-title">复制备份码</div><div class="backup-option-desc">跨设备最方便</div></button>' +
        '<button type="button" class="backup-option" onclick="saveBackupFile()"><div class="backup-option-icon">📄</div><div class="backup-option-title">保存备份文件</div><div class="backup-option-desc">适合长期保存</div></button>' +
        '</div>';
}
export async function showBackupCode() {
    const body = document.getElementById('backupModalBody');
    if (!body) return;
    const code = await createProgressBackupCode();
    body.innerHTML =
        '<textarea id="backupCodeArea" readonly class="backup-code-area">' + escapeHtml(code) + '</textarea>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">' +
        '<button type="button" class="btn btn--primary btn--sm" onclick="copyBackupCode()">📋 复制备份码</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" onclick="renderBackupChoice()">返回</button></div>' +
        '<div id="backupCodeMsg" style="margin-top:10px;"></div>';
    const ta = document.getElementById('backupCodeArea');
    if (ta) { ta.focus(); ta.select(); }
}
export function copyBackupCode() {
    const ta = document.getElementById('backupCodeArea');
    const msg = document.getElementById('backupCodeMsg');
    const code = ta ? ta.value : '';
    if (!code) return;
    // 诊断：记录本次复制的备份码摘要（仅内存，不写 localStorage、不上传）
    lastGeneratedBackupCode = code;
    sha256Hex(code).then(d => { lastGeneratedSummary = { length: code.length, digest: d }; }).catch(() => {});
    const hint = sizeHintHtml(code);
    const done = () => {
        if (msg) msg.innerHTML = '<div class="result-box success" style="margin:0;">✅ 已复制备份码<br>可发送到微信、QQ、邮箱或保存到备忘录。</div>' + hint;
        verifyClipboard(code, msg, hint);
    };
    const fallback = () => {
        if (ta) { ta.removeAttribute('readonly'); ta.focus(); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.setAttribute('readonly', ''); }
        if (msg) msg.innerHTML = '<div class="form-hint" style="margin:0;">已选中备份码，请长按复制，或按 Ctrl/⌘ + C 复制。</div>' + hint;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, fallback);
    } else { fallback(); }
}

// 复制后尽力回读剪贴板做一致性校验（浏览器可能拒绝读权限，拒绝则忽略，不阻塞）
function verifyClipboard(code, msg, hint) {
    if (!navigator.clipboard || !navigator.clipboard.readText) return;
    try {
        navigator.clipboard.readText().then(text => {
            if (typeof text !== 'string') return;
            // 与恢复端共用同一套规范化规则，确保复制端与恢复端判断一致
            const norm = normalizeBackupInput(text);
            if (norm && norm !== code) {
                if (msg) msg.innerHTML = '<div class="result-box success" style="margin:0;">✅ 已复制备份码<br>可发送到微信、QQ、邮箱或保存到备忘录。</div>' +
                    '<div class="form-hint" style="margin-top:8px;">⚠️ 剪贴板内容可能发生变化，请使用下方备份码手动复制。</div>' + hint;
            }
        }).catch(() => {});
    } catch (e) { /* 忽略 */ }
}
export function saveBackupFile() { exportProgress(); }

/* ===== 恢复学习进度 模态框（复用 importModal，与文件导入共用确认/应用流程） ===== */
export function openRestoreChoice() {
    openImportModal();
    const body = document.getElementById('importModalBody');
    if (!body) return;
    body.innerHTML =
        '<div class="backup-options">' +
        '<button type="button" class="backup-option" onclick="startCodeRestore()"><div class="backup-option-icon">📋</div><div class="backup-option-title">粘贴备份码</div><div class="backup-option-desc">跨设备最方便</div></button>' +
        '<button type="button" class="backup-option" onclick="triggerFileRestore()"><div class="backup-option-icon">📄</div><div class="backup-option-title">从备份文件恢复</div><div class="backup-option-desc">适合长期保存</div></button>' +
        '</div>' +
        '<div style="text-align:center;margin-top:12px;"><button type="button" class="btn btn--ghost btn--sm" onclick="closeImportModal()">取消</button></div>';
}
export function startCodeRestore() {
    const body = document.getElementById('importModalBody');
    if (!body) return;
    body.innerHTML =
        '<p style="color:var(--text-light);line-height:1.7;margin-bottom:8px;">请粘贴之前备份的学习进度码。</p>' +
        '<p class="form-hint" style="margin-bottom:10px;line-height:1.6;">备份码只在当前设备上处理，不会上传到服务器。</p>' +
        '<textarea id="progressCodeInput" class="backup-code-area" placeholder="在此粘贴备份码..."></textarea>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">' +
        '<button type="button" class="btn btn--primary btn--sm" onclick="checkBackupCode()">检查备份码</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" onclick="openRestoreChoice()">返回</button></div>' +
        '<div id="restoreMsg" style="margin-top:10px;"></div>';
    const ta = document.getElementById('progressCodeInput');
    if (ta) ta.focus();
}
export async function checkBackupCode() {
    const ta = document.getElementById('progressCodeInput');
    if (!ta) return;
    const pasted = ta.value || '';
    // 同设备诊断：若本会话复制过备份码（电脑 / 手机通常是不同浏览器，故跨设备一般无此值），
    // 比较原始码与粘贴码的“第一处差异”，帮助判断传输是否改动了字符。跨设备场景依赖下面的 Console 诊断。
    if (lastGeneratedBackupCode) {
        try {
            const d = diagnoseFirstDiff(lastGeneratedBackupCode, pasted);
            console.log('[TCM Backup Debug]', JSON.stringify({ stage: 'same-device-diff', ...d }));
        } catch (e) {}
    }
    const res = await parseProgressBackupCode(pasted);
    if (!res.ok) { showImportError(res.error, true); return; }
    pendingImport = res.data;
    showImportConfirm(res.data);
}
export function triggerFileRestore() {
    const inp = document.getElementById('importFileInput');
    if (inp) inp.click();
}

// 文件导入增加大小上限，避免异常大文件直接解析
export function importProgress(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_FILE_BYTES) { showImportError('文件过大，无法导入'); return; }
    const reader = new FileReader();
    reader.onload = () => {
        let parsed;
        try { parsed = JSON.parse(reader.result); }
        catch (e) { showImportError('文件格式不正确'); return; }
        const res = validateProgressData(parsed);
        if (!res.ok) { showImportError(res.error); return; }
        pendingImport = res.data;
        showImportConfirm(res.data);
    };
    reader.onerror = () => showImportError('文件读取失败');
    reader.readAsText(file);
}

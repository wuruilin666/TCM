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

function showImportError(msg) {
    const body = document.getElementById('importModalBody');
    const m = document.getElementById('importModal');
    if (!body || !m) { alert('❌ ' + msg); return; }
    body.innerHTML = '<div class="result-box fail" style="margin:6px 0;">❌ ' + escapeHtml(msg) + '</div>' +
        '<div style="text-align:center;margin-top:12px;"><button class="btn btn--outline btn--sm" onclick="closeImportModal()">知道了</button></div>';
    openImportModal();
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
// 备份码统一采用 TCM1: 前缀 + 同一份统一备份数据的紧凑编码（UTF-8 → Base64URL）。
// 不压缩、不加密、不含 HTML、不含不可见字符，兼容电脑 / 手机 / 平板，适合在微信 / QQ / 邮箱 / 备忘录中复制粘贴传输。
// 注：旧版的 TCM2（gzip）备份码已停用，解析时给出“旧版格式”提示，不影响 TCM1 与备份文件。
const BACKUP_PREFIX = 'TCM1:';
const BACKUP_PREFIX_V2 = 'TCM2:'; // 仅用于识别旧版备份码并提示，不再生成
const MAX_BACKUP_CODE_LEN = 6000000;
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
// 备份码字节大小分级（按 UTF-8 字节数，而非字符数）
const SIZE_SMALL = 8000;     // < 8KB：直接复制，无额外提示
const SIZE_LARGE = 40000;    // > 40KB：建议使用备份文件

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

// 生成当前进度的备份码（统一数据源：与备份文件同一份 payload）。
// 只产生 TCM1: 编码（UTF-8 → Base64URL），不压缩，确保电脑 / 手机 / 平板之间稳定复制粘贴恢复。
export function createProgressBackupCode() {
    return BACKUP_PREFIX + utf8ToBase64Url(JSON.stringify(buildProgressPayload()));
}

// 备份码 UTF-8 字节大小（用于提示，而非硬性限制）
export function getBackupCodeBytes(code) {
    try { return new TextEncoder().encode(code).length; }
    catch (e) { return code.length; }
}

// 根据字节大小给出可选的轻量提示（不阻止使用）
function sizeHintHtml(bytes) {
    if (bytes > SIZE_LARGE) {
        return '<div class="form-hint" style="margin:0;">⚠️ 当前学习记录较多，备份码较长，建议使用「保存备份文件」进行保存。</div>';
    }
    if (bytes > SIZE_SMALL) {
        return '<div class="form-hint" style="margin:0;">当前记录较多，也可以使用「保存备份文件」进行备份。</div>';
    }
    return '';
}

// 解析并校验备份码，返回 { ok, data?, error? }
export function parseProgressBackupCode(raw) {
    if (typeof raw !== 'string') return { ok: false, error: '备份码无效' };
    const code = raw.trim();
    if (code.length > MAX_BACKUP_CODE_LEN) return { ok: false, error: '备份码无效' };
    // 识别旧版 TCM2（gzip）备份码：已停用，给出明确提示，不尝试解压
    if (code.indexOf(BACKUP_PREFIX_V2) === 0) {
        return { ok: false, error: '该备份码属于旧版格式，当前版本不再支持直接读取。\n请在生成它的旧版网站中恢复后，重新「备份」生成新的备份码；也可以尝试使用原来的备份文件恢复。' };
    }
    if (code.indexOf(BACKUP_PREFIX) !== 0) {
        return { ok: false, error: '备份码无效，请检查复制内容是否完整。' };
    }
    const body = code.slice(BACKUP_PREFIX.length);
    if (!body) return { ok: false, error: '备份码无效，请检查复制内容是否完整。' };
    let jsonStr;
    try { jsonStr = base64UrlToUtf8(body); }
    catch (e) { return { ok: false, error: '备份码损坏或格式不正确' }; }
    let parsed;
    try { parsed = JSON.parse(jsonStr); }
    catch (e) { return { ok: false, error: '备份码损坏或格式不正确' }; }
    if (parsed && typeof parsed.version === 'number' && parsed.version > PROGRESS_VERSION) {
        return { ok: false, error: '这个备份来自更新版本的网站，当前版本暂时无法读取。请先更新网站后再尝试恢复。' };
    }
    const res = validateProgressData(parsed);
    if (!res.ok) return { ok: false, error: '备份码损坏或格式不正确' };
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
    const hint = sizeHintHtml(getBackupCodeBytes(code));
    const done = () => { if (msg) msg.innerHTML = '<div class="result-box success" style="margin:0;">✅ 已复制备份码<br>可发送到微信、QQ、邮箱或保存到备忘录。</div>' + hint; };
    const fallback = () => {
        if (ta) { ta.removeAttribute('readonly'); ta.focus(); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.setAttribute('readonly', ''); }
        if (msg) msg.innerHTML = '<div class="form-hint" style="margin:0;">已选中备份码，请长按复制，或按 Ctrl/⌘ + C 复制。</div>' + hint;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, fallback);
    } else { fallback(); }
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
    const res = await parseProgressBackupCode(ta.value);
    if (!res.ok) { showImportError(res.error); return; }
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

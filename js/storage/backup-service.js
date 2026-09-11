/* ===================== 备份服务（备份数据构建/校验 + 备份恢复界面） =====================
 * 职责：
 *   - 构建统一的备份数据（备份码与备份文件共用同一份结构）
 *   - 校验备份数据，并做字段级清洗
 *   - 备份码 / 备份文件的导出与恢复入口
 *   - 备份与恢复弹窗的渲染
 *
 * 依赖方向：
 *   Backup Service → Progress Storage（读写学习数据）
 *   Backup Service → Backup Code（编解码，通过注入的校验函数回接，避免循环依赖）
 *
 * 禁止：
 *   - 绕过 Progress Storage 直接操作 localStorage key
 *   - 实现 Base64URL / gzip / 分段协议细节（属于 backup-code.js）
 * ================================================================================== */

import { isSafeCaseId, diffMap } from '../data.js';
import { escapeHtml } from '../html-utils.js';
import {
    getCompletedCases, getWrongCases, sanitizeStoredText,
    mergeProgress, replaceProgress, formatDate
} from './progress-storage.js';
import {
    encodeProgressCode, splitProgressCode, decodeProgressCode,
    rememberGeneratedCode, sha256Hex, diagnoseFirstDiff,
    getLastGeneratedBackupCode, getLastRestoreDiag, buildDiagnosticText,
    getBackupSizeLevel, normalizeBackupInput,
    PARTS_FILE_RECOMMEND, PARTS_FILE_STRONGLY_RECOMMEND
} from './backup-code.js';

export const PROGRESS_VERSION = 1;

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

/* ===================== 备份数据构建 ===================== */
function safeDateStr(value) {
    if (typeof value === 'string' && value && !isNaN(Date.parse(value))) return value;
    return new Date().toISOString();
}

// 统一构建备份数据（备份码与备份文件共用同一结构）
export function buildProgressPayload() {
    return {
        app: 'TCM',
        type: 'learning-progress',
        version: PROGRESS_VERSION,
        exportedAt: new Date().toISOString(),
        completedCases: getCompletedCases(),
        wrongCases: getWrongCases()
    };
}

// 规范化校验对象（排除 checksum 字段），保证生成与校验使用相同序列化顺序
export function canonizePayload(obj) {
    return JSON.stringify({
        app: obj.app,
        type: obj.type,
        version: obj.version,
        exportedAt: obj.exportedAt,
        completedCases: obj.completedCases,
        wrongCases: obj.wrongCases
    });
}

/* ===================== checksum ===================== */
// 完整性校验：优先 SHA-256（crypto.subtle），非安全上下文回退 FNV-1a 32 位（仅用于本地完整性检测，非加密）。
// 两个分支都不可用时明确失败，不静默返回空值。
export async function computeChecksum(canonicalJson) {
    const data = new TextEncoder().encode(canonicalJson);
    if (globalThis.crypto && globalThis.crypto.subtle && globalThis.crypto.subtle.digest) {
        const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) { h ^= data[i]; h = Math.imul(h, 0x01000193); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

// 备份码编解码器需要的配置（注入而非 import，避免 backup-code → backup-service 的循环依赖）
const codecConfig = { currentVersion: PROGRESS_VERSION, canonize: canonizePayload, computeChecksum };

/* ===================== 数据校验 ===================== */
// 严格校验导入数据，返回 { ok, data?, error? }
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

    // 错题：逐条校验与清洗（即使病例已从当前题库删除，只要 ID 格式合法就保留）
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

/* ===================== 暴露给 UI 层的数据钩子 ===================== */
// 导入数据后需要刷新界面。Storage/Backup 不直接调用页面模块，
// 由 Application 层（app.js）注册回调，避免 Infrastructure → UI 的反向依赖。
let onProgressChanged = null;
export function registerProgressChangeHandler(fn) { onProgressChanged = fn; }

function applyImportData(mode, data) {
    if (mode === 'cover') replaceProgress(data);
    else mergeProgress(data);
    if (onProgressChanged) onProgressChanged();
}

/* ===================== 备份文件导出 ===================== */
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
    alert('学习进度已导出\n已完成 ' + completed.length + ' 例 · 错题 ' + wrongs.length + ' 条');
}

/* ===================== 备份码生成 ===================== */
export async function createProgressBackupCode() {
    const payload = buildProgressPayload();
    const checksum = await computeChecksum(canonizePayload(payload));
    return encodeProgressCode(payload, checksum);
}

export async function createProgressBackupParts() {
    return splitProgressCode(await createProgressBackupCode());
}

/* ===================== 备份码解析 ===================== */
export async function parseProgressBackupCode(raw) {
    return decodeProgressCode(raw, validateProgressData, codecConfig);
}

/* ===================== 弹窗公共部分 ===================== */
let pendingImport = null;

export function closeImportModal() {
    pendingImport = null;
    const m = document.getElementById('importModal');
    if (m) m.style.display = 'none';
}

function openImportModal() {
    const m = document.getElementById('importModal');
    if (m) m.style.display = 'flex';
}

function showImportError(msg) {
    const body = document.getElementById('importModalBody');
    const m = document.getElementById('importModal');
    if (!body || !m) { alert(msg); return; }
    const html = escapeHtml(msg).replace(/\n/g, '<br>');
    body.innerHTML = '<div class="result-box fail" style="margin:6px 0;">' + html + '</div>' +
        '<div style="text-align:center;margin-top:12px;"><button class="btn btn--outline btn--sm" onclick="closeImportModal()">知道了</button></div>';
    openImportModal();
}

export function copyDiagnosticInfo() {
    const text = buildDiagnosticText(getLastRestoreDiag());
    if (!text) { alert('暂无可复制的诊断信息'); return; }
    const ok = () => alert('诊断信息已复制（不含备份码内容）');
    const fail = () => {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta); ok();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, fail);
    } else { fail(); }
}

function showImportConfirm(data) {
    const body = document.getElementById('importModalBody');
    if (!body) return;
    const dateStr = data.exportedAt ? formatDate(data.exportedAt) : '';
    body.innerHTML =
        '<div style="font-size:1.15em;color:var(--accent);font-weight:700;margin-bottom:10px;">找到学习进度</div>' +
        '<div style="background:#fdfaf5;border:1px dashed var(--border);border-radius:10px;padding:12px 14px;font-size:0.92em;line-height:1.8;">' +
        '已完成：<strong>' + data.completedCases.length + '</strong> 例<br>' +
        '错题：<strong>' + data.wrongCases.length + '</strong> 条<br>' +
        '备份时间：' + (dateStr || '未知') + '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">' +
        '<button class="btn btn--primary btn--sm" style="animation:none;" onclick="applyImportMode(\'merge\')">合并到当前进度</button>' +
        '<button class="btn btn--outline btn--sm" onclick="applyImportMode(\'cover\')">覆盖当前进度</button>' +
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
            '<div style="font-size:1.15em;color:var(--accent);font-weight:700;margin-bottom:8px;">覆盖当前进度</div>' +
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
            '<div class="result-box success" style="margin:6px 0;">学习进度导入成功</div>' +
            '<div style="background:#fdfaf5;border:1px dashed var(--border);border-radius:10px;padding:12px 14px;font-size:0.92em;line-height:1.8;margin-top:10px;">' +
            '已完成病例：<strong>' + data.completedCases.length + '</strong> 例<br>' +
            '错题记录：<strong>' + data.wrongCases.length + '</strong> 条</div>' +
            '<div style="text-align:center;margin-top:14px;"><button class="btn btn--outline btn--sm" onclick="closeImportModal()">知道了</button></div>';
    }
}

/* ===================== 备份学习进度 模态框 ===================== */
// 备份码展示状态（单码 / 分段），仅用于 UI 文案与复制
let currentBackup = { code: '', parts: [], isSegmented: false };

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
    const doneCount = getCompletedCases().length;
    const wrongCount = getWrongCases().length;
    body.innerHTML =
        '<p style="color:var(--text-light);line-height:1.7;margin-bottom:12px;">当前：已完成 <strong>' + doneCount + '</strong> 例 · 错题 <strong>' + wrongCount + '</strong> 条</p>' +
        '<div class="backup-options">' +
        '<button type="button" class="backup-option" style="border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb, var(--accent) 16%, transparent);" onclick="saveBackupFile()">' +
            '<span style="display:inline-block;background:var(--accent);color:#fff;font-size:0.72em;font-weight:700;line-height:1;padding:3px 9px;border-radius:999px;margin-bottom:8px;">推荐</span>' +
            '<div class="backup-option-title">保存备份文件</div>' +
            '<div class="backup-option-desc">适合换设备、大量学习记录和长期保存。</div>' +
        '</button>' +
        '<button type="button" class="backup-option" onclick="showBackupCode()">' +
            '<div class="backup-option-title">使用备份码</div>' +
            '<div class="backup-option-desc">复制后可通过微信等聊天工具传输。数据较多时会自动分段。</div>' +
        '</button>' +
        '</div>' +
        '<p class="form-hint" style="margin:14px 2px 0;font-size:0.85em;line-height:1.6;">提示：若暂时不方便保存或找不到备份文件的位置，也可以使用备份码进行跨设备备份。</p>';
}

export async function showBackupCode() {
    const body = document.getElementById('backupModalBody');
    if (!body) return;
    const { code, parts } = await createProgressBackupParts();
    currentBackup = { code, parts, isSegmented: parts.length > 1 };
    // 单码模式（未超长）：与原有行为一致
    if (!currentBackup.isSegmented) {
        body.innerHTML =
            '<textarea id="backupCodeArea" readonly class="backup-code-area">' + escapeHtml(code) + '</textarea>' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">' +
            '<button type="button" class="btn btn--primary btn--sm" onclick="copyBackupCode()">复制备份码</button>' +
            '<button type="button" class="btn btn--ghost btn--sm" onclick="renderBackupChoice()">返回</button></div>' +
            '<div id="backupCodeMsg" style="margin-top:10px;"></div>';
        const ta = document.getElementById('backupCodeArea');
        if (ta) { ta.focus(); ta.select(); }
        return;
    }
    // 分段模式：每一段分别复制、分别发送（每段都低于聊天软件单条消息上限）
    const total = parts.length;
    const fileStrong = total >= PARTS_FILE_STRONGLY_RECOMMEND;
    let note;
    if (fileStrong) {
        note = '当前备份数据较大，已自动分成 ' + total + ' 段。\n\n为了避免逐段发送带来的不便，建议优先使用“保存备份文件”进行跨设备传输。\n\n如果仍需通过聊天工具传输，请将每一段分别发送。收到全部分段后，再一起粘贴到恢复框即可。';
    } else if (total >= PARTS_FILE_RECOMMEND) {
        note = '备份数据较多，已自动分成 ' + total + ' 段。\n\n由于聊天工具可能限制单条消息长度，请将每一段分别发送。也建议使用“保存备份文件”进行更方便的跨设备传输和长期保存。';
    } else {
        note = '备份码较长，已自动分成 ' + total + ' 段。\n\n部分聊天工具可能限制单条消息长度，因此请将每一段分别发送到目标设备。\n\n收到全部分段后，再将它们一起粘贴到网站恢复框中即可。网站会自动识别并恢复。';
    }
    let blocks = '';
    for (let i = 0; i < total; i++) {
        blocks +=
            '<div style="margin-top:12px;">' +
            '<div style="font-size:0.9em;color:var(--text-muted);margin-bottom:4px;">第 ' + (i + 1) + ' 段 / 共 ' + total + ' 段</div>' +
            '<textarea readonly class="backup-code-area" style="min-height:90px;max-height:140px;">' + escapeHtml(parts[i]) + '</textarea>' +
            '<div style="margin-top:6px;"><button type="button" class="btn btn--primary btn--sm" onclick="copyBackupPart(' + i + ')">复制第 ' + (i + 1) + ' 段</button></div>' +
            '</div>';
    }
    const fileBtn = '<button type="button" class="' + (fileStrong ? 'btn btn--primary btn--sm' : 'btn btn--ghost btn--sm') +
        '" style="' + (fileStrong ? 'background:var(--accent);' : '') + '" onclick="saveBackupFile()">' +
        (fileStrong ? '推荐：保存备份文件' : '保存备份文件') + '</button>';
    body.innerHTML =
        '<div class="form-hint" style="margin:0 0 6px;white-space:pre-line;">' + escapeHtml(note) + '</div>' +
        '<div id="backupCodeMsg" style="margin-top:8px;"></div>' +
        blocks +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;">' +
        fileBtn +
        '<button type="button" class="btn btn--ghost btn--sm" onclick="renderBackupChoice()">返回</button>' +
        '</div>';
}

// 根据备份码字符长度给出可选提示（不阻止复制），用于规避聊天软件消息长度截断
function sizeHintHtml(code) {
    const level = getBackupSizeLevel(code);
    if (level === 'ok') return '';
    if (level === 'warn') {
        return '<div class="form-hint" style="margin:0;">当前备份码较长，直接发送到聊天软件可能存在长度限制。建议使用「保存备份文件」长期保存。</div>';
    }
    return '<div class="form-hint" style="margin:0;">当前备份码较长，不建议直接粘贴到聊天消息中。建议使用「保存备份文件」进行跨设备传输。</div>';
}

export function copyBackupCode() {
    const ta = document.getElementById('backupCodeArea');
    const msg = document.getElementById('backupCodeMsg');
    const code = ta ? ta.value : '';
    if (!code) return;
    // 诊断：记录本次复制的备份码摘要（仅内存，不写 localStorage、不上传）
    rememberGeneratedCode(code);
    sha256Hex(code).catch(() => {});
    const done = () => {
        const success = currentBackup.isSegmented
            ? '<div class="result-box success" style="margin:0;">已复制全部 ' + currentBackup.parts.length + ' 段备份码<br>请一起发送到微信、QQ、邮箱或保存到备忘录。</div>'
            : '<div class="result-box success" style="margin:0;">已复制备份码<br>可发送到微信、QQ、邮箱或保存到备忘录。</div>';
        const hint = currentBackup.isSegmented
            ? '<div class="form-hint" style="margin:0;">已自动分成 ' + currentBackup.parts.length + ' 段，请全部发送。若某一段丢失将无法恢复。</div>'
            : sizeHintHtml(code);
        if (msg) msg.innerHTML = success + hint;
        verifyClipboard(code, success + hint);
    };
    const fallback = () => {
        if (ta) { ta.removeAttribute('readonly'); ta.focus(); ta.select(); document.execCommand('copy'); ta.setAttribute('readonly', ''); }
        if (msg) msg.innerHTML = '<div class="form-hint" style="margin:0;">已选中备份码，请长按复制，或按 Ctrl/⌘ + C 复制。</div>';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, fallback);
    } else { fallback(); }
}

// 复制单条分段（TCM1P）：仅把 currentBackup.parts[index] 写入剪贴板，不复制其他分段。
export function copyBackupPart(index) {
    const parts = currentBackup.parts;
    if (!parts || index < 0 || index >= parts.length) return;
    const part = parts[index];
    const msg = document.getElementById('backupCodeMsg');
    rememberGeneratedCode(part);
    sha256Hex(part).catch(() => {});
    const success = '<div class="result-box success" style="margin:0;">第 ' + (index + 1) + ' 段已复制<br>请将这一段单独发送到目标设备。</div>';
    const done = () => { if (msg) msg.innerHTML = success; verifyClipboard(part, success); };
    const fallback = () => {
        // 分段模式下每个段对应一个只读 textarea（按出现顺序）
        const tas = document.querySelectorAll('textarea.backup-code-area');
        const ta = tas[index];
        if (ta) { ta.removeAttribute('readonly'); ta.focus(); ta.select(); document.execCommand('copy'); ta.setAttribute('readonly', ''); }
        if (msg) msg.innerHTML = '<div class="form-hint" style="margin:0;">已选中本段，请长按复制，或按 Ctrl/⌘ + C 复制。</div>';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(part).then(done, fallback);
    } else { fallback(); }
}

// 复制后尽力回读剪贴板做一致性校验（浏览器可能拒绝读权限，拒绝则忽略，不阻塞）
function verifyClipboard(code, successHtml) {
    if (!navigator.clipboard || !navigator.clipboard.readText) return;
    navigator.clipboard.readText().then(text => {
        if (typeof text !== 'string') return;
        // 与恢复端共用同一套规范化规则，确保复制端与恢复端判断一致
        const norm = normalizeBackupInput(text);
        const msg = document.getElementById('backupCodeMsg');
        if (norm && norm !== code && msg) {
            msg.innerHTML = successHtml +
                '<div class="form-hint" style="margin-top:8px;">剪贴板内容可能发生变化，请使用下方备份码手动复制。</div>';
        }
    }).catch(() => {});
}

export function saveBackupFile() { exportProgress(); }

/* ===================== 恢复学习进度 模态框 ===================== */
export function openRestoreChoice() {
    openImportModal();
    const body = document.getElementById('importModalBody');
    if (!body) return;
    body.innerHTML =
        '<div class="backup-options">' +
        '<button type="button" class="backup-option" style="border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb, var(--accent) 16%, transparent);" onclick="triggerFileRestore()">' +
            '<span style="display:inline-block;background:var(--accent);color:#fff;font-size:0.72em;font-weight:700;line-height:1;padding:3px 9px;border-radius:999px;margin-bottom:8px;">推荐</span>' +
            '<div class="backup-option-title">从备份文件恢复</div>' +
            '<div class="backup-option-desc">适合换设备、大量学习记录和长期保存。</div>' +
        '</button>' +
        '<button type="button" class="backup-option" onclick="startCodeRestore()">' +
            '<div class="backup-option-title">使用备份码恢复</div>' +
            '<div class="backup-option-desc">快速跨设备恢复，备份码较长时会自动支持分段。</div>' +
        '</button>' +
        '</div>' +
        '<p class="form-hint" style="margin:14px 2px 0;font-size:0.85em;line-height:1.6;">提示：备份文件通常更方便、可靠；若暂时没有备份文件，也可以使用备份码恢复。</p>';
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
    // 比较原始码与粘贴码的“第一处差异”，帮助判断传输是否改动了字符。跨设备场景依赖 Console 诊断。
    const lastCode = getLastGeneratedBackupCode();
    if (lastCode) {
        console.log('[TCM Backup Debug]', JSON.stringify({ stage: 'same-device-diff', ...diagnoseFirstDiff(lastCode, pasted) }));
    }
    const res = await parseProgressBackupCode(pasted);
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

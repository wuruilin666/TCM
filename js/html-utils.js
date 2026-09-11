/* ===================== HTML 与字符串通用工具（纯函数，无状态 / 无副作用） =====================
 * 从 data.js 拆出：这些是跨模块共用的通用工具，不属于「病例数据」职责。
 * 使用者：game / case-bank / storage(backup-service)
 * ================================================================================== */

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

export function escapeHtmlWithBreaks(value) {
    return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

export function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

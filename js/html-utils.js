/* ===================== 通用 HTML / 字符串工具 =====================
 * 纯函数，无依赖。任何需要转义或字符串校验的模块都可以复用，
 * 避免把这类通用工具塞进业务模块（原先寄生在 data.js）。
 * ============================================================== */

export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export function escapeHtmlWithBreaks(s) {
    return escapeHtml(s).replace(/\n/g, '<br>');
}

export function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

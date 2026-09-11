/* ===================== 学习进度存储（基础设施，唯一负责 localStorage 读写） =====================
 * 职责：
 *   - 已完成病例的读取 / 标记
 *   - 错题记录的读取 / 保存 / 删除 / 清空
 *   - 学习进度重置
 *   - 存储文本的长度截断（sanitize）
 *
 * 禁止：
 *   - 备份编码（TCM1 / gzip / Base64URL）
 *   - 弹窗与任何 DOM 操作
 *   - alert / confirm
 *   - 页面导航
 *
 * 本模块是 localStorage 的唯一所有者：其它模块不得自行读写这两个 key。
 * ================================================================================== */

import { isSafeCaseId, diffMap, MAX_STORED_TEXT_LENGTH } from '../data.js';

export const COMPLETED_CASES_KEY = 'tcm_completed_cases';
export const WRONG_CASES_KEY = 'tcm_wrong_cases';

/* ===================== 底层读写 ===================== */
// 读取 JSON。只有「key 不存在」与「内容不是合法 JSON」两种已定义情况返回 fallback，
// 其余异常（如 localStorage 被禁用导致 SecurityError）向上抛出，不隐藏。
function readJson(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    try {
        return JSON.parse(raw);
    } catch (e) {
        throw new Error(`本地存储 ${key} 内容不是合法 JSON，无法解析`);
    }
}

function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

/* ===================== 文本截断 ===================== */
export function sanitizeStoredText(value, maxLength = MAX_STORED_TEXT_LENGTH) {
    return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

/* ===================== 已完成病例 ===================== */
export function getCompletedCases() {
    const value = readJson(COMPLETED_CASES_KEY, []);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(isSafeCaseId))].slice(0, 1000);
}

export function markCaseCompleted(caseId) {
    const arr = getCompletedCases();
    if (arr.includes(caseId)) return;
    arr.push(caseId);
    writeJson(COMPLETED_CASES_KEY, arr);
}

/* ===================== 错题记录 ===================== */
export function getWrongCases() {
    const value = readJson(WRONG_CASES_KEY, []);
    if (!Array.isArray(value)) return [];
    return value.filter(w => w && isSafeCaseId(w.id)).slice(-1000).map(w => ({
        id: w.id,
        title: sanitizeStoredText(w.title, 200),
        chiefComplaint: sanitizeStoredText(w.chiefComplaint),
        difficulty: diffMap[w.difficulty] ? w.difficulty : '',
        date: sanitizeStoredText(w.date, 40),
        syndrome: sanitizeStoredText(w.syndrome, 200),
        disease: sanitizeStoredText(w.disease, 200),
        basis: sanitizeStoredText(w.basis)
    }));
}

// 保存错题：按病例 ID 覆盖旧记录（同一病例只保留最近一次错误）。
// caseObj / difficulty 由调用方（Game）传入，避免 Storage 反向依赖 Domain。
export function saveWrongCase(data, caseObj, difficulty) {
    if (!caseObj) throw new Error('saveWrongCase 需要 caseObj');
    const wrongs = getWrongCases().filter(w => w.id !== caseObj.id);
    wrongs.push({
        id: caseObj.id,
        title: sanitizeStoredText(caseObj.title, 200),
        chiefComplaint: sanitizeStoredText(caseObj.chiefComplaint),
        difficulty,
        date: new Date().toISOString(),
        syndrome: sanitizeStoredText(data.syndrome, 200),
        disease: sanitizeStoredText(data.disease, 200),
        basis: sanitizeStoredText(data.basis)
    });
    writeJson(WRONG_CASES_KEY, wrongs);
}

export function removeWrongCase(caseId) {
    writeJson(WRONG_CASES_KEY, getWrongCases().filter(w => w.id !== caseId));
}

export function clearWrongCases() {
    writeJson(WRONG_CASES_KEY, []);
}

/* ===================== 整体替换 / 清空（供备份恢复使用） ===================== */
// 覆盖导入：依次写入两份数据，不做回滚。
// localStorage 没有事务语义，若第二次写入失败，会留下
// 「完成记录已更新、错题仍是旧的」这种前后不一致的状态。
export function replaceProgress({ completedCases, wrongCases }) {
    writeJson(COMPLETED_CASES_KEY, completedCases);
    writeJson(WRONG_CASES_KEY, wrongCases);
}

export function mergeProgress({ completedCases, wrongCases }) {
    const mergedCompleted = [...new Set(getCompletedCases().concat(completedCases))].slice(0, 1000);
    writeJson(COMPLETED_CASES_KEY, mergedCompleted);
    writeJson(WRONG_CASES_KEY, mergeWrongCases(getWrongCases(), wrongCases));
}

// 错题去重依据：病例 ID + 日期 + 用户答案（证型/病名/辨证依据）
// 分隔符沿用重构前的原始实现，是 DEL 控制字符 U+007F。
// 必须写成 \u007f 转义形式，不能写成肉眼不可见的字面字符——
// 那个字符正是上一轮重构中被悄悄丢掉、导致 key 变成直接拼接的原因。
function wrongKey(w) {
    return [w.id, w.date, w.syndrome || '', w.disease || '', w.basis || ''].join('\u007f');
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

export function clearAllProgress() {
    writeJson(COMPLETED_CASES_KEY, []);
    writeJson(WRONG_CASES_KEY, []);
}

/* ===================== 统计 ===================== */
// 纯统计：输入已加载病例总数，返回进度概览。不含任何 DOM。
export function getProgressSummary(totalCaseCount) {
    const done = getCompletedCases().length;
    const wrong = getWrongCases().length;
    return {
        total: totalCaseCount,
        done,
        wrong,
        remaining: Math.max(0, totalCaseCount - done),
        percent: totalCaseCount ? Math.round(done / totalCaseCount * 100) : 0
    };
}

/* ===================== 日期格式化 ===================== */
export function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

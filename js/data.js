/* ===================== 病例数据规则（数据定义 / 加载 / 校验，纯逻辑） =====================
 * 本模块负责：
 *   - 病例数据的元信息映射（难度、分类、舌象图片路径）
 *   - 病例数据的校验契约
 *   - 病例 JSON 的按难度加载与合并
 *
 * 不负责：通用 HTML 工具（已拆到 html-utils.js）、游戏状态、DOM、localStorage。
 * ================================================================================== */

import { isNonEmptyString } from './html-utils.js';

/* ===================== 数据源配置 ===================== */
export const caseDiffFiles = {
    basic: 'data/cases/basic.json',
    intermediate: 'data/cases/intermediate.json',
    advanced: 'data/cases/advanced.json'
};

// 训练阶段映射：代码 -> {名称}
export const diffMap = {
    'basic': { name: '入门训练' },
    'intermediate': { name: '综合训练' },
    'advanced': { name: '临床思维' }
};

export const diffOrder = ['basic', 'intermediate', 'advanced'];

// 一级分类映射：代码 -> {名称}
export const categoryMap = {
    'all': { name: '全部病例' },
    'pulmonary': { name: '肺系病证' },
    'heart': { name: '心系病证' },
    'spleen_stomach': { name: '脾胃系病证' },
    'liver_gallbladder': { name: '肝胆系病证' },
    'kidney': { name: '肾系病证' },
    'qi_blood_fluid': { name: '气血津液病证' },
    'limb_meridian': { name: '肢体经络病证' },
    'gynecology': { name: '妇科病证' },
    'pediatrics': { name: '儿科病证' },
    'surgery_dermatology': { name: '外科/皮肤科病证' },
    'ent': { name: '五官病证' }
};

// 舌象图片来源标注：仅用于页面角标文案，不代表病例数据的正确性判断。
// 病例的舌象判断契约由 case.clues.inspection.tongueJudgment 显式定义，见 inspection.js。
export const tongueImageTypeMap = {
    'basic-001': '参考图', 'inter-001': '参考图', 'inter-002': '参考图', 'inter-003': '参考图',
    'inter-004': '参考图', 'inter-005': '参考图', 'adv-001': '参考图', 'basic-004': '参考图'
};

// 望诊图片校验用的文件名规则
const TONGUE_IMAGE_RE = /^tongue\/[\w-]+\.jpg$/;


/* ===================== 病例校验契约 ===================== */
export const SAFE_CASE_ID = /^[a-z]+-\d{3}$/;
export const MAX_STORED_TEXT_LENGTH = 2000;

export function isSafeCaseId(value) {
    return typeof value === 'string' && SAFE_CASE_ID.test(value);
}

/* ===================== 望诊图片路径解析 ===================== */
// 舌象图片路径的唯一解析入口：病例显式配置的 inspectionImages 优先，
// 没有配置时按约定回退到 tongue/<caseId>.jpg（仓库里的图片就是这么放的）。
// 返回新数组，调用方拿到的是副本，改不到病例数据本身。
// 病例 ID 不合法时返回空数组——绝不拿它去拼路径。
export function getInspectionImages(caseData) {
    const explicit = caseData?.inspectionImages;
    if (Array.isArray(explicit) && explicit.length > 0) return [...explicit];
    if (!isSafeCaseId(caseData?.id)) return [];
    return [`tongue/${caseData.id}.jpg`];
}

/* 问诊维度白名单：每道问诊题必须标注唯一主维度，且必须属于该集合。
   新增病例时若缺少 dimension 或使用未登记的维度，病例数据将被判定为无效。 */
export const VALID_INQUIRY_DIMENSIONS = new Set([
    'chillHeat', 'sweat', 'diet', 'sleep', 'stool', 'urine', 'emotion', 'thirst',
    'pain', 'head', 'breath', 'face', 'energy', 'menstruation', 'women', 'nose',
    'throat', 'chest', 'abdomen', 'vomiting', 'sexual', 'skin', 'ear', 'back',
    'palpitation', 'seizure', 'onset', 'frequency', 'check', 'treatment', 'neck',
    'limb', 'eye', 'tongue', 'oral', 'general'
]);

// intent 是问诊语义匹配的数据契约字段：允许单个非空字符串，
// 也允许多个意图的非空字符串数组（与 inquiry-matcher 的 questionIntents 一致）。
export function isValidIntent(value) {
    if (isNonEmptyString(value)) return true;
    return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

export function isValidInquiryQuestion(q) {
    return !!q
        && isNonEmptyString(q.q)
        && isNonEmptyString(q.a)
        && Array.isArray(q.keywords)
        && q.keywords.length > 0
        && q.keywords.every(isNonEmptyString)
        && isNonEmptyString(q.dimension)
        && VALID_INQUIRY_DIMENSIONS.has(q.dimension.trim())
        && isValidIntent(q.intent);
}

// 校验单个病例。返回病例本身；不合法时抛出带病例 ID 的明确错误。
export function validateCase(c) {
    if (!c || !isSafeCaseId(c.id)) throw new Error('病例 ID 无效：' + (c && c.id));
    if (!isNonEmptyString(c.title) || !isNonEmptyString(c.chiefComplaint) || !categoryMap[c.category] || !diffMap[c.difficulty]) {
        throw new Error(`病例 ${c.id} 缺少基础字段`);
    }
    const clues = c.clues;
    if (!clues || !['inspection', 'auscultation', 'pulse'].every(key => clues[key] && isNonEmptyString(clues[key].displayTitle) && isNonEmptyString(clues[key].displayContent) && isNonEmptyString(clues[key].textSummary))) {
        throw new Error(`病例 ${c.id} 的四诊字段无效`);
    }
    if (!clues.inquiry || !Array.isArray(clues.inquiry.questions) || clues.inquiry.questions.length === 0 || !clues.inquiry.questions.every(isValidInquiryQuestion)) {
        throw new Error(`病例 ${c.id} 的问诊字段无效（每题必须含 q / a / keywords / 合法 dimension / 非空 intent）`);
    }
    const answer = c.correctAnswer, analysis = c.fullAnalysis;
    if (!answer || !['disease', 'syndrome', 'westernDiagnosis'].every(key => isNonEmptyString(answer[key]))) {
        throw new Error(`病例 ${c.id} 的答案字段无效`);
    }
    if (!analysis || !['disease', 'syndrome', 'westernDiagnosis', 'pathogenesis', 'prescription'].every(key => isNonEmptyString(analysis[key]))
        || !Array.isArray(analysis.knowledgePoints) || !analysis.knowledgePoints.every(isNonEmptyString)) {
        throw new Error(`病例 ${c.id} 的解析字段无效`);
    }
    if (c.inspectionImages !== undefined) {
        if (!Array.isArray(c.inspectionImages) || c.inspectionImages.length === 0
            || !c.inspectionImages.every(path => typeof path === 'string' && TONGUE_IMAGE_RE.test(path))) {
            throw new Error(`病例 ${c.id} 的望诊图片路径无效（应为 tongue/xxx.jpg 数组）`);
        }
    }
    return c;
}

// 校验一份难度文件。返回其中的病例数组；不合法时抛出错误。
// 注意：结构错误必须暴露，不能静默跳过病例——静默跳过会让题库「少一例」而无人察觉。
export function validateCaseFile(data, diff) {
    if (!data || !Array.isArray(data.cases) || data.cases.length === 0) {
        throw new Error(`病例数据 ${diff} 格式无效：缺少非空的 cases 数组`);
    }
    const ids = new Set();
    for (const c of data.cases) {
        validateCase(c);
        if (ids.has(c.id)) throw new Error(`病例数据 ${diff} 存在重复 ID：${c.id}`);
        ids.add(c.id);
    }
    return data.cases;
}

/* ===================== 病例加载 ===================== */
// 按难度缓存已加载病例：一份数据只请求一次。
const casesByDiff = new Map();

// 按难度加载并缓存病例；文件不存在或数据非法时抛错，由调用方决定如何呈现失败。
export async function loadCasesByDifficulty(diff) {
    if (casesByDiff.has(diff)) return casesByDiff.get(diff);
    const file = caseDiffFiles[diff];
    if (!file) throw new Error('未知的训练阶段：' + diff);
    const r = await fetch(file);
    if (!r.ok) throw new Error(`病例数据加载失败：${diff}（HTTP ${r.status}）`);
    const cases = validateCaseFile(await r.json(), diff);
    casesByDiff.set(diff, cases);
    return cases;
}

// 加载全部难度病例，返回扁平数组（顺序：basic → intermediate → advanced）
export async function loadAllCases() {
    const lists = [];
    for (const diff of diffOrder) lists.push(await loadCasesByDifficulty(diff));
    return lists.flat();
}

// 已加载病例的读取入口（同步）。未加载完成时返回空数组，由启动流程保证先加载后使用。
export function getAllCases() {
    const lists = [];
    for (const diff of diffOrder) {
        const cached = casesByDiff.get(diff);
        if (cached) lists.push(...cached);
    }
    return lists;
}

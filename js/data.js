/* ===================== 数据与配置（纯数据，无 DOM / 无游戏状态） ===================== */
// 本模块仅负责：病例数据的定义、加载、校验、安全输出工具，以及各类映射表。

export let casesDB = null;
export let caseIndex = null;   // 病例索引（轻量：id/title/主诉/分类/难度），用于快速展示

export const caseDiffFiles = {
    basic: 'data/cases/basic.json',
    intermediate: 'data/cases/intermediate.json',
    advanced: 'data/cases/advanced.json'
};

export const tongueImages = {
    'basic-001': 'tongue/basic-001.jpg',
    'basic-002': 'tongue/basic-002.jpg',
    'inter-001': 'tongue/inter-001.jpg',
    'inter-002': 'tongue/inter-002.jpg',
    'inter-003': 'tongue/inter-003.jpg',
    'inter-004': 'tongue/inter-004.jpg',
    'inter-005': 'tongue/inter-005.jpg',
    'inter-006': 'tongue/inter-006.jpg',
    'inter-007': 'tongue/inter-007.jpg',
    'inter-008': 'tongue/inter-008.jpg',
    'adv-001': 'tongue/adv-001.jpg',
    'adv-002': 'tongue/adv-002.jpg',
    'adv-003': 'tongue/adv-003.jpg',
    'adv-004': 'tongue/adv-004.jpg',
    'adv-005': 'tongue/adv-005.jpg',
    'adv-006': 'tongue/adv-006.jpg',
    'adv-007': 'tongue/adv-007.jpg',
};

export const tongueImageTypeMap = {
    'basic-001': '参考图', 'inter-001': '参考图', 'inter-002': '参考图', 'inter-003': '参考图', 'inter-004': '参考图', 'inter-005': '参考图', 'adv-001': '参考图'
};

// 一级分类映射：代码 -> {名称, emoji}
export const categoryMap = {
    'all': { name: '全部病例', emoji: '📂' },
    'pulmonary': { name: '肺系病证', emoji: '🌬' },
    'heart': { name: '心系病证', emoji: '❤' },
    'spleen_stomach': { name: '脾胃系病证', emoji: '🥣' },
    'liver_gallbladder': { name: '肝胆系病证', emoji: '🫁' },
    'kidney': { name: '肾系病证', emoji: '💧' },
    'qi_blood_fluid': { name: '气血津液病证', emoji: '🌡' },
    'limb_meridian': { name: '肢体经络病证', emoji: '🦴' },
    'gynecology': { name: '妇科病证', emoji: '👩' },
    'pediatrics': { name: '儿科病证', emoji: '👶' },
    'surgery_dermatology': { name: '外科/皮肤科病证', emoji: '🧴' },
    'ent': { name: '五官病证', emoji: '👁' }
};

// 训练阶段映射：代码 -> {名称, emoji}
export const diffMap = {
    'basic': { name: '入门训练', emoji: '🌱' },
    'intermediate': { name: '综合训练', emoji: '🌿' },
    'advanced': { name: '临床思维', emoji: '🌳' }
};

export const diffOrder = ['basic', 'intermediate', 'advanced'];

/* ===================== 数据与输出安全 ===================== */
export const SAFE_CASE_ID = /^[a-z]+-\d{3}$/;
export const MAX_STORED_TEXT_LENGTH = 2000;

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
export function escapeHtmlWithBreaks(value) { return escapeHtml(value).replace(/\r?\n/g, '<br>'); }
export function isNonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
export function isSafeCaseId(value) { return typeof value === 'string' && SAFE_CASE_ID.test(value); }

export function validateCaseData(data) {
    if (!data || !Array.isArray(data.cases) || data.cases.length === 0) throw new Error('病例数据格式无效');
    const ids = new Set();
    for (const c of data.cases) {
        if (!c || !isSafeCaseId(c.id) || ids.has(c.id)) throw new Error('病例 ID 无效或重复');
        ids.add(c.id);
        if (!isNonEmptyString(c.title) || !isNonEmptyString(c.chiefComplaint) || !categoryMap[c.category] || !diffMap[c.difficulty]) throw new Error(`病例 ${c.id} 缺少基础字段`);
        const clues = c.clues;
        if (!clues || !['inspection', 'auscultation', 'pulse'].every(key => clues[key] && isNonEmptyString(clues[key].displayTitle) && isNonEmptyString(clues[key].displayContent) && isNonEmptyString(clues[key].textSummary))) throw new Error(`病例 ${c.id} 的四诊字段无效`);
        if (!clues.inquiry || !Array.isArray(clues.inquiry.questions) || clues.inquiry.questions.length === 0 || !clues.inquiry.questions.every(q => q && isNonEmptyString(q.q) && isNonEmptyString(q.a) && Array.isArray(q.keywords) && q.keywords.every(isNonEmptyString))) throw new Error(`病例 ${c.id} 的问诊字段无效`);
        const answer = c.correctAnswer, analysis = c.fullAnalysis;
        if (!answer || !['disease', 'syndrome', 'westernDiagnosis'].every(key => isNonEmptyString(answer[key])) || !analysis || !['disease', 'syndrome', 'westernDiagnosis', 'pathogenesis', 'prescription'].every(key => isNonEmptyString(analysis[key])) || !Array.isArray(analysis.knowledgePoints) || !analysis.knowledgePoints.every(isNonEmptyString)) throw new Error(`病例 ${c.id} 的答案或解析字段无效`);
        if (c.inspectionImages && (!Array.isArray(c.inspectionImages) || !c.inspectionImages.every(path => typeof path === 'string' && /^tongue\/[\w-]+\.jpg$/.test(path)))) throw new Error(`病例 ${c.id} 的图片路径无效`);
    }
    return data;
}

/* ===================== 数据加载（拆分 + 按需） ===================== */
// 按难度加载完整病例文件（缓存，避免重复请求）
export const _fullCache = {};

export async function ensureDiffLoaded(diff) {
    if (_fullCache[diff]) return _fullCache[diff];
    const file = caseDiffFiles[diff];
    if (!file) return [];
    const r = await fetch(file);
    if (!r.ok) throw new Error('病例数据加载失败：' + diff);
    const data = await r.json();
    _fullCache[diff] = (data.cases || []).map(validateCaseDataSafe);
    return _fullCache[diff];
}

// 对单个病例做基本字段校验（复用 validateCaseData 的规则，失败则跳过该例）
export function validateCaseDataSafe(c) {
    try { validateCaseData({ cases: [c] }); return c; }
    catch (e) { console.warn('跳过无效病例:', c && c.id, e.message); return null; }
}

// 把已加载的完整病例合并进 casesDB.cases（保持 getAllCases 兼容）
export function mergeLoadedCases() {
    const list = [];
    for (const diff of Object.keys(caseDiffFiles)) {
        if (_fullCache[diff]) list.push(..._fullCache[diff].filter(Boolean));
    }
    casesDB = casesDB || {};
    casesDB.cases = list;
}

export async function loadCaseData(initCallback) {
    try {
        // 1) 先加载轻量索引，首页可立即展示
        const idxResp = await fetch('data/case-index.json');
        if (!idxResp.ok) throw new Error('病例数据加载失败');
        const idx = await idxResp.json();
        caseIndex = idx.cases || [];
        // 2) 并行加载各难度完整病例，合入 casesDB
        await Promise.all(Object.keys(caseDiffFiles).map(diff => ensureDiffLoaded(diff)));
        mergeLoadedCases();
        document.getElementById('loadingIndicator').style.display = 'none';
        if (typeof initCallback === 'function') initCallback();
    } catch (error) {
        console.error('加载病例数据出错:', error);
        document.getElementById('loadingIndicator').textContent = '❌ 病例数据加载失败，请刷新重试';
    }
}

// 供其它模块使用：获取全部已加载病例
export function getAllCases() { return (casesDB && casesDB.cases) ? casesDB.cases : []; }

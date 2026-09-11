/* ===================== 舌象判断（纯逻辑 Domain） =====================
 * 职责：把学习者的自由文本舌象描述，与病例的 tongueJudgment 三个维度
 * （color 舌色 / shape 舌形 / coating 舌苔）做比对，判断是否算「判断正确」。
 *
 * 判定规则（与原有实现一致）：
 *   - 三个维度中至少命中 2 个，且至少命中 1 个，才算正确；
 *   - 维度值为「正常 / 无异常 / …」时，要求用户文本出现同类正常表述；
 *   - 否则允许「去舌/苔前缀后整体包含」或「任意连续两字命中」，容忍措辞差异。
 *
 * 不含 DOM、window、fetch、localStorage，不 import 任何其他模块。
 * ==================================================================== */

// 「正常」类表述：病例写“正常”时，用户写“正常/无异常”等即算命中该维度
const NORMAL_RE = /正常|无异常|无明显异常|未见异常|无特殊/;

// 去掉舌象术语的前缀，便于用「包含」判断（舌质淡红 / 苔薄白 → 淡红 / 薄白）
function stripPrefix(s) {
    return String(s).replace(/^舌(质|体|色|形|苔)?/, '').replace(/^苔/, '');
}

// 单维度比对：整体包含，或任意连续两字命中（容忍顺序与措辞差异）
function matchTerm(userText, correctVal) {
    if (!correctVal) return false;
    const cc = stripPrefix(correctVal);
    if (!cc) return false;
    if (userText.includes(cc)) return true;
    // 两个字符起才谈「连续两字」；窗口起点最多到倒数第二位，
    // 否则末尾会退化成一个单字（"淡红" 的 "红"）冒充两字命中。
    if (cc.length < 2) return false;
    for (let i = 0; i < cc.length - 1; i++) {
        if (userText.includes(cc.slice(i, i + 2))) return true;
    }
    return false;
}

function hitDimension(userText, correctVal) {
    if (!correctVal) return false;
    if (NORMAL_RE.test(correctVal)) return NORMAL_RE.test(userText);
    return matchTerm(userText, correctVal);
}

/*
 * @param {object} tongueJudgment 病例的 clues.inspection.tongueJudgment（{color, shape, coating}）
 * @param {string} userText       学习者的舌象描述
 * @returns {boolean} 是否判断正确
 */
export function judgeTongue(tongueJudgment, userText) {
    if (!userText || !tongueJudgment) return false;
    const u = String(userText).replace(/\s+/g, '');
    const colorOk = hitDimension(u, tongueJudgment.color);
    const shapeOk = hitDimension(u, tongueJudgment.shape);
    const coatingOk = hitDimension(u, tongueJudgment.coating);
    const hitCount = (colorOk ? 1 : 0) + (shapeOk ? 1 : 0) + (coatingOk ? 1 : 0);
    return hitCount >= 2;
}

/*
 * 参考答案文本：优先用病例自带的 tongueDesc 原文，不自行补充病例未提及的内容；
 * 没有 tongueDesc 时才由三个维度拼出一句，缺失维度标注「未述」。
 */
export function describeTongueReference(inspection) {
    if (!inspection) return '';
    const desc = (inspection.tongueDesc || '').trim();
    if (desc) return desc;
    const tj = inspection.tongueJudgment || {};
    return `舌色${tj.color || '未述'}，舌苔${tj.coating || '未述'}`;
}

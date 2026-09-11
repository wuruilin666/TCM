/* ===================== 舌象判断（纯逻辑 Domain） =====================
 * 职责：把学习者的自由文本舌象描述，与病例的结构化舌象字段做比对，
 * 给出"判断正确 / 判断有偏差"的结论与参考答案。
 *
 * 不含 DOM、window、fetch、localStorage。
 * ==================================================================== */

/* 三个维度：舌质颜色、苔色、苔质。命中 >= 2 维即算判断正确（且至少命中 1 维）。 */
const TONGUE_DIMENSIONS = Object.freeze([
    { key: 'color', label: '舌质', fields: ['tongueColor', 'tongueColorDesc'] },
    { key: 'coatingColor', label: '苔色', fields: ['coatingColor', 'coatingColorDesc'] },
    { key: 'coatingTexture', label: '苔质', fields: ['coatingTexture', 'coatingTextureDesc'] }
]);

function hitDimension(judgment, userText) {
    return TONGUE_DIMENSIONS.some(dim => {
        const vals = dim.fields.map(f => judgment?.[f]).filter(v => typeof v === 'string' && v.length > 0);
        return vals.some(v => userText.includes(v));
    });
}

/*
 * @param {object} tongueJudgment 病例的 clues.inspection.tongueJudgment
 * @param {string} userText       学习者的舌象描述
 * @returns { detail } 不含 DOM，由调用方决定如何展示
 */
export function judgeTongue(tongueJudgment, userText) {
    const text = (userText || '').trim();
    if (!text) return { correct: false, hitCount: 0, total: TONGUE_DIMENSIONS.length, reason: '未填写舌象判断' };

    const hitCount = TONGUE_DIMENSIONS.filter(dim => hitDimension({ [dim.fields[0]]: tongueJudgment?.[dim.fields[0]], [dim.fields[1]]: tongueJudgment?.[dim.fields[1]] }, text)).length;
    const correct = hitCount >= 2;
    return {
        correct,
        hitCount,
        total: TONGUE_DIMENSIONS.length,
        reason: correct ? '判断正确' : '判断有偏差'
    };
}

/* 参考答案文本：优先用病例自带的 tongueDesc 原文，
 * 没有时才由结构化字段拼出一句，避免凭空编造。 */
export function describeTongueReference(inspection) {
    if (!inspection) return '';
    if (typeof inspection.tongueDesc === 'string' && inspection.tongueDesc.trim()) {
        return inspection.tongueDesc.trim();
    }
    const j = inspection.tongueJudgment || {};
    const parts = [
        j.tongueColor,
        j.tongueColorDesc,
        j.coatingColor,
        j.coatingColorDesc,
        j.coatingTexture,
        j.coatingTextureDesc
    ].filter(v => typeof v === 'string' && v.trim().length > 0);
    return parts.length ? parts.join('，') : '';
}

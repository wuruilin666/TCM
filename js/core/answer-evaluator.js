/* ===================== 答案判定（纯逻辑 Domain） =====================
 * 职责：只根据 correctAnswer 契约与用户输入，判断"正确 / 部分正确 / 错误"。
 *
 * 不含 DOM、window、fetch、localStorage，不 import 任何其他模块。
 * 病例差异通过数据（correctAnswer.syndromeMatches）表达，
 * 不在此处按病例 ID 或证型名做特判。
 * ================================================================== */

export const ANSWER_RESULT = Object.freeze({
    CORRECT: 'correct',
    PARTIAL: 'partial',
    WRONG: 'wrong'
});

/* 病名判定：用户输入包含标准病名，或标准病名包含用户输入（允许简写） */
export function isDiseaseCorrect(correctDisease, userDisease) {
    const std = (correctDisease || '').trim();
    const usr = (userDisease || '').trim();
    if (!std || !usr) return false;
    return usr.includes(std) || std.includes(usr);
}

/* 证型判定：
 * 1. 标准证型的每个关键要素（用匹配规则给出）都必须出现在用户输入中；
 * 2. 若病例提供了 syndromeMatches，则以其中的 all 数组为准；
 * 3. 否则退化为"整体包含"判定。
 * 用"要素齐全"而非"整串相等"，是为了容忍学习者书写顺序与措辞差异。 */
export function isSyndromeCorrect(correctAnswer, userSyndrome) {
    const usr = (userSyndrome || '').trim();
    if (!usr) return false;

    const rules = Array.isArray(correctAnswer?.syndromeMatches) ? correctAnswer.syndromeMatches : [];
    if (rules.length === 0) {
        const std = (correctAnswer?.syndrome || '').trim();
        if (!std) return false;
        return usr.includes(std) || std.includes(usr);
    }

    return rules.some(rule => {
        const keys = Array.isArray(rule?.all) ? rule.all : [];
        if (keys.length === 0) return false;
        return keys.every(k => usr.includes(k));
    });
}

/* 综合判定：证型为准，病名作为"部分正确"的依据 */
export function evaluateAnswer(correctAnswer, userAnswer) {
    const syndromeOk = isSyndromeCorrect(correctAnswer, userAnswer?.syndrome);
    const diseaseOk = isDiseaseCorrect(correctAnswer?.disease, userAnswer?.disease);

    if (syndromeOk) return ANSWER_RESULT.CORRECT;
    if (diseaseOk) return ANSWER_RESULT.PARTIAL;
    return ANSWER_RESULT.WRONG;
}

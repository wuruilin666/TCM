/* ===================== 答案判定（纯逻辑 Domain） =====================
 * 职责：只根据 correctAnswer 与用户输入，判断「正确 / 部分正确 / 错误」，
 * 并区分病名、证型两个子判定，供 UI 展示分项反馈。
 *
 * 判定语义（与原有实现等价）：
 *   - 病名：用户输入去掉结尾的「证」字后，被标准病名包含才算对；
 *   - 证型：满足以下任一即算对 ——
 *       · 词素规则（见下）全部命中；
 *       · 完全相等 / 标准包含用户 / 用户包含标准。
 *   - 整体正确要求病名与证型同时正确；只有其一正确为「部分正确」。
 *
 * 词素规则把原先写死在 submitAnswer 里的病例分支数据化：
 * 规则只描述「标准证型自身的词素组合」，不引用病例 ID。
 *
 * 不含 DOM、window、fetch、localStorage，不 import 任何其他模块。
 * ================================================================== */

export const ANSWER_RESULT = Object.freeze({
    CORRECT: 'correct',
    PARTIAL: 'partial',
    WRONG: 'wrong'
});

/* 病名判定：用户输入去掉结尾的「证」后，被标准病名包含即为对。
 * 注意：这是单向包含（标准 ⊇ 用户），与原有实现一致。 */
export function isDiseaseCorrect(correctDisease, userDisease) {
    if (!userDisease) return false;
    const u = String(userDisease).replace(/证$/, '');
    if (!u) return false;
    return String(correctDisease || '').includes(u);
}

/* 词素拆解规则：某些标准证型由「病机 + 病位」组合而成，
 * 学习者只写出关键病机（省略病位）时也应判对。
 * 例：标准「风热犯肺津伤」—— 用户写「风热津伤」即可（省略「犯肺」）。
 * when 描述该规则适用于哪些标准证型，all 描述用户输入必须含哪些词素。 */
const MORPHEME_RULES = [
    { when: ['风热'], all: ['风热', '津伤'] }
];

/* 证型判定：先尝试词素规则，再退回通用包含判定。 */
export function isSyndromeCorrect(correctAnswer, userSyndrome) {
    if (!userSyndrome) return false;
    const std = String(correctAnswer?.syndrome || '');
    const u = String(userSyndrome);

    for (const rule of MORPHEME_RULES) {
        if (rule.when.every(k => std.includes(k)) && rule.all.every(k => u.includes(k))) return true;
    }
    // 通用回退：完全相等 / 标准包含用户 / 用户包含标准
    return u === std || std.includes(u) || u.includes(std);
}

/* 综合判定 */
export function evaluateAnswer(correctAnswer, userAnswer) {
    const diseaseOk = isDiseaseCorrect(correctAnswer?.disease, userAnswer?.disease);
    const syndromeOk = isSyndromeCorrect(correctAnswer, userAnswer?.syndrome);

    const isCorrect = diseaseOk && syndromeOk;
    let result;
    if (isCorrect) result = ANSWER_RESULT.CORRECT;
    else if (diseaseOk || syndromeOk) result = ANSWER_RESULT.PARTIAL;
    else result = ANSWER_RESULT.WRONG;

    return { result, isCorrect, diseaseOk, syndromeOk };
}

/* ===================== 舌象判断（纯逻辑 Domain） =====================
 * 职责：把学习者的自由文本舌象描述，与病例 tongueJudgment 中**真实存在**的维度
 * （color 舌色 / shape 舌形 / coating 舌苔）做比对，给出逐维度判定与总体结论。
 *
 * 判定规则：
 *   - 病例写了哪个维度，就只考哪个维度；没写的维度 status = 'not_tested'，不进入分母。
 *   - 「未描述 ≠ 正常」：病例原文（tongueDesc）没说「正常」时，数据里的「正常」
 *     属于由缺失推断出来的值，不作为考点——否则原文只写了舌色/舌苔的病例会要求
 *     用户额外交代「舌形正常」。原文明确写了「正常」才算考点。
 *   - 用户没写到病例已提供的维度 → 'missing'（不计命中，因此整体不可能算完全正确）。
 *   - 用户写到但与本病例不符 → 'wrong'。
 *   - 「正常」类表述要排除「不正常 / 非正常」这类否定说法。
 *
 * judgeTongue(tongueJudgment, userText, referenceText) 返回：
 *   {
 *     correct: boolean|null,          // null = 本病例没有任何可考的结构化维度
 *     status: 'correct'|'partial'|'wrong'|'not_testable',
 *     matched: number, total: number, // total = 实际参与评分的维度数（不含 not_tested）
 *     dimensions: { color: {status, expected?}, shape: {...}, coating: {...} }
 *   }
 *
 * 维度级状态只有 4 种：correct / missing / wrong / not_tested。
 * 同义与近似措辞按 correct 计（「苔黄腻」命中「淡黄腻」属正常容错），所以维度级
 * 不产生 partial；partial 只作为总体结论，表示「有命中的，但不完整」。
 *
 * 不含 DOM、window、fetch、localStorage，不 import 任何其他模块。
 * ==================================================================== */

// 参与评分的三个舌象维度。病例只提供其中一部分时，其余维度不参与评分。
export const TONGUE_DIMENSIONS = ['color', 'shape', 'coating'];

export const TONGUE_DIM_STATUS = Object.freeze({
    CORRECT: 'correct',
    WRONG: 'wrong',
    MISSING: 'missing',
    NOT_TESTED: 'not_tested'
});

export const TONGUE_RESULT = Object.freeze({
    CORRECT: 'correct',
    PARTIAL: 'partial',
    WRONG: 'wrong',
    NOT_TESTABLE: 'not_testable'
});

// 「正常」类表述；否定说法（不正常 / 非正常）必须排除，否则「舌形不正常」会被判成正常
const NORMAL_RE = /正常|无异常|无明显异常|未见异常|无特殊/;
const NEGATED_NORMAL_RE = /不正常|非正常/;

function isNormalStatement(text) {
    const s = String(text || '');
    return NORMAL_RE.test(s) && !NEGATED_NORMAL_RE.test(s);
}

// 去掉舌象术语的前缀，便于用「包含」判断（舌质淡红 / 苔薄白 → 淡红 / 薄白）
function stripPrefix(s) {
    return String(s).replace(/^舌(质|体|色|形|苔)?/, '').replace(/^苔/, '');
}

// 单维度比对（容忍顺序与措辞差异）：整体包含，或任意连续两字命中。
// 两个字符起才谈「连续两字」，且窗口起点最多到倒数第二位，
// 否则末尾会退化成一个单字（"淡红" 的 "红"）冒充两字命中。
function matchTerm(userText, correctVal) {
    if (!correctVal) return false;
    const cc = stripPrefix(correctVal);
    if (!cc) return false;
    if (userText.includes(cc)) return true;
    if (cc.length < 2) return false;
    for (let i = 0; i < cc.length - 1; i++) {
        if (userText.includes(cc.slice(i, i + 2))) return true;
    }
    return false;
}

// 用户写到过哪些维度：按标点切句，每句归给一个维度（苔 > 舌形 > 舌色）。
// 只用于区分「写了但写错」与「根本没写」，不参与命中判断（命中只看 matchTerm）。
const COATING_MARKER = /苔/;
const SHAPE_MARKER = /形|体|齿痕|胖|瘦|裂纹|嫩|老|点刺|瘀斑|肿大/;
const COLOR_MARKER = /舌/;

function mentionedDimensions(userText) {
    const found = new Set();
    for (const seg of String(userText).split(/[，,。；;：:、\s]+/)) {
        if (!seg) continue;
        if (COATING_MARKER.test(seg)) found.add('coating');
        else if (SHAPE_MARKER.test(seg)) found.add('shape');
        else if (COLOR_MARKER.test(seg)) found.add('color');
    }
    return found;
}

// 单维度判定：病例没写 → not_tested；写了但用户没写 → missing；写了且用户写错 → wrong
function judgeDimension(dimension, expected, userText, mentioned, referenceText) {
    const value = typeof expected === 'string' ? expected.trim() : '';
    if (!value) return { status: TONGUE_DIM_STATUS.NOT_TESTED };

    if (isNormalStatement(value)) {
        // 病例原文没写「正常」→ 这个「正常」是推断值，不作为考点
        if (referenceText && !isNormalStatement(referenceText)) return { status: TONGUE_DIM_STATUS.NOT_TESTED };
        if (isNormalStatement(userText)) return { status: TONGUE_DIM_STATUS.CORRECT, expected: value };
        return {
            status: mentioned.has(dimension) ? TONGUE_DIM_STATUS.WRONG : TONGUE_DIM_STATUS.MISSING,
            expected: value
        };
    }

    if (matchTerm(userText, value)) return { status: TONGUE_DIM_STATUS.CORRECT, expected: value };
    return {
        status: mentioned.has(dimension) ? TONGUE_DIM_STATUS.WRONG : TONGUE_DIM_STATUS.MISSING,
        expected: value
    };
}

/*
 * @param {object} tongueJudgment 病例的 clues.inspection.tongueJudgment（只写病例真实提供的维度）
 * @param {string} userText       学习者的舌象描述
 * @param {string} referenceText  病例原文舌象描述（clues.inspection.tongueDesc），
 *                                用于判断病例里的「正常」是否有原文依据；缺省则字段本身即依据
 * @returns {object} 逐维度结论 + 总体结论（见文件头说明）
 */
export function judgeTongue(tongueJudgment, userText, referenceText = '') {
    const text = String(userText || '').replace(/\s+/g, '');
    const mentioned = mentionedDimensions(text);
    const tj = tongueJudgment || {};

    const dimensions = {};
    for (const dim of TONGUE_DIMENSIONS) {
        dimensions[dim] = judgeDimension(dim, tj[dim], text, mentioned, referenceText);
    }

    const tested = TONGUE_DIMENSIONS.filter(d => dimensions[d].status !== TONGUE_DIM_STATUS.NOT_TESTED);
    const total = tested.length;
    if (total === 0) {
        return { correct: null, status: TONGUE_RESULT.NOT_TESTABLE, matched: 0, total: 0, dimensions };
    }

    const matched = tested.filter(d => dimensions[d].status === TONGUE_DIM_STATUS.CORRECT).length;
    const wrong = tested.filter(d => dimensions[d].status === TONGUE_DIM_STATUS.WRONG).length;

    let status;
    if (matched === total) status = TONGUE_RESULT.CORRECT;              // 全部命中
    else if (matched === 0 && wrong > 0) status = TONGUE_RESULT.WRONG;  // 写了但一个都没对
    else status = TONGUE_RESULT.PARTIAL;                               // 有命中但不全，或只遗漏

    return { correct: status === TONGUE_RESULT.CORRECT, matched, total, status, dimensions };
}

/*
 * 参考答案文本：优先用病例自带的 tongueDesc 原文，不自行补充病例未提及的内容；
 * 没有 tongueDesc 时才由 tongueJudgment 里**真实存在**的维度拼出一句。
 * 病例没提供的维度不出现在参考答案里（不写「未述」占位，避免暗示病例描述过该维度）。
 */
export function describeTongueReference(inspection) {
    if (!inspection) return '';
    const desc = (inspection.tongueDesc || '').trim();
    if (desc) return desc;
    const labels = { color: '舌色', shape: '舌形', coating: '舌苔' };
    const tj = inspection.tongueJudgment || {};
    return TONGUE_DIMENSIONS
        .filter(dim => typeof tj[dim] === 'string' && tj[dim].trim())
        .map(dim => labels[dim] + tj[dim].trim())
        .join('，');
}

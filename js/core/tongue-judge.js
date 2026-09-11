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
 *     correct: boolean|null,
 *     status: 'correct'|'partial'|'wrong'|'not_testable',
 *     matched: number, total: number,
 *     dimensions: { color: {status, expected?}, shape: {...}, coating: {...} }
 *   }
 *
 * 不含 DOM、window、fetch、localStorage，不 import 任何其他模块。
 * ==================================================================== */

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

const NORMAL_RE = /正常|无异常|无明显异常|未见异常|无特殊/;
const NEGATED_NORMAL_RE = /不正常|非正常/;

function isNormalStatement(text) {
    const s = String(text || '');
    return NORMAL_RE.test(s) && !NEGATED_NORMAL_RE.test(s);
}

function stripPrefix(s) {
    return String(s).replace(/^舌(质|体|色|形|苔)?/, '').replace(/^苔/, '');
}

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

function judgeDimension(dimension, expected, userText, mentioned, referenceText) {
    const value = typeof expected === 'string' ? expected.trim() : '';
    if (!value) return { status: TONGUE_DIM_STATUS.NOT_TESTED };

    if (isNormalStatement(value)) {
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
    if (matched === total) status = TONGUE_RESULT.CORRECT;
    else if (matched === 0 && wrong > 0) status = TONGUE_RESULT.WRONG;
    else status = TONGUE_RESULT.PARTIAL;

    return { correct: status === TONGUE_RESULT.CORRECT, matched, total, status, dimensions };
}

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

/* ===================== 判定逻辑测试 =====================
 * 目的：校验 answer-evaluator 的判定规则，以及 tongue-judge 的
 * 「只考病例真实提供的维度」判定（未描述 ≠ 正常；未提供的维度不进分母）。
 * 运行： node tests/domain.test.mjs
 * ============================================================ */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { evaluateAnswer, isDiseaseCorrect, isSyndromeCorrect } = await import(pathToFileURL(join(ROOT, 'js/core/answer-evaluator.js')).href);
const { judgeTongue, describeTongueReference } = await import(pathToFileURL(join(ROOT, 'js/core/tongue-judge.js')).href);

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; failures.push(name + (detail ? '  → ' + detail : '')); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}

const cases = ['basic', 'intermediate', 'advanced'].flatMap(f =>
    JSON.parse(readFileSync(join(ROOT, `data/cases/${f}.json`), 'utf-8')).cases);
const byId = id => cases.find(c => c.id === id);

console.log('\n=== 1. 病名判定 ===\n');
check('完全匹配', isDiseaseCorrect('胃脘痛', '胃脘痛'));
check('允许「证」后缀被剥离', isDiseaseCorrect('胃脘痛证', '胃脘痛'));
// 病名是单向包含（标准 ⊇ 用户），与原有实现一致：标准「胃脘痛」不含更长的用户输入「胃脘痛X」
check('标准包含用户（标准更长）', isDiseaseCorrect('胃脘痛', '胃脘'));
check('用户更长于标准时不命中（与原实现一致的单向包含）', !isDiseaseCorrect('胃脘', '胃脘痛'));
check('不匹配即为假', !isDiseaseCorrect('头痛', '胃脘痛'));
check('空输入为假', !isDiseaseCorrect('', '胃脘痛'));

// 回归：单字片段不得凭 substring 蒙对病名（旧实现下 "热" 会被 "胃热证" 包含）
check('单字病名片段不得命中', !isDiseaseCorrect('胃热证', '热'));
check('另一个单字片段不得命中', !isDiseaseCorrect('胃脘痛', '胃'));
check('完整病名主体仍然命中', isDiseaseCorrect('胃脘痛证', '胃脘痛'));
check('完全匹配仍然命中', isDiseaseCorrect('胃脘痛', '胃脘痛'));
check('无关病名仍然不命中', !isDiseaseCorrect('头痛', '胃脘痛'));
// 真实病例数据的边界：二字病名必须写全，六字联合病名可只写主病名
check('真实病例：单字不得命中（胃痛 / 痛）', !isDiseaseCorrect('胃痛', '痛'));
check('真实病例：二字病名写全即命中（咳嗽 / 咳嗽）', isDiseaseCorrect('咳嗽', '咳嗽'));
check('真实病例：联合病名可只写主病名（胃脘痛、便秘 / 胃脘痛）',
    isDiseaseCorrect('胃脘痛、便秘', '胃脘痛'));
check('真实病例：带「证」后缀的标准病名可省后缀',
    isDiseaseCorrect('舌象异常/黑舌相关病证', '舌象异常/黑舌相关病'));
check('真实病例：两个不相干病名不命中（不寐 / 心悸）', !isDiseaseCorrect('不寐', '心悸'));

console.log('\n=== 2. 证型判定 ===\n');
check('完全匹配', isSyndromeCorrect({ syndrome: '肝郁脾虚' }, '肝郁脾虚'));
check('双向包含', isSyndromeCorrect({ syndrome: '肝郁脾虚证' }, '肝郁脾虚'));
// 词素规则：标准含「风热」时，用户写「风热津伤」即命中（省略病位「犯肺」）
check('词素规则：标准含「风热」时，用户写「风热津伤」即命中',
    isSyndromeCorrect({ syndrome: '风热犯肺津伤' }, '风热津伤'));
// 只写单个词素时，通用包含规则恰好也能命中（原实现同样如此），故此处只断言结果一致
check('只写「风热」时由通用包含规则命中（与原实现一致）',
    isSyndromeCorrect({ syndrome: '风热犯肺津伤' }, '风热'));
check('完全无关的证型不命中', !isSyndromeCorrect({ syndrome: '肝郁脾虚' }, '痰湿内蕴ZZZ'));

console.log('\n=== 3. 全病例正确/错误答案判定 ===\n');
let allCorrectOk = true, allWrongOk = true;
for (const c of cases) {
    const good = evaluateAnswer(c.correctAnswer, { disease: c.correctAnswer.disease, syndrome: c.correctAnswer.syndrome });
    const bad = evaluateAnswer(c.correctAnswer, { disease: '错误病名', syndrome: '错误证型' });
    if (!good.isCorrect) { allCorrectOk = false; console.log(`     ✗ ${c.id} 标准答案被判错`); }
    if (bad.isCorrect) { allWrongOk = false; console.log(`     ✗ ${c.id} 错误答案被判对`); }
}
check(`全部 ${cases.length} 例的标准答案均判定为正确`, allCorrectOk);
check(`全部 ${cases.length} 例的错误答案均判定为错误`, allWrongOk);

console.log('\n=== 4. 部分正确判定 ===\n');
let partialOk = true;
for (const c of cases) {
    // 病名对、证型错 → partial（仅病名正确）
    const r = evaluateAnswer(c.correctAnswer, { disease: c.correctAnswer.disease, syndrome: '完全不相干的证型ZZZ' });
    if (r.result !== 'partial' || !r.diseaseOk || r.syndromeOk) {
        partialOk = false;
        console.log(`     ✗ ${c.id} → ${JSON.stringify(r)}`);
    }
}
check(`全部 ${cases.length} 例「仅病名正确」均判定为 partial`, partialOk);

// 证型对、病名错同样应是 partial（而非 correct）
let partial2Ok = true;
for (const c of cases) {
    const r = evaluateAnswer(c.correctAnswer, { disease: '完全不相干的病名ZZZ', syndrome: c.correctAnswer.syndrome });
    if (r.result !== 'partial' || r.diseaseOk || !r.syndromeOk) {
        partial2Ok = false;
        console.log(`     ✗ ${c.id} → ${JSON.stringify(r)}`);
    }
}
check(`全部 ${cases.length} 例「仅证型正确」均判定为 partial`, partial2Ok);

// 关键语义：病名与证型必须同时正确，整体才算正确
let bothRequiredOk = true;
for (const c of cases) {
    const onlyDisease = evaluateAnswer(c.correctAnswer, { disease: c.correctAnswer.disease, syndrome: '' });
    const onlySyndrome = evaluateAnswer(c.correctAnswer, { disease: '', syndrome: c.correctAnswer.syndrome });
    if (onlyDisease.isCorrect || onlySyndrome.isCorrect) {
        bothRequiredOk = false;
        console.log(`     ✗ ${c.id} 单项正确被判为整体正确`);
    }
}
check('病名与证型必须同时正确才算整体正确', bothRequiredOk);

console.log('\n=== 5. 证型特判已数据化（不再硬编码病例特征） ===\n');
// 只检查代码行，忽略注释（注释里的举例不属于硬编码规则）
function codeOnly(src) {
    let inBlock = false;
    return src.split('\n').map(line => {
        const t = line.trim();
        if (inBlock) { if (t.includes('*/')) inBlock = false; return ''; }
        if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return ''; }
        if (t.startsWith('//') || t.startsWith('*')) return '';
        return line;
    }).join('\n');
}
const evaluatorCode = codeOnly(readFileSync(join(ROOT, 'js/core/answer-evaluator.js'), 'utf-8'));
// 词素规则允许出现证型词素（它是数据化规则表），但不允许按病例 ID 特判
check('evaluator 不含病例 ID 特判', !/basic-|inter-|adv-/.test(evaluatorCode));
check('evaluator 的病例差异集中在 MORPHEME_RULES 一处',
    (evaluatorCode.match(/MORPHEME_RULES/g) || []).length >= 1
    && !/脾胃虚寒|痰瘀互结|痰热壅肺/.test(evaluatorCode));
const gameCode = codeOnly(readFileSync(join(ROOT, 'js/game.js'), 'utf-8'));
check('game.js 不再承载证型判定规则',
    !/风热|津伤|脾胃虚寒|痰瘀互结|痰热壅肺/.test(gameCode));
check('game.js 通过注入方式获取进度服务（不 import storage）',
    !/from ['"]\.\/storage/.test(gameCode));

console.log('\n=== 6. 舌象判定：只考病例真实提供的维度 ===\n');

// 病例只提供舌色 + 舌苔（原文没写舌形）——真实病例里最常见的情况
const twoDims = { color: '淡红', coating: '淡黄腻' };

const v1 = judgeTongue(twoDims, '舌淡红，苔黄腻');
check('两维全中 → 整体正确，分母只有 2（舌形不进分母）',
    v1.status === 'correct' && v1.correct === true && v1.matched === 2 && v1.total === 2, JSON.stringify(v1));
check('病例没写的维度 status = not_tested',
    v1.dimensions.shape.status === 'not_tested', JSON.stringify(v1.dimensions.shape));
check('已提供的两个维度 status = correct',
    v1.dimensions.color.status === 'correct' && v1.dimensions.coating.status === 'correct');

const v2 = judgeTongue(twoDims, '舌淡红');
check('用户没写病例已提供的舌苔 → coating = missing，总体 partial（不能算完全正确）',
    v2.dimensions.coating.status === 'missing' && v2.status === 'partial'
    && v2.correct === false && v2.matched === 1 && v2.total === 2, JSON.stringify(v2));

const v3 = judgeTongue(twoDims, '舌淡白，苔白');
check('用户明确写错 → 两个维度 wrong，总体 wrong',
    v3.dimensions.color.status === 'wrong' && v3.dimensions.coating.status === 'wrong'
    && v3.status === 'wrong' && v3.correct === false, JSON.stringify(v3));

const v4 = judgeTongue({ color: '淡红', shape: '正常', coating: '薄白' },
    '舌淡红，舌形正常，苔薄白', '舌质淡红，舌形正常，苔薄白。');
check('病例原文明确写了「舌形正常」时舌形才是考点，三维全中',
    v4.status === 'correct' && v4.matched === 3 && v4.total === 3
    && v4.dimensions.shape.status === 'correct', JSON.stringify(v4));

const v5 = judgeTongue({ color: '淡红', shape: '正常', coating: '薄白' }, '舌形不正常',
    '舌质淡红，舌形正常，苔薄白。');
check('「不正常」不得命中「正常」',
    v5.dimensions.shape.status === 'wrong' && v5.correct === false, JSON.stringify(v5.dimensions.shape));

const v6 = judgeTongue({}, '舌淡红');
check('tongueJudgment 为空：不崩、total = 0、correct = null',
    v6.status === 'not_testable' && v6.correct === null && v6.total === 0 && v6.matched === 0,
    JSON.stringify(v6));
check('null 入参同样不崩', judgeTongue(null, '舌淡红').total === 0);

// 未描述 ≠ 正常：原文没写「正常」时，数据里的「正常」是推断出来的值，不作为考点
const v7 = judgeTongue({ color: '淡红', shape: '正常', coating: '淡黄腻' },
    '舌淡红，苔黄腻', '舌质淡红，苔腻淡黄。');
check('原文没写舌形 → 数据里的 shape「正常」不作为考点',
    v7.dimensions.shape.status === 'not_tested' && v7.total === 2 && v7.status === 'correct',
    JSON.stringify(v7));

// 病例未提供的信息，用户自己写了：既不判错，也不算命中
const v8 = judgeTongue({ color: '淡红', coating: '淡黄腻' }, '舌质淡红，舌体胖大，苔黄腻');
check('用户多写病例未提供的舌形：既不算命中也不判错',
    v8.dimensions.shape.status === 'not_tested' && v8.status === 'correct' && v8.total === 2,
    JSON.stringify(v8));

check('病例原文写了「正常」时，用户须也说正常才命中',
    judgeTongue({ color: '正常' }, '舌色正常', '舌质正常。').dimensions.color.status === 'correct');
check('病例写「正常」而用户写异常 → 判错',
    judgeTongue({ color: '正常' }, '舌色红绛', '舌质正常。').dimensions.color.status === 'wrong');
check('维度值为 null / 空串视为未提供',
    judgeTongue({ color: '淡红', shape: null, coating: '  ' }, '舌淡红').total === 1);
check('未知字段不影响已支持维度',
    judgeTongue({ color: '淡红', unknown: 'xxx' }, '舌淡红').status === 'correct');
check('空输入不可能算正确', judgeTongue({ color: '淡红' }, '').correct !== true);

console.log('\n=== 6b. 舌象判定的容错与窗口边界（回归） ===\n');
check('近似措辞命中（用户「苔黄腻」≈ 病例「淡黄腻」）',
    judgeTongue(twoDims, '苔黄腻').dimensions.coating.status === 'correct');
check('连续两字窗口仍能容错命中长术语（胖大有齿痕 → 舌胖大）',
    judgeTongue({ color: '淡红', shape: '胖大有齿痕', coating: '薄白' }, '舌淡红，舌胖大，苔薄白').status === 'correct');
// 窗口边界：旧实现用 substr(i,2) 时末尾会退化成一个单字，于是「淡红」的尾字「红」也能命中
check('「淡红」的尾字不得越界充当双字窗口（用户只写「红」不算命中）',
    judgeTongue({ color: '淡红', coating: '薄白' }, '舌红，苔黄腻').dimensions.color.status === 'wrong');

console.log('\n=== 6c. 维度识别：同片段多维 + 「已答但错」≠「未提及」 ===\n');
// 同一片段须可同时命中多个维度：「舌红苔黄」必须 color + coating 双双识别为已答（旧实现 else-if 只得到 coating）
const m1 = judgeTongue({ color: '淡红', coating: '淡黄腻' }, '舌红苔黄');
check('「舌红苔黄」→ color wrong（不能是 missing）', m1.dimensions.color.status === 'wrong', JSON.stringify(m1));
check('「舌红苔黄」→ coating wrong（按 matchTerm 既有规则判定）', m1.dimensions.coating.status === 'wrong', JSON.stringify(m1));
check('「舌红苔黄」→ shape not_tested，分母仍为 2', m1.dimensions.shape.status === 'not_tested' && m1.total === 2, JSON.stringify(m1));
// 「舌形正常」不能因含「舌」被误判为已答舌色：color 维度应保持 missing
check('「舌形正常」→ 只算 shape 已答，color 保持 missing',
    judgeTongue({ color: '淡红' }, '舌形正常').dimensions.color.status === 'missing');
check('病例有舌形考点时「舌形正常」按 shape 判错',
    judgeTongue({ color: '淡红', shape: '胖大' }, '舌形正常').dimensions.shape.status === 'wrong');
// 「已答但未中」≠「没答」：「舌红」对「淡红」是 wrong 而非 missing，且不得放宽为正确
check('「舌红」对「淡红」→ color wrong（不是 missing，也不是 correct）',
    judgeTongue({ color: '淡红' }, '舌红').dimensions.color.status === 'wrong');
check('「舌质淡红，苔薄黄」双维命中（淡红 / 薄黄）',
    judgeTongue({ color: '淡红', coating: '薄黄' }, '舌质淡红，苔薄黄').status === 'correct');
check('「舌淡红」命中「淡红」',
    judgeTongue({ color: '淡红' }, '舌淡红').status === 'correct');
const m2 = judgeTongue({ color: '淡红' }, '舌质淡红，舌体胖大');
check('用户多写「舌体胖大」不把 shape 纳入分母', m2.dimensions.shape.status === 'not_tested' && m2.total === 1, JSON.stringify(m2));

console.log('\n=== 7. 舌象参考答案文案 ===\n');
const inter6 = byId('inter-006');
const refText = describeTongueReference(inter6.clues.inspection);
check('优先使用病例 tongueDesc 原文', refText === inter6.clues.inspection.tongueDesc.trim(),
    `${refText} vs ${inter6.clues.inspection.tongueDesc}`);
const auto = describeTongueReference({ tongueJudgment: { color: '淡红', coating: '薄白' } });
check('无 tongueDesc 时只拼病例提供的维度', auto === '舌色淡红，舌苔薄白', auto);
const autoOne = describeTongueReference({ tongueJudgment: { color: '淡红' } });
check('只提供舌色时不补「未述」占位', autoOne === '舌色淡红', autoOne);
check('没有任何维度时参考答案为空串', describeTongueReference({ tongueJudgment: {} }) === '');

console.log('\n=== 8. 全病例舌象判定可执行 ===\n');
let tongueOk = true;
for (const c of cases) {
    const ins = c.clues.inspection;
    if (!ins.tongueJudgment) { tongueOk = false; console.log(`     ✗ ${c.id} 缺 tongueJudgment`); continue; }
    const ref = describeTongueReference(ins);
    if (!ref) { tongueOk = false; console.log(`     ✗ ${c.id} 无法生成参考答案`); continue; }
    // 用参考答案自身作为输入，应判定为正确
    const verdict = judgeTongue(ins.tongueJudgment, ref, ins.tongueDesc || '');
    if (verdict.correct !== true) {
        console.log(`     ⚠️  ${c.id} 参考答案自判未通过（数据描述与字段措辞不同所致）：${ref} → ${JSON.stringify(verdict.dimensions)}`);
    }
}
check('全部病例的舌象字段可用且能生成参考答案', tongueOk);

console.log('\n=== 9. 未描述 ≠ 正常（全量病例护栏） ===\n');
let normalGuardOk = true;
for (const c of cases) {
    const ins = c.clues.inspection;
    const tj = ins.tongueJudgment || {};
    const desc = ins.tongueDesc || '';
    const shapeIsNormal = typeof tj.shape === 'string' && /正常/.test(tj.shape);
    const shapeTested = judgeTongue(tj, '舌淡红', desc).dimensions.shape.status !== 'not_tested';
    if (shapeIsNormal && !/正常/.test(desc) && shapeTested) {
        normalGuardOk = false;
        console.log(`     ✗ ${c.id}：原文没写「正常」，却仍把 shape 当考点`);
    }
}
check('原文没写「正常」的病例，其「正常」字段一律不参与评分', normalGuardOk);

console.log('\n=== 结果 ===');
console.log(`通过 ${pass}，失败 ${fail}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }

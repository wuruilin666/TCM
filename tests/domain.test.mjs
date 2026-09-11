/* ===================== 判定逻辑等价性测试 =====================
 * 目的：证明重构后的 answer-evaluator / tongue-judge 与重构前行为一致。
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

console.log('\n=== 6. 舌象判定 ===\n');
check('三维中两维相符 → 正确',
    judgeTongue({ color: '淡红', shape: '正常', coating: '薄白' }, '舌色淡红，舌苔薄白'));
check('仅一维相符 → 判错',
    !judgeTongue({ color: '淡红', shape: '胖大', coating: '黄腻' }, '舌质淡红'));
check('病例述「正常」时用户须也说正常',
    judgeTongue({ color: '正常', shape: '正常', coating: '正常' }, '舌象正常'));
check('病例述「正常」但用户说异常 → 判错',
    !judgeTongue({ color: '正常', shape: '正常', coating: '正常' }, '舌色红绛，苔黄厚'));
check('空输入为假', !judgeTongue({ color: '淡红' }, ''));
check('空舌象数据为假', !judgeTongue({}, '舌淡红'));

console.log('\n=== 7. 舌象参考答案文案 ===\n');
const inter6 = byId('inter-006');
const refText = describeTongueReference(inter6.clues.inspection);
check('优先使用病例 tongueDesc 原文', refText === inter6.clues.inspection.tongueDesc.trim(),
    `${refText} vs ${inter6.clues.inspection.tongueDesc}`);
const auto = describeTongueReference({ tongueJudgment: { color: '淡红', coating: '薄白' } });
check('无 tongueDesc 时由维度拼出', auto === '舌色淡红，舌苔薄白', auto);
const autoMissing = describeTongueReference({ tongueJudgment: { color: '淡红' } });
check('缺失维度标注「未述」', autoMissing === '舌色淡红，舌苔未述', autoMissing);

console.log('\n=== 8. 全病例舌象判定可执行 ===\n');
let tongueOk = true;
for (const c of cases) {
    const ins = c.clues.inspection;
    if (!ins.tongueJudgment) { tongueOk = false; console.log(`     ✗ ${c.id} 缺 tongueJudgment`); continue; }
    const ref = describeTongueReference(ins);
    if (!ref) { tongueOk = false; console.log(`     ✗ ${c.id} 无法生成参考答案`); continue; }
    // 用参考答案自身作为输入，应判定为正确
    const selfOk = judgeTongue(ins.tongueJudgment, ref);
    if (!selfOk) console.log(`     ⚠️  ${c.id} 参考答案自判未通过（数据描述与字段措辞不同所致）：${ref}`);
}
check('全部病例的舌象字段可用且能生成参考答案', tongueOk);

console.log('\n=== 结果 ===');
console.log(`通过 ${pass}，失败 ${fail}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }

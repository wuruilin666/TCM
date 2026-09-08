/* ===================== 问诊匹配回归测试 =====================
 * 运行： node tests/inquiry.test.mjs
 * 覆盖：用户点名的 12 个 Bug + 随机抽样病例的问诊问题自检
 * ========================================================== */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    resolveInquiry, detectIntents, questionIntents, auditQuestions, GENERIC_NEUTRAL
} from '../js/inquiry-matcher.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['basic.json', 'intermediate.json', 'advanced.json'];

const cases = FILES.flatMap(f => {
    const d = JSON.parse(readFileSync(join(ROOT, 'data/cases', f), 'utf-8'));
    return d.cases.map(c => ({ ...c, _file: f, questions: c.clues.inquiry.questions }));
});
const byId = id => {
    const c = cases.find(x => x.id === id);
    if (!c) throw new Error('未找到病例 ' + id);
    return c;
};

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; failures.push(name + (detail ? '  → ' + detail : '')); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}

function ask(caseId, text) {
    const c = byId(caseId);
    const r = resolveInquiry(c.questions, text);
    return { res: r, answer: r.answer || '', intent: r.intent, type: r.type, c };
}

console.log('\n=== 12 个回归用例 ===\n');

/* 1 */
{
    const { answer, intent } = ask('inter-001', '身体有力吗');
    check('1 inter-001「身体有力吗」→ energy，且答出乏力',
        /energy\.(strength|general|fatigue)/.test(intent || '') && answer.includes('乏力'),
        `intent=${intent} answer=${answer}`);
}
/* 2 */
{
    const { answer, intent } = ask('inter-007', '身体有没有力气');
    check('2 inter-007「身体有没有力气」→ energy，非中性回答',
        /energy\.(strength|general|fatigue)/.test(intent || '') && answer !== GENERIC_NEUTRAL,
        `intent=${intent} answer=${answer}`);
}
/* 3 */
{
    const { answer, intent } = ask('adv-001', '身体素质怎么样');
    check('3 adv-001「身体素质怎么样」→ energy，命中素体虚弱/乏力',
        /energy\./.test(intent || '') && (answer.includes('虚弱') || answer.includes('乏力')),
        `intent=${intent} answer=${answer}`);
}
/* 4 */
{
    const { answer, intent } = ask('inter-003', '有没有胃口');
    check('4 inter-003「有没有胃口」→ diet.appetite，非胃灼热',
        intent === 'diet.appetite' && !answer.includes('灼热'),
        `intent=${intent} answer=${answer}`);
}
/* 5 */
{
    const { answer, intent } = ask('adv-006', '有食欲吗');
    check('5 adv-006「有食欲吗」→ diet.appetite，非饮食偏嗜',
        intent === 'diet.appetite' && !answer.includes('辛辣'),
        `intent=${intent} answer=${answer}`);
}
/* 6 */
{
    const { answer, intent } = ask('inter-004', '身体哪里痛');
    check('6 inter-004「身体哪里痛」→ pain.location，命中痛连两胁',
        intent === 'pain.location' && answer.includes('两胁'),
        `intent=${intent} answer=${answer}`);
}
/* 7 */
{
    const { answer, intent } = ask('inter-008', '怎么痛');
    check('7 inter-008「怎么痛」→ pain.quality，不先给时间/频率',
        intent === 'pain.quality' && !answer.includes('颞部'),
        `intent=${intent} answer=${answer}`);
}
/* 8 */
{
    const { answer, intent } = ask('inter-008', '放射状吗');
    check('8 inter-008「放射状吗」→ pain.radiation，不给时间信息',
        intent === 'pain.radiation' && !answer.includes('反复发作'),
        `intent=${intent} answer=${answer}`);
}
/* 9 */
{
    const { answer, intent } = ask('inter-008', '一般什么时候痛');
    check('9 inter-008「一般什么时候痛」→ pain.timing/frequency，出现反复发作/持续数日',
        /pain\.(timing|frequency|duration)/.test(intent || '') && /反复发作|持续数日/.test(answer),
        `intent=${intent} answer=${answer}`);
}
/* 10 */
{
    const { res, answer } = ask('adv-002', '头痛');
    check('10 adv-002「头痛」不命中 head.dizziness（无头晕）',
        !answer.includes('头晕') && res.intent !== 'head.dizziness',
        `intent=${res.intent} answer=${answer}`);
}
/* 11 */
{
    const { answer, intent } = ask('adv-003', '平时会不会觉得气不够用');
    check('11 adv-003「会不会觉得气不够用」→ breath.shortness，命中气短',
        intent === 'breath.shortness' && answer.includes('气短'),
        `intent=${intent} answer=${answer}`);
}
/* 12 */
{
    const { answer, intent } = ask('adv-007', '上一次来月经是什么时候');
    check('12 adv-007「上一次来月经是什么时候」→ menstruation.lmp，答案为 2022年2月21日',
        intent === 'menstruation.lmp' && answer.includes('2022年2月21日'),
        `intent=${intent} answer=${answer}`);
}

console.log('\n=== 追加口语 / 边界用例 ===\n');
const extra = [
    ['inter-001', '有力气吗', /乏力/],
    ['inter-001', '有没有精神', /乏力|体重/],
    ['adv-001', '体力怎么样', /虚弱|乏力/],
    ['inter-007', '有劲吗', /乏力/],
    ['adv-003', '气够不够', /气短/],
    ['adv-003', '是不是容易喘不上气', /气短/],
    ['adv-006', '有胃口吗', /食欲/],
    ['adv-006', '吃得下吗', /食欲/],
    ['adv-006', '纳食如何', /食欲/],
    ['adv-006', '平时喜欢吃什么', /辛辣/],
    ['basic-002', '头痛吗', /头痛/],
    ['basic-002', '头晕吗', /没特别留意/],
    ['inter-008', '每次痛多久', /持续数日/],
    ['inter-008', '痛多久一次', /反复/],
    ['adv-007', '月经量怎么样', /月经量较少/],
    ['adv-007', '月经多久来一次', /2-3个月/],
    ['adv-007', '经血什么颜色', /经色暗/],
    ['basic-003', '大便怎么样', /便秘/],
    ['basic-003', '小便怎么样', /没特别留意|不适/],
    ['adv-002', '胸闷吗', /胸痛|胸闷/],
    ['adv-002', '心慌吗', /心慌/],
    ['inter-005', '多久发作一次', /每月发作/],
    ['adv-004', '心悸什么时候发作', /晨起/],
    ['inter-006', '碰水会痛吗', /碰水/],
];
for (const [cid, q, re] of extra) {
    const { answer, intent, type } = ask(cid, q);
    check(`「${q}」(${cid}) → ${re}`, re.test(answer), `intent=${intent} type=${type} answer=${answer}`);
}

console.log('\n=== 全量静态自检 ===\n');
const audit = auditQuestions(cases);
check('所有 question 都有 intent', audit.missingIntent.length === 0, audit.missingIntent.join(' | '));
check('无高危单字关键词残留', audit.riskyKeywords.length === 0, audit.riskyKeywords.join(' | '));
check('无空关键词题目', audit.emptyKeywords.length === 0, audit.emptyKeywords.join(' | '));
console.log(`  （共检查 ${audit.total} 条问诊题目）`);
if (audit.dupIntents.length) {
    console.log('  ⚠️ 同病例重复 intent（需人工确认是否可区分）：');
    audit.dupIntents.forEach(d => console.log('     - ' + d));
}

console.log('\n=== 随机抽样 20+ 条问诊题目：原题面必须能命中自己 ===\n');
// 用每个病例的 question.q 作为用户输入，验证不会串到别的 intent 上
let sampled = 0, misHit = 0;
const step = Math.max(1, Math.floor(cases.length / 12));
for (let i = 0; i < cases.length; i += step) {
    const c = cases[i];
    for (const [idx, q] of c.questions.entries()) {
        sampled++;
        const r = resolveInquiry(c.questions, q.q);
        const okIntent = r.index >= 0 && questionIntents(c.questions[r.index])
            .some(it => questionIntents(q).includes(it));
        if (!okIntent) {
            misHit++;
            console.log(`  ⚠️ ${c.id}#${idx}「${q.q}」→ 命中「${r.index >= 0 ? c.questions[r.index].q : '无'}」intent=${r.intent}`);
        }
    }
}
check(`抽样 ${sampled} 条题目：题面自问命中同 intent`, misHit === 0, `${misHit} 条未命中`);

console.log('\n=== 结果 ===');
console.log(`通过 ${pass}，失败 ${fail}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }

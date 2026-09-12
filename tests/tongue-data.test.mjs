/* ===================== 舌象数据一致性测试 =====================
 * 规则：tongueJudgment 的每个考点必须在 tongueDesc 原文中有可靠依据；
 * 原文没写的维度不得自行填写（含「正常」推断）；tongueDesc 只描述舌象，
 * 面色 / 形体 / 舌下络脉等照片视角外的观察不得混入；nonTongue 不与 tongueDesc 重复。
 * 运行： node tests/tongue-data.test.mjs
 * ============================================================ */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { matchTerm, judgeTongue, describeTongueReference } =
    await import(pathToFileURL(join(ROOT, 'js/core/tongue-judge.js')).href);

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; failures.push(name + (detail ? '  → ' + detail : '')); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}

// 各维度在 tongueDesc 中「存在该维度描述」的关键词依据
const DIM_BASIS = {
    color: /舌[^\s]*?[淡红绛紫青白暗黯]/,
    shape: /形|体|齿痕|胖|瘦|裂纹|嫩|老|点刺|瘀斑|肿大/,
    coating: /苔/
};
// tongueDesc 中不允许出现的非舌象观察词（照片视角外）
const NON_TONGUE_RE = /面色|脸色|面容|形体|神志|精神|舌下脉络|舌下络脉|舌下静脉|舌底|咽部|唇/;

// 值有依据：必须与 tongueDesc 命中（整体包含，或连续两字窗口）。
// 这里刻意复用运行时同一支 matchTerm，让「测试通过」与「学习者照抄参考答案能被判对」
// 严格等价；不允许退化成「值的每个字都出现过」——那会让「淡黯」在「舌淡略黯」这类
// 只有单字重合的病例上蒙混过关（运行时仍会把照抄参考答案判成错）。
function valueBasedOn(desc, value) {
    const v = String(value).trim();
    return !!v && matchTerm(desc, v);
}

const files = ['basic', 'intermediate', 'advanced'];
const allCases = files.flatMap(f =>
    JSON.parse(readFileSync(join(ROOT, `data/cases/${f}.json`), 'utf-8')).cases);

console.log(`\n=== 1. tongueJudgment 每个维度在 tongueDesc 有依据（共 ${allCases.length} 例） ===\n`);
let basisOk = true;
for (const c of allCases) {
    const ins = c.clues.inspection;
    const tj = ins.tongueJudgment || {};
    const desc = (ins.tongueDesc || '').trim();
    for (const dim of ['color', 'shape', 'coating']) {
        const v = typeof tj[dim] === 'string' ? tj[dim].trim() : '';
        if (!v) continue;
        if (!DIM_BASIS[dim].test(desc)) {
            basisOk = false; console.log(`     ✗ ${c.id} ${dim}="${v}"：tongueDesc 无${dim}维度描述`);
        } else if (!valueBasedOn(desc, v)) {
            basisOk = false; console.log(`     ✗ ${c.id} ${dim}="${v}"：值在 tongueDesc 中无依据`);
        }
    }
}
check('全部病例的 tongueJudgment 考点均有 tongueDesc 依据', basisOk);

console.log('\n=== 2. 原文没写的维度不得自行填写（含「正常」推断） ===\n');
let noInventOk = true;
for (const c of allCases) {
    const ins = c.clues.inspection;
    const tj = ins.tongueJudgment || {};
    const desc = (ins.tongueDesc || '').trim();
    for (const dim of ['color', 'shape', 'coating']) {
        const v = typeof tj[dim] === 'string' ? tj[dim].trim() : '';
        if (!v) continue;
        if (!DIM_BASIS[dim].test(desc)) {
            noInventOk = false; console.log(`     ✗ ${c.id} 填写了原文未提供的 ${dim}="${v}"`);
        } else if (/正常/.test(v) && !/正常/.test(desc)) {
            noInventOk = false; console.log(`     ✗ ${c.id} 原文没写正常，却填了 ${dim}="正常"`);
        }
    }
}
check('没有病例自行补充 tongueDesc 未提供的维度', noInventOk);

console.log('\n=== 3. tongueDesc 不得混入照片视角外的观察 ===\n');
let descPureOk = true;
for (const c of allCases) {
    const desc = (c.clues.inspection.tongueDesc || '').trim();
    const hit = desc.match(NON_TONGUE_RE);
    if (hit) { descPureOk = false; console.log(`     ✗ ${c.id} tongueDesc 含非舌象内容「${hit[0]}」：${desc}`); }
}
check('全部 tongueDesc 只描述舌象本身', descPureOk);

console.log('\n=== 4. nonTongue 不与 tongueDesc 重复 ===\n');
let nonTongueOk = true;
for (const c of allCases) {
    const ins = c.clues.inspection;
    const desc = (ins.tongueDesc || '').trim();
    const nt = (ins.nonTongue || '').trim();
    if (nt && desc.includes(nt)) { nonTongueOk = false; console.log(`     ✗ ${c.id} nonTongue 整段重复于 tongueDesc："${nt}"`); }
}
check('nonTongue 与 tongueDesc 无重复', nonTongueOk);

console.log('\n=== 5. 照抄参考答案必须判全对（tongueDesc 与考点值互不矛盾） ===\n');
console.log(`（共 ${allCases.length} 例）`);
let selfScoreOk = true;
for (const c of allCases) {
    const ins = c.clues.inspection;
    const reference = describeTongueReference(ins);
    const v = judgeTongue(ins.tongueJudgment, reference, ins.tongueDesc || '');
    if (v.total > 0 && v.status !== 'correct') {
        selfScoreOk = false;
        console.log(`     ✗ ${c.id} 照抄参考答案「${reference}」被判 ${v.status}：${JSON.stringify(v.dimensions)}`);
    }
}
check('每例照抄参考答案都能拿满分', selfScoreOk);

console.log('\n=== 6. 已知修正病例的定点回归 ===\n');
const byId = id => allCases.find(c => c.id === id);

const i4 = byId('inter-004');
check('inter-004：tongueJudgment.color 必须不存在', i4.clues.inspection.tongueJudgment.color === undefined);
check('inter-004：shape = 胖大有齿痕、coating = 白腻',
    i4.clues.inspection.tongueJudgment.shape === '胖大有齿痕'
    && i4.clues.inspection.tongueJudgment.coating === '白腻');
check('inter-004：tongueDesc 为「舌苔白腻，舌体胖大有齿痕。」',
    i4.clues.inspection.tongueDesc === '舌苔白腻，舌体胖大有齿痕。');
{
    const ins = i4.clues.inspection;
    const v = judgeTongue(ins.tongueJudgment, '舌红，苔白腻', ins.tongueDesc || '');
    check('inter-004：用户「舌红，苔白腻」→ color not_tested / shape missing / coating correct / 1/2 partial',
        v.dimensions.color.status === 'not_tested'
        && v.dimensions.shape.status === 'missing'
        && v.dimensions.coating.status === 'correct'
        && v.matched === 1 && v.total === 2 && v.status === 'partial', JSON.stringify(v));
}

const i1 = byId('inter-001');
check('inter-001：tongueDesc 不含舌下脉络，nonTongue 含',
    !/舌下脉络/.test(i1.clues.inspection.tongueDesc)
    && /舌下脉络/.test(i1.clues.inspection.nonTongue));

const a1 = byId('adv-001');
check('adv-001：tongueDesc 不含面色/舌下络脉，nonTongue 含',
    !/面色|舌下络脉/.test(a1.clues.inspection.tongueDesc)
    && /面色/.test(a1.clues.inspection.nonTongue) && /舌下络脉/.test(a1.clues.inspection.nonTongue));

const a6 = byId('adv-006');
check('adv-006：tongueDesc 不含面色晦暗，nonTongue 为面色晦暗',
    !/面色/.test(a6.clues.inspection.tongueDesc)
    && /面色晦暗/.test(a6.clues.inspection.nonTongue));
check('adv-006：coating 与 tongueDesc 措辞一致（「苔黄且较厚」），照抄参考答案可判对',
    matchTerm(a6.clues.inspection.tongueDesc, a6.clues.inspection.tongueJudgment.coating));

const a7 = byId('adv-007');
check('adv-007：color 与 tongueDesc 措辞一致（「舌淡略黯」），照抄参考答案可判对',
    matchTerm(a7.clues.inspection.tongueDesc, a7.clues.inspection.tongueJudgment.color));

console.log('\n=== 结果 ===');
console.log(`通过 ${pass}，失败 ${fail}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }

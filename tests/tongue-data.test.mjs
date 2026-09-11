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
const { matchTerm } = await import(pathToFileURL(join(ROOT, 'js/core/tongue-judge.js')).href);

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

// 值有依据：与 tongueDesc 整体/两字窗口命中，或值的每个字都出现在原文（「淡黯」←「舌淡略黯」）
function valueBasedOn(desc, value) {
    const v = String(value).trim();
    if (!v) return false;
    if (matchTerm(desc, v)) return true;
    return [...v].every(ch => desc.includes(ch));
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

console.log('\n=== 5. 已知修正病例的定点回归 ===\n');
const byId = id => allCases.find(c => c.id === id);

const i4 = byId('inter-004');
check('inter-004：不再有 color 淡白 考点', !('color' in (i4.clues.inspection.tongueJudgment || {})));
{
    const { judgeTongue } = await import(pathToFileURL(join(ROOT, 'js/core/tongue-judge.js')).href);
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

console.log('\n=== 结果 ===');
console.log(`通过 ${pass}，失败 ${fail}`);
if (failures.length) { console.log('\n失败项：'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }

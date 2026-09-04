/* 问诊匹配自检：node test/inquiry.test.mjs */
import assert from 'node:assert';
import { resolveInquiry } from '../js/inquiry.js';

// 模拟病例题库
const stoolOnly = [   // 病例只记录大便（干结），未记录小便
    { q: '大便情况', a: '大便干结，2-3天一解。', keywords: ['大便', '便秘'], dimension: 'stool' },
    { q: '睡眠如何？', a: '睡眠尚可。', keywords: ['睡眠'], dimension: 'sleep' }
];
const bothCase = [    // 大便干结 + 小便短赤
    { q: '大便情况', a: '大便干结。', keywords: ['大便'], dimension: 'stool' },
    { q: '小便情况', a: '小便短赤。', keywords: ['小便'], dimension: 'urine' }
];
const bothNormal = [  // 二便调（分别记录为正常）
    { q: '大便情况', a: '大便调。', keywords: ['大便'], dimension: 'stool' },
    { q: '小便情况', a: '小便调。', keywords: ['小便'], dimension: 'urine' }
];
const urineOnly = [
    { q: '小便情况', a: '小便黄。', keywords: ['小便'], dimension: 'urine' }
];

/* ---- 单维匹配（既有规则，不得回归） ---- */
assert.strictEqual(resolveInquiry(stoolOnly, '便秘吗？').answer, '大便干结，2-3天一解。');   // 测试1
assert.ok(!resolveInquiry(stoolOnly, '便秘吗？').answer.includes('小便'));

/* ---- 病例未记录该维度：患者口吻，不虚构“正常”，不说“未记录” ---- */
const t2 = resolveInquiry(stoolOnly, '小便怎么样？');                                        // 测试2
assert.strictEqual(t2.answer, '小便方面没有特别不适。');
assert.ok(!t2.answer.includes('正常') && !t2.answer.includes('未记录') && !t2.answer.includes('未特别记录'));

const t2b = resolveInquiry(urineOnly, '大便怎么样？');
assert.strictEqual(t2b.answer, '大便方面没有特别不适。');

/* ---- 二便联合询问：缺失信息补患者口吻，资料齐全照答 ---- */
const t3 = resolveInquiry(stoolOnly, '大小便怎么样？');                                      // 测试3
assert.strictEqual(t3.answer, '大便干结，2-3天一解，小便方面没有特别不适。');
assert.deepStrictEqual(t3.indices, [0]); // 缺失信息不是病例题，不进线索

const t4 = resolveInquiry(bothCase, '大小便怎么样？');                                       // 测试4
assert.strictEqual(t4.answer, '大便干结，小便短赤。');
assert.deepStrictEqual(t4.indices, [0, 1]);

const t5 = resolveInquiry(bothNormal, '大小便怎么样？');                                     // 测试5（二便调）
assert.strictEqual(t5.answer, '大便调，小便调。');

const t5b = resolveInquiry(urineOnly, '二便如何？');
assert.strictEqual(t5b.answer, '小便黄，大便方面没有特别不适。');

const t5c = resolveInquiry([], '大小便怎么样？');
assert.strictEqual(t5c.answer, '大小便方面没有明显不适。');

/* ---- 禁止无依据补充“正常” ---- */
for (const ans of [
    resolveInquiry(stoolOnly, '小便怎么样？').answer,
    resolveInquiry(urineOnly, '大便怎么样？').answer
]) {
    assert.ok(!/正常|调[。？]/.test(ans), '未记录维度不得回答“正常/调”：' + ans);
}

/* ---- 回归：其他维度行为不变 ---- */
assert.strictEqual(resolveInquiry(stoolOnly, '睡眠怎么样？').answer, '睡眠尚可。');
assert.strictEqual(resolveInquiry(stoolOnly, '有什么爱好？').type, 'neutral');
assert.strictEqual(resolveInquiry(stoolOnly, '有什么爱好？').answer, '（患者）这方面我没特别留意。');

console.log('✅ 问诊匹配测试全部通过（14 项断言）');

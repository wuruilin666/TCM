/* 问诊匹配自检：node test/inquiry.test.mjs */
import assert from 'node:assert';
import { resolveInquiry } from '../js/inquiry.js';

const questions = [
    { q: '大便情况如何？', a: '大便正常，每日一行。', keywords: ['大便', '排便'], dimension: 'stool' },
    { q: '小便情况如何？', a: '小便正常。', keywords: ['小便', '排尿'], dimension: 'urine' },
    { q: '睡眠如何？', a: '睡眠尚可。', keywords: ['睡眠'], dimension: 'sleep' },
    { q: '胃口怎么样？', a: '食欲一般。', keywords: ['胃口', '饮食'], dimension: 'diet' }
];

// [输入, 期望返回的维度列表]（空数组 = 中性回答）
const cases = [
    ['便秘吗？', ['stool']],                    // 测试1：只答大便
    ['大便怎么样？', ['stool']],                // 测试2：只答大便
    ['小便有什么不舒服吗？', ['urine']],        // 测试3：只答小便
    ['小便量多少？', ['urine']],                // 测试4：只答尿量
    ['大小便怎么样？', ['stool', 'urine']],     // 测试5：联合
    ['二便如何？', ['stool', 'urine']],         // 测试6：联合
    ['排泄怎么样？', []],                       // 无联合关键词（“排泄情况”才算）-> 中性
    ['睡眠怎么样？', ['sleep']],                // 回归：其他维度不受影响
    ['胃口如何？', ['diet']]                    // 回归：其他维度不受影响
];

for (const [text, want] of cases) {
    const res = resolveInquiry(questions, text);
    const got = res.type === 'joint'
        ? ['stool', 'urine']
        : res.type === 'match' ? [questions[res.index].dimension]
        : [];
    assert.deepStrictEqual(got, want, `"${text}" -> [${got}]，期望 [${want}]`);
    if (res.type === 'joint') {
        assert.ok(!res.answer.includes('。，'), '联合回答拼接不应残留多余标点');
        assert.strictEqual(res.indices.length, 2);
    }
}

// 联合回答必须是合并成一句，而不是两个标题
const joint = resolveInquiry(questions, '大小便怎么样？');
assert.strictEqual(joint.answer, '大便正常，每日一行，小便正常。');

console.log('✅ 问诊匹配测试全部通过（' + cases.length + ' 例）');

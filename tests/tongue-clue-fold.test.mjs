/* ===================== 舌象线索展开/收起状态回归测试 =====================
 * 运行： node tests/tongue-clue-fold.test.mjs
 *
 * 要守住的行为：
 *   - 提交舌象判断后，舌象线索默认折叠，但「正确舌象」直接可见
 *   - 用户点「展开」后，继续新增线索（renderClues() 重建 DOM）仍保持展开
 *   - 用户点「收起」后，继续新增线索仍保持收起
 *   - 切换病例后恢复默认折叠，不继承上一例的展开态
 *
 * 折叠态是纯 UI 状态（一个模块内变量 + DOM class），不进入 Game Session，
 * 因此这里只从 DOM 观察，不读取任何会话/持久化数据。
 * ====================================================================== */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSDOM_HOME = process.env.JSDOM_HOME || 'C:/Users/吴睿琳/.workbuddy/binaries/node/workspace/node_modules';
const { JSDOM } = await import(pathToFileURL(join(JSDOM_HOME, 'jsdom/lib/api.js')).href);

let pass = 0;
const failures = [];
function check(name, fn) {
    try { fn(); pass++; console.log('  ✅ ' + name); }
    catch (e) { failures.push(name + '  → ' + e.message); console.log('  ❌ ' + name + '  → ' + e.message); }
}

/* ---------------- 装配真实页面（与 inspection-images.test.mjs 同一套启动方式） ---------------- */
const dom = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf-8'), { url: 'https://tcm.test/', pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
globalThis.location = window.location;
globalThis.localStorage = window.localStorage;
globalThis.Image = window.Image;
globalThis.alert = () => {};
globalThis.confirm = () => true;
window.confirm = () => true;
window.scrollTo = () => {};
window.Element.prototype.scrollIntoView = function () {};

globalThis.fetch = async (url) => {
    const text = readFileSync(join(ROOT, String(url)), 'utf-8');
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
};

const origLog = console.log, origDebug = console.debug;
console.debug = () => {};
console.log = () => {};
await import(pathToFileURL(join(ROOT, 'js/app.js')).href);
await new Promise(r => setTimeout(r, 200));
console.log = origLog;
console.debug = origDebug;

const game = await import(pathToFileURL(join(ROOT, 'js/game.js')).href);
const inspection = await import(pathToFileURL(join(ROOT, 'js/inspection.js')).href);

const clueArea = () => document.getElementById('clueArea');
const tongueItems = () => [...clueArea().querySelectorAll('.clue-item.clue-tongue')];
const isExpanded = () => tongueItems().length > 0 && tongueItems().every(i => i.classList.contains('expanded'));
const clickToggle = () => {
    const btn = tongueItems()[0].querySelector('.clue-toggle');
    assert.ok(btn, '舌象线索必须带 .clue-toggle 按钮');
    btn.click();
};

// 走真实链路提交一次舌象判断：打开望诊 → 填判断 → 提交
function submitTongue(caseId, userText) {
    game.startCasePractice(caseId);
    inspection.openInspectionModal();
    document.getElementById('tongueJudgmentInput').value = userText;
    inspection.submitTongueJudgment();
}

console.log('\n=== 舌象线索展开/收起状态 ===\n');

submitTongue('inter-004', '舌体胖大有齿痕，苔白腻');

check('A. 提交舌象后默认折叠（且线索已生成）', () => {
    assert.equal(tongueItems().length, 1, '应生成一条舌象线索');
    assert.equal(isExpanded(), false, '默认不应带 expanded');
});

check('A2. 折叠态直接显示「正确舌象」，不是只显示判断结果', () => {
    const summary = tongueItems()[0].querySelector('.clue-tongue-summary').textContent;
    assert.ok(summary.includes('正确舌象'), '摘要必须含「正确舌象」：' + summary);
    assert.ok(summary.includes('判断正确'), '摘要应含总体结论：' + summary);
    // 折叠态不显示详情（详情段在 DOM 中，只是 CSS 隐藏）
    assert.ok(tongueItems()[0].querySelector('.clue-tongue-detail'), '详情段应保留在 DOM 中');
});

check('B. 点击「展开」后状态为展开', () => {
    clickToggle();
    assert.equal(isExpanded(), true, '点击后应带 expanded');
});

check('C. 手动 renderClues() 后仍然展开', () => {
    game.renderClues();
    assert.equal(isExpanded(), true, 'renderClues() 不应丢掉展开态');
});

check('D. 新增普通问诊线索（addClue → renderClues）后仍然展开', () => {
    const added = game.addClue('inquiry', '饮食正常，睡眠一般。', '问诊·测试');
    assert.equal(added, true, '应真的新增了一条普通线索');
    assert.equal(tongueItems().length, 1, '舌象线索仍只有一条');
    assert.equal(isExpanded(), true, '新增线索重建 DOM 后舌象仍应展开');
});

check('D2. 新增第二条舌象线索时，所有舌象线索展开态一致', () => {
    document.getElementById('tongueJudgmentInput').value = '舌体胖大有齿痕';
    inspection.submitTongueJudgment();   // 不同文本 → 去重不拦，生成第二条舌象线索
    assert.equal(tongueItems().length, 2, '应存在两条舌象线索');
    assert.equal(isExpanded(), true, '两条都应展开，不能一展开一折叠');
});

check('E. 点击「收起」后折叠，再新增线索仍保持折叠', () => {
    clickToggle();
    assert.equal(isExpanded(), false, '点击后应折叠（且两条同时折叠）');
    game.addClue('inquiry', '无明显畏寒发热。', '问诊·测试');
    assert.equal(isExpanded(), false, '新增线索后仍应保持收起');
});

check('E2. 收起态下 renderClues() 不会自己弹回展开', () => {
    game.renderClues();
    assert.equal(isExpanded(), false);
});

check('F. 切换病例后恢复默认折叠，不继承上一例的展开态', () => {
    clickToggle();                                   // 上一例先展开
    assert.equal(isExpanded(), true, '前置：上一例应处于展开');
    game.nextCase();                                 // 下一例
    assert.equal(tongueItems().length, 0, '新病例线索区应已清空');
    inspection.openInspectionModal();
    document.getElementById('tongueJudgmentInput').value = '舌红，苔白微腻';
    inspection.submitTongueJudgment();
    assert.equal(tongueItems().length, 1, '新病例应生成自己的舌象线索');
    assert.equal(isExpanded(), false, '新病例必须默认折叠');
});

check('F2. 从题库入口进入另一病例同样默认折叠', () => {
    clickToggle();
    assert.equal(isExpanded(), true, '前置：当前病例应处于展开');
    submitTongue('adv-001', '舌淡胖，边有齿痕，苔薄滑');
    assert.equal(isExpanded(), false, '题库入口切换病例也应默认折叠');
});

check('F3. 「重新探查」同样恢复默认折叠', () => {
    clickToggle();
    assert.equal(isExpanded(), true, '前置：当前病例应处于展开');
    game.resetCurrentCase();          // 内部会 confirm，测试里已 stub 成 true
    inspection.openInspectionModal();
    document.getElementById('tongueJudgmentInput').value = '舌红，苔白微腻';
    inspection.submitTongueJudgment();
    assert.equal(isExpanded(), false, '重新探查后必须默认折叠');
});

check('G. 折叠态不进入会话快照（Session 里没有展开状态）', () => {
    clickToggle();
    assert.equal(isExpanded(), true, '前置：已展开');
    const s = game.getSession();
    // 只看会话自身的可变容器，不看 case.current（那是 data.js 的只读病例记录）
    const sessionJson = JSON.stringify({
        phase: s.phase,
        case: { difficulty: s.case.difficulty, index: s.case.index },
        diagnosis: s.diagnosis,
        inquiry: s.inquiry,
        inspection: s.inspection,
        progress: s.progress
    });
    assert.equal(/expand/i.test(sessionJson), false,
        '会话快照里不应出现任何展开态字段：' + sessionJson);
});

/* ---------------- 结果 ---------------- */
console.log('\n=== 结果 ===');
console.log(`通过 ${pass}，失败 ${failures.length}`);
if (failures.length) {
    console.log('\n失败项：');
    failures.forEach(f => console.log(' - ' + f));
    process.exit(1);
}

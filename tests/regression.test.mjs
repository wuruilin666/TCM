/* ===================== 端到端回归测试（jsdom） =====================
 * 运行： NODE_PATH=<node workspace>/node_modules node tests/regression.test.mjs
 *
 * 用真实 index.html + 真实 ES Module 依赖图跑通全链路，
 * 覆盖：首页 / 闯关 / 三阶段 / 四诊 / 问诊匹配 / 舌象 / 答题 / 错题 / 题库 / 进度 / 备份 / 恢复。
 * ================================================================ */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// jsdom 从受管 Node 工作区按绝对路径加载（ESM 不走 NODE_PATH）
const JSDOM_HOME = process.env.JSDOM_HOME || 'C:/Users/吴睿琳/.workbuddy/binaries/node/workspace/node_modules';
const { JSDOM } = await import(pathToFileURL(join(JSDOM_HOME, 'jsdom/lib/api.js')).href);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; failures.push(name + (detail ? '  → ' + detail : '')); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}

/* ---------------- 搭建浏览器环境 ---------------- */
const html = readFileSync(join(ROOT, 'index.html'), 'utf-8');
const dom = new JSDOM(html, { url: 'https://tcm.test/', pretendToBeVisual: true });
const { window } = dom;

// 把浏览器全局暴露给 Node，供模块使用
globalThis.window = window;
globalThis.document = window.document;
// Node 22 的 navigator 是只读 getter，用 defineProperty 覆盖为 jsdom 的实例
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
globalThis.location = window.location;
globalThis.history = window.history;
globalThis.alert = () => {};
globalThis.confirm = () => true;
window.alert = () => {};
window.confirm = () => true;
window.scrollTo = () => {};
window.Element.prototype.scrollIntoView = function () {};

// localStorage / crypto / btoa / atob：Node 已提供 crypto、TextEncoder，jsdom 提供 localStorage
globalThis.localStorage = window.localStorage;
globalThis.btoa = globalThis.btoa || window.btoa.bind(window);
globalThis.atob = globalThis.atob || window.atob.bind(window);

// fetch：从磁盘读取病例 JSON，模拟静态托管
const fetchCalls = [];
globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    const path = join(ROOT, String(url));
    const text = readFileSync(path, 'utf-8');
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
};

// 抑制调试日志噪音
const origLog = console.log;
const origDebug = console.debug;
console.debug = () => {};
console.log = () => {};
const restoreLog = () => { console.log = origLog; console.debug = origDebug; };

try {
    /* ---------------- 启动应用 ---------------- */
    await import(pathToFileURL(join(ROOT, 'js/app.js')).href);
    await new Promise(r => setTimeout(r, 200));

    restoreLog();
    console.log('\n=== A. 启动与页面结构 ===\n');
    check('病例数据从三个难度文件加载', fetchCalls.filter(u => u.includes('data/cases/')).length === 3, fetchCalls.join(','));
    check('首页为默认激活页', document.getElementById('pageHome').classList.contains('active'));
    check('加载完成后 loadingIndicator 已被页面结构替换',
        !document.getElementById('loadingIndicator'), 'appContainer 已被 initApp 重写');
    const diffBtns = document.querySelectorAll('#difficultyBtns .btn--difficulty');
    check('三个训练阶段按钮渲染', diffBtns.length === 3);
    check('难度计数已填充（非占位符 —）',
        ['basic', 'intermediate', 'advanced'].every(d => document.getElementById('diffCount_' + d).textContent.includes('/')));
    check('题库计数已填充', document.getElementById('bankCount').textContent.includes('则'));
    check('「我的」页统计已渲染', document.getElementById('meStatDone').textContent !== '');

    /* ---------------- B. 闯关流程（basic） ---------------- */
    console.log('\n=== B. 闯关流程 · 入门训练 ===\n');
    const basicBtn = document.querySelector('#difficultyBtns [data-diff="basic"]');
    window.selectDifficulty('basic', basicBtn);
    check('选关后病例工作区可见', document.getElementById('caseWorkspace').style.display === 'block');
    check('选关后难度选择器隐藏', document.getElementById('difficultyPicker').style.display === 'none');
    check('顶部显示训练阶段名', document.getElementById('caseTopDiffName').textContent === '入门训练',
        document.getElementById('caseTopDiffName').textContent);
    check('显示主诉文本', document.getElementById('chiefComplaintText').textContent.length > 0);
    check('四诊按钮显示', document.getElementById('fourDiagBtns').style.display === 'grid');
    check('计数显示为 1 / N', /^病例 1 \/ \d+$/.test(document.getElementById('caseCounter').textContent),
        document.getElementById('caseCounter').textContent);
    const caseCount = Number(document.getElementById('caseCounter').textContent.split('/')[1].trim());

    /* ---------------- C. 四诊探索 ---------------- */
    console.log('\n=== C. 四诊探索 ===\n');
    const game = await import(pathToFileURL(join(ROOT, 'js/game.js')).href);
    const caseId = game.getCurrentCase().id;

    window.exploreDiag('pulse');
    check('切诊弹窗打开', document.getElementById('simpleResultModal').style.display === 'flex');
    check('切诊线索进入线索区', document.querySelectorAll('#clueArea .clue-item').length === 1);
    window.closeSimpleResultModal();
    const clueCountAfterPulse = document.querySelectorAll('#clueArea .clue-item').length;

    window.exploreDiag('auscultation');
    window.closeSimpleResultModal();
    check('闻诊线索追加（不复用同一线索）',
        document.querySelectorAll('#clueArea .clue-item').length === clueCountAfterPulse + 1,
        `${document.querySelectorAll('#clueArea .clue-item').length}`);

    // 重复探索同一诊法：应弹提示且不新增线索
    window.exploreDiag('pulse');
    check('重复探索切诊不新增线索',
        document.querySelectorAll('#clueArea .clue-item').length === clueCountAfterPulse + 1);

    /* ---------------- D. 望诊 / 舌象 ---------------- */
    console.log('\n=== D. 望诊 / 舌象判断 ===\n');
    window.exploreDiag('inspection');
    check('望诊弹窗打开', document.getElementById('inspectionModal').style.display === 'flex');
    check('舌象来源角标已渲染', document.getElementById('tongueImageBadge').textContent.length > 0);
    const tongueInput = document.getElementById('tongueJudgmentInput');
    // 用病例原文舌象描述作答：应判为完全正确（病例没提供舌形时，舌形不参与评分）
    tongueInput.value = game.getCurrentCase().clues.inspection.tongueDesc;
    window.submitTongueJudgment();
    check('提交舌象判断后弹窗关闭', document.getElementById('inspectionModal').style.display === 'none');
    const tongueClue = [...document.querySelectorAll('#clueArea .clue-item')].find(el => el.textContent.includes('舌象判断'));
    check('舌象判断写入线索', !!tongueClue);
    check('答出病例原文 → 线索显示「判断正确」',
        !!tongueClue && /判断正确/.test(tongueClue.textContent), tongueClue && tongueClue.textContent);
    check('舌象线索含逐维度反馈：病例未提供的维度标「本病例未提供」',
        !!tongueClue && /本病例未提供/.test(tongueClue.textContent));
    check('望诊按钮标记为已探索', document.getElementById('btnWang').classList.contains('explored'));

    /* ---------------- E. 问诊匹配 ---------------- */
    console.log('\n=== E. 问诊交互与匹配 ===\n');
    window.exploreDiag('inquiry');
    check('问诊弹窗打开', document.getElementById('inquiryModal').style.display === 'flex');
    const inquiryInput = document.getElementById('inquiryInput');
    const questions = game.getCurrentCase().clues.inquiry.questions;
    inquiryInput.value = questions[0].q;
    window.sendInquiry();
    await new Promise(r => setTimeout(r, 400));
    const bubbles = document.querySelectorAll('#inquiryChatArea .chat-bubble');
    check('问诊产生用户 + 患者气泡', bubbles.length >= 2, `${bubbles.length}`);
    check('患者气泡给出病例答案',
        bubbles[bubbles.length - 1].textContent.includes(questions[0].a.slice(0, 4)),
        bubbles[bubbles.length - 1].textContent);
    const inquiryClue = [...document.querySelectorAll('#clueArea .clue-item')].find(el => el.textContent.includes('问诊·'));
    check('问诊命中写入线索（含「问诊·」标签）', !!inquiryClue);
    window.closeInquiryModal();

    /* ---------------- F. 答题判定 ---------------- */
    console.log('\n=== F. 答题判定 ===\n');
    const current = game.getCurrentCase();
    document.getElementById('inputDisease').value = current.correctAnswer.disease;
    document.getElementById('inputSyndrome').value = current.correctAnswer.syndrome;
    document.getElementById('inputBasis').value = '测试辨证依据';
    window.submitAnswer();
    const fbText = document.getElementById('answerFeedback').textContent;
    check('完全正确 → 显示「辨证正确」', fbText.includes('辨证正确'), fbText.slice(0, 60));

    window.viewAnswer();
    check('显示答案后渲染完整医案解析',
        document.getElementById('fullAnalysisArea').textContent.includes('完整医案解析'));
    check('解析包含病机分析',
        document.getElementById('fullAnalysisArea').textContent.includes('病机分析'));
    const progressStore = await import(pathToFileURL(join(ROOT, 'js/storage/progress-storage.js')).href);
    check('查看答案后病例标记为已完成', progressStore.getCompletedCases().includes(caseId),
        JSON.stringify(progressStore.getCompletedCases()));

    // 错误答案
    window.nextCase();
    const secondCase = game.getCurrentCase();
    document.getElementById('inputDisease').value = '错误病名XYZ';
    document.getElementById('inputSyndrome').value = '错误证型XYZ';
    document.getElementById('inputBasis').value = '错误依据';
    window.submitAnswer();
    const fbText2 = document.getElementById('answerFeedback').textContent;
    check('完全错误 → 显示「辨证偏差较大」', fbText2.includes('辨证偏差较大'), fbText2.slice(0, 60));
    const wrongs = progressStore.getWrongCases();
    check('错题已记录', wrongs.some(w => w.id === secondCase.id), JSON.stringify(wrongs.map(w => w.id)));
    check('错题记录含用户答案', wrongs.find(w => w.id === secondCase.id)?.disease === '错误病名XYZ');
    check('错题记录含难度', wrongs.find(w => w.id === secondCase.id)?.difficulty === 'basic');

    // 部分正确
    window.nextCase();
    const thirdCase = game.getCurrentCase();
    document.getElementById('inputDisease').value = thirdCase.correctAnswer.disease;
    document.getElementById('inputSyndrome').value = '不匹配的证型XYZ';
    document.getElementById('inputBasis').value = '依据';
    window.submitAnswer();
    const fbText3 = document.getElementById('answerFeedback').textContent;
    check('仅病名正确 → 显示「部分正确」', fbText3.includes('部分正确'), fbText3.slice(0, 60));
    check('部分正确提示病名基本正确', fbText3.includes('病名基本正确'));

    /* ---------------- G. 重新探查 ---------------- */
    console.log('\n=== G. 重新探查 ===\n');
    window.resetCurrentCase();
    check('重新探查清空线索', document.querySelectorAll('#clueArea .clue-item').length === 0);
    check('重新探查清空反馈', document.getElementById('answerFeedback').innerHTML === '');
    check('重新探查清空表单', document.getElementById('inputSyndrome').value === '');
    check('重新探查重置四诊按钮',
        !document.getElementById('btnWang').classList.contains('explored'));

    /* ---------------- H. 错题本 ---------------- */
    console.log('\n=== H. 我的错题 ===\n');
    window.openRecords();
    check('错题本弹窗打开', document.getElementById('recordsModal').style.display === 'flex');
    check('错题卡片渲染', document.querySelectorAll('#recordsContent .wrong-card').length >= 1);
    check('错题卡含「重新挑战」', document.getElementById('recordsContent').textContent.includes('重新挑战'));
    window.viewWrongCaseAnalysis(secondCase.id);
    check('查看错题解析打开详情弹窗', document.getElementById('caseDetailModal').style.display === 'flex');
    check('详情弹窗渲染完整医案',
        document.getElementById('caseDetailContent').textContent.includes('病机分析'));
    window.closeCaseDetail();
    window.closeRecords();

    /* ---------------- I. 题库 ---------------- */
    console.log('\n=== I. 病例题库 ===\n');
    window.openCaseBank();
    check('题库页面激活', document.getElementById('pageBank').classList.contains('active'));
    check('题库筛选栏渲染', document.getElementById('bankFilterBar').textContent.includes('分类'));
    check('题库列表渲染', document.querySelectorAll('#caseBankList .case-bank-item').length > 0);
    const totalCases = document.querySelectorAll('#caseBankList .case-bank-item').length;
    check('题库统计摘要存在', document.getElementById('caseBankList').textContent.includes('共'));

    window.selectBankCategory('pulmonary');
    const filtered = document.querySelectorAll('#caseBankList .case-bank-item').length;
    check('分类筛选生效', filtered <= totalCases && document.querySelector('#bankFilterBar .bank-chip.active') !== null);
    window.selectBankCategory('all');
    window.selectBankDiff('advanced');
    const advFiltered = document.querySelectorAll('#caseBankList .case-bank-item').length;
    check('难度筛选生效', advFiltered < totalCases, `${advFiltered} < ${totalCases}`);
    window.selectBankDiff('all');

    document.getElementById('caseSearchInput').value = 'zzz不存在的关键词zzz';
    window.filterCaseBank();
    check('搜索无结果提示', document.getElementById('caseBankList').textContent.includes('未找到匹配病例'));
    document.getElementById('caseSearchInput').value = '';
    window.filterCaseBank();

    window.challengeCaseFromBank(caseId);
    check('题库「挑战病例」进入闯关页', document.getElementById('pageGame').classList.contains('active'));
    check('题库挑战定位到目标病例', game.getCurrentCase().id === caseId,
        `期望 ${caseId} 实际 ${game.getCurrentCase().id}`);
    check('题库挑战同步难度', document.getElementById('caseTopDiffName').textContent === '入门训练');

    /* ---------------- J. 学习进度 ---------------- */
    console.log('\n=== J. 学习进度统计 ===\n');
    const before = progressStore.getProgressSummary(19);
    check('进度摘要字段完整',
        typeof before.total === 'number' && typeof before.done === 'number' &&
        typeof before.wrong === 'number' && typeof before.remaining === 'number' &&
        typeof before.percent === 'number', JSON.stringify(before));
    check('已完成数 >= 查看过答案的病例数', before.done >= 1, JSON.stringify(before));
    check('剩余 = 总数 - 已完成', before.remaining === Math.max(0, before.total - before.done));

    /* ---------------- K. 备份码（核心兼容性） ---------------- */
    console.log('\n=== K. 备份码 生成 / 解析 ===\n');
    const backup = await import(pathToFileURL(join(ROOT, 'js/storage/backup-service.js')).href);
    const code = await backup.createProgressBackupCode();
    check('生成 TCM1 备份码', code.startsWith('TCM1:'), code.slice(0, 20));
    const parsed = await backup.parseProgressBackupCode(code);
    check('备份码可回读', parsed.ok === true, JSON.stringify(parsed).slice(0, 120));
    check('回读保留已完成病例', parsed.ok && parsed.data.completedCases.length === before.done,
        parsed.ok ? `${parsed.data.completedCases.length} vs ${before.done}` : '');
    check('回读保留错题', parsed.ok && parsed.data.wrongCases.length === before.wrong);

    // 传输污染：插入换行/空格/零宽字符后仍可恢复
    const dirty = '  ' + code.slice(0, 10) + '\n' + code.slice(10, 200) + '\u200b' + code.slice(200) + '  \n';
    const parsedDirty = await backup.parseProgressBackupCode(dirty);
    check('备份码容忍换行/空格/零宽字符', parsedDirty.ok === true, JSON.stringify(parsedDirty).slice(0, 120));

    // 损坏：改动正文中间字符 → checksum 必须报错而非静默
    const mid = Math.floor(code.length / 2);
    const corrupted = code.slice(0, mid) + (code[mid] === 'A' ? 'B' : 'A') + code.slice(mid + 1);
    const parsedBad = await backup.parseProgressBackupCode(corrupted);
    check('被篡改的备份码被拒绝', parsedBad.ok === false, JSON.stringify(parsedBad).slice(0, 120));

    const notACode = await backup.parseProgressBackupCode('这不是备份码');
    check('非备份码输入给出明确错误', notACode.ok === false && !!notACode.error);

    const legacy = await backup.parseProgressBackupCode('TCM2:abcdefg');
    check('旧版 TCM2 给出 legacy 提示', legacy.ok === false && legacy.kind === 'legacy', JSON.stringify(legacy).slice(0, 100));

    // 分段备份码
    const parts = await backup.createProgressBackupParts();
    check('分段结果含 code 与 parts', !!parts.code && Array.isArray(parts.parts) && parts.parts.length >= 1);
    const parsedParts = await backup.parseProgressBackupCode(parts.parts.join('\n'));
    check('分段备份码可拼接恢复', parsedParts.ok === true, JSON.stringify(parsedParts).slice(0, 120));

    /* ---------------- L. 备份文件 导入 / 恢复 ---------------- */
    console.log('\n=== L. 备份文件导入 / 恢复 ===\n');
    const payload = backup.buildProgressPayload();
    check('备份文件结构含 app/type/version',
        payload.app === 'TCM' && payload.type === 'learning-progress' && payload.version === 1);
    const validated = backup.validateProgressData(payload);
    check('备份文件校验通过', validated.ok === true);

    const badVersion = backup.validateProgressData({ ...payload, version: 99 });
    check('高版本备份文件被拒绝并提示', badVersion.ok === false && /更新版本/.test(badVersion.error));

    const badShape = backup.validateProgressData({ app: 'OTHER', type: 'x' });
    check('结构不符的备份文件被拒绝', badShape.ok === false);

    // 合并导入：不清空当前数据
    const mergeTarget = { completedCases: ['adv-001'], wrongCases: [] };
    progressStore.mergeProgress(mergeTarget);
    check('合并导入保留原数据',
        progressStore.getCompletedCases().includes('adv-001') &&
        progressStore.getCompletedCases().includes(caseId));
    // 覆盖导入：清掉旧数据
    progressStore.replaceProgress({ completedCases: ['adv-002'], wrongCases: [] });
    check('覆盖导入替换原数据',
        progressStore.getCompletedCases().length === 1 &&
        progressStore.getCompletedCases()[0] === 'adv-002',
        JSON.stringify(progressStore.getCompletedCases()));
    check('覆盖导入同时清空错题', progressStore.getWrongCases().length === 0);

    /* ---------------- L2. 错题去重键的分隔符 ---------------- */
    console.log('\n=== L2. wrongKey 分隔符（行为恢复） ===\n');
    // 下面两条记录的字段边界不同，但「直接拼接」会得到同一个字符串：
    //   '' 拼接     → basic-0012026-01-01abcd（两条撞车 → 被误当成重复）
    //   DEL 分隔    → basic-001␟2026-01-01␟ab␟c␟d（两条不同 → 都保留）
    progressStore.replaceProgress({ completedCases: [], wrongCases: [] });
    progressStore.mergeProgress({
        completedCases: [],
        wrongCases: [
            { id: 'basic-001', difficulty: 'basic', date: '2026-01-01', syndrome: 'ab', disease: 'c', basis: 'd' },
            { id: 'basic-001', difficulty: 'basic', date: '2026-01-01', syndrome: 'a', disease: 'bc', basis: 'd' }
        ]
    });
    check('字段边界不同即视为两条不同错题（分隔符已恢复）',
        progressStore.getWrongCases().length === 2,
        `${progressStore.getWrongCases().length} 条`);

    const wrongKeySrc = readFileSync(join(ROOT, 'js/storage/progress-storage.js'), 'utf-8');
    check('wrongKey 使用 \u007f 转义作为分隔符', /join\('\\u007f'\)/.test(wrongKeySrc));
    check('源码中不含肉眼不可见的 DEL 字面字符（防止再次被复制丢失）',
        !/\u007f/.test(wrongKeySrc));
    check('replaceProgress 不再声称「原子」',
        !/原子|atomic/.test(readFileSync(join(ROOT, 'js/storage/progress-storage.js'), 'utf-8').replace(/^\/\/.*$/gm, '')));

    /* ---------------- M. 清空错题 / 重置进度 ---------------- */
    console.log('\n=== M. 清空错题 / 重置进度 ===\n');
    progressStore.saveWrongCase({ syndrome: 's', disease: 'd', basis: 'b' }, { id: 'basic-001', title: 't', chiefComplaint: 'c' }, 'basic');
    check('写错题成功', progressStore.getWrongCases().length === 1);
    window.clearRecords();
    check('清空错题生效', progressStore.getWrongCases().length === 0);
    window.resetProgress();
    check('重置进度清空已完成', progressStore.getCompletedCases().length === 0);
    check('重置进度清空错题', progressStore.getWrongCases().length === 0);
    check('重置进度刷新「我的」页统计', document.getElementById('meStatDone').textContent === '0');

    /* ---------------- N. 投稿表单 ---------------- */
    console.log('\n=== N. 投稿表单 ===\n');
    window.openSubmissionModal();
    check('投稿弹窗打开', document.getElementById('submissionModal').style.display === 'flex');
    check('投稿回跳地址已填充', document.getElementById('formNext').value.includes('submitted=true'),
        document.getElementById('formNext').value);
    const emptyResult = window.validateSubmissionForm();
    check('必填项为空时校验失败', emptyResult === false);
    check('显示必填提示', document.getElementById('submissionFeedback').textContent.includes('必填'));
    window.closeSubmissionModal();
    check('投稿弹窗关闭', document.getElementById('submissionModal').style.display === 'none');

    /* ---------------- O. 导航 ---------------- */
    console.log('\n=== O. 页面导航 ===\n');
    window.goHome();
    check('返回首页', document.getElementById('pageHome').classList.contains('active'));
    window.showMe();
    check('「我的」页激活', document.getElementById('pageMe').classList.contains('active'));
    check('宽屏壳层应用于「我的」页', document.getElementById('appContainer').classList.contains('wide'));
    window.showAbout();
    check('关于页激活', document.getElementById('pageAbout').classList.contains('active'));

    /* ---------------- P. 模块边界 ---------------- */
    console.log('\n=== P. 模块边界（架构约束） ===\n');
    check('game.js 不再导出可变 state 对象', game.state === undefined,
        'state 应保持模块私有');
    check('game.js 提供只读会话视图 getSession', typeof game.getSession === 'function');
    check('已被 getSession 取代的读取接口已删除',
        game.getInspectionImages === undefined
        && game.getInspectionIndex === undefined
        && game.isExplored === undefined,
        'getInspectionImages / getInspectionIndex / isExplored 应已删除');

    const inquirySrc = readFileSync(join(ROOT, 'js/inquiry.js'), 'utf-8');
    check('inquiry.js 不 import state', !/import\s*\{[^}]*\bstate\b/.test(inquirySrc));
    check('inquiry.js 通过 getSession().inquiry.history 读取会话',
        /getSession\(\)\.inquiry\.history/.test(inquirySrc));
    const inspectionSrc = readFileSync(join(ROOT, 'js/inspection.js'), 'utf-8');
    check('inspection.js 不 import state', !/import\s*\{[^}]*\bstate\b/.test(inspectionSrc));
    check('inspection.js 通过 getSession().inspection 读取会话',
        /getSession\(\)\.inspection\b/.test(inspectionSrc));
    check('inspection.js 不含旧版扁平字段读取',
        !/getSession\(\)\.(inspectionImages|inspectionIndex|inspectionNonTongueAdded)/.test(inspectionSrc));
    const bankSrc = readFileSync(join(ROOT, 'js/case-bank.js'), 'utf-8');
    check('case-bank.js 不 import state', !/import\s*\{[^}]*\bstate\b/.test(bankSrc));
    check('case-bank.js 不直接写 localStorage', !/localStorage\.(set|remove)Item/.test(bankSrc));
    const gameSrc = readFileSync(join(ROOT, 'js/game.js'), 'utf-8');
    check('game.js 不 import storage', !/from\s+['"][^'"]*storage/.test(gameSrc));
    check('game.js 不直接访问 localStorage', !/localStorage/.test(gameSrc));

    /* ---------------- P2. getSession 快照隔离 ---------------- */
    console.log('\n=== P2. getSession 快照隔离 ===\n');
    // 先造出一个「已开诊 + 已收集线索」的非空会话，再验证外部改不动内部
    window.resetGameUI();
    window.selectDifficulty('basic', document.querySelector('#difficultyBtns [data-diff="basic"]'));
    window.exploreDiag('pulse');
    window.closeSimpleResultModal();

    const snapshot = game.getSession();
    // 外部对快照做各种破坏性写入
    snapshot.phase = 'HACKED';
    snapshot.case.current = null;
    snapshot.case.index = 999;
    snapshot.diagnosis.collectedClues.push({ tag: '注入', tagClass: '', content: '注入' });
    snapshot.diagnosis.collectedClues[0].content = '被改写';
    snapshot.diagnosis.exploredDiags.pulse = false;
    snapshot.inquiry.history.push({ role: 'user', text: '注入' });
    snapshot.inquiry.askedQuestions.push(999);
    snapshot.inspection.images.push('injected.jpg');
    snapshot.inspection.index = 42;
    snapshot.inspection.nonTongueAdded = true;
    snapshot.progress.unfinishedCases.length = 0;

    const after = game.getSession();
    check('快照的 phase / case 改不到内部',
        after.phase === 'EXPLORING' && after.case.index === 0 && after.case.current !== null,
        `${after.phase} / index=${after.case.index} / case=${after.case.current && after.case.current.id}`);
    check('collectedClues 是独立数组，且元素也是副本',
        after.diagnosis.collectedClues.length === 1
        && after.diagnosis.collectedClues[0].content !== '被改写',
        `${after.diagnosis.collectedClues.length} 条`);
    check('exploredDiags 是独立对象', after.diagnosis.exploredDiags.pulse === true);
    check('inquiry.history 是独立数组', after.inquiry.history.length === 0);
    check('inquiry.askedQuestions 是独立数组', after.inquiry.askedQuestions.length === 0);
    check('inspection.images 是独立数组', after.inspection.images.every(p => p !== 'injected.jpg'));
    check('inspection.index / nonTongueAdded 改不到内部',
        after.inspection.index === 0 && after.inspection.nonTongueAdded === false);
    check('progress.unfinishedCases 是独立数组', after.progress.unfinishedCases.length > 0);
    check('每次调用都返回新的顶层对象', game.getSession() !== game.getSession());
    check('每次调用都返回新的子容器', game.getSession().inquiry !== game.getSession().inquiry);

    /* ---------------- P3. 会话阶段生命周期 ---------------- */
    console.log('\n=== P3. 会话阶段（phase）生命周期 ===\n');
    window.resetGameUI();
    check('resetGameUI 后 phase = IDLE', game.getSession().phase === 'IDLE');
    const idle = game.getSession();
    check('IDLE 会话就是 createSession() 的初始形状',
        idle.case.current === null && idle.case.difficulty === null && idle.case.index === 0
        && idle.diagnosis.collectedClues.length === 0
        && idle.diagnosis.lastAnswerWasCorrect === null
        && idle.inquiry.history.length === 0 && idle.inquiry.askedQuestions.length === 0
        && idle.inspection.images.length === 0 && idle.inspection.index === 0
        && idle.inspection.nonTongueAdded === false
        && idle.progress.unfinishedCases.length === 0,
        JSON.stringify(idle));

    window.selectDifficulty('basic', document.querySelector('#difficultyBtns [data-diff="basic"]'));
    check('开诊后 phase = EXPLORING', game.getSession().phase === 'EXPLORING');
    const phaseCase = game.getCurrentCase();
    document.getElementById('inputDisease').value = phaseCase.correctAnswer.disease;
    document.getElementById('inputSyndrome').value = phaseCase.correctAnswer.syndrome;
    document.getElementById('inputBasis').value = '阶段测试依据';
    window.submitAnswer();
    check('提交辨证后 phase = SUBMITTED', game.getSession().phase === 'SUBMITTED');

    // 关键行为回归：原实现用 gameStarted 拦截，提交后仍为 true，
    // 因此 SUBMITTED 阶段必须仍能继续探查与重新提交。
    window.exploreDiag('pulse');
    check('SUBMITTED 阶段仍可继续探查四诊',
        document.querySelectorAll('#clueArea .clue-item').length > 0,
        document.getElementById('simpleResultModal').style.display);
    window.closeSimpleResultModal();
    window.submitAnswer();
    check('SUBMITTED 阶段仍可重新提交',
        document.getElementById('answerFeedback').textContent.includes('辨证正确'),
        document.getElementById('answerFeedback').textContent.slice(0, 40));
    check('重新提交后 phase 仍为 SUBMITTED', game.getSession().phase === 'SUBMITTED');

    window.resetCurrentCase();
    check('重新探查后 phase 回到 EXPLORING', game.getSession().phase === 'EXPLORING');
    check('重新探查清空线索', document.querySelectorAll('#clueArea .clue-item').length === 0);

    // 切换病例：per-case 状态应被重建，而不是各入口手工清一部分
    window.resetGameUI();
    window.selectDifficulty('intermediate', document.querySelector('#difficultyBtns [data-diff="intermediate"]'));
    window.exploreDiag('pulse');
    window.closeSimpleResultModal();
    const cluesBeforeSwitch = document.querySelectorAll('#clueArea .clue-item').length;
    window.nextCase();
    check('切换下一例后线索被清空（病例状态已重建）',
        cluesBeforeSwitch > 0 && document.querySelectorAll('#clueArea .clue-item').length === 0,
        `切换前 ${cluesBeforeSwitch} 条`);
    check('切换下一例后 phase = EXPLORING', game.getSession().phase === 'EXPLORING');
    check('切换下一例后 case.index 前进 1', game.getSession().case.index === 1,
        `${game.getSession().case.index}`);

    // 行为保持：重新探查不重置望诊浏览位置（与原实现一致）
    game.startCasePractice('inter-006');
    game.setInspectionIndex(1);
    window.resetCurrentCase();
    check('重新探查保留望诊图片列表', game.getSession().inspection.images.length === 2);
    check('重新探查保留望诊浏览位置（与原实现一致）',
        game.getSession().inspection.index === 1, `${game.getSession().inspection.index}`);

    /* ---------------- Q. 三阶段全覆盖 ---------------- */
    console.log('\n=== Q. 三种训练阶段 ===\n');
    for (const diff of ['basic', 'intermediate', 'advanced']) {
        window.resetGameUI();
        const btn = document.querySelector(`#difficultyBtns [data-diff="${diff}"]`);
        window.selectDifficulty(diff, btn);
        const ok = document.getElementById('caseWorkspace').style.display === 'block'
            && game.getCurrentCase()
            && game.getCurrentCase().difficulty === diff
            && document.getElementById('chiefComplaintText').textContent.length > 0;
        check(`${diff} 阶段可正常开诊并通过病例校验`, !!ok,
            game.getCurrentCase() ? game.getCurrentCase().id : 'null');
    }

    /* ---------------- R. 全部病例数据完整性 ---------------- */
    console.log('\n=== R. 全量病例数据完整性 ===\n');
    const data = await import(pathToFileURL(join(ROOT, 'js/data.js')).href);
    const allCases = data.getAllCases();
    check('全部病例已加载（19 例）', allCases.length === 19, `${allCases.length}`);
    check('每例都有合法 difficulty', allCases.every(c => data.diffMap[c.difficulty]));
    check('每例都有合法 category', allCases.every(c => data.categoryMap[c.category]));
    check('每例都有问诊题与合法 dimension',
        allCases.every(c => c.clues.inquiry.questions.every(q => data.VALID_INQUIRY_DIMENSIONS.has(q.dimension))));
    check('每例都有 tongueJudgment', allCases.every(c => c.clues.inspection.tongueJudgment));
    check('每例都有 correctAnswer.syndrome', allCases.every(c => !!c.correctAnswer.syndrome));

    /* ---------------- S. 多意图问诊：已问的题目不得阻断后续 ---------------- */
    console.log('\n=== S. 多意图问诊（一个已问 + 两个未问） ===\n');
    const { resolveInquiry: resolveForTest } = await import(pathToFileURL(join(ROOT, 'js/inquiry-matcher.js')).href);
    game.startCasePractice('adv-007');
    const multiQs = game.getCurrentCase().clues.inquiry.questions;
    const clueNum = () => document.querySelectorAll('#clueArea .clue-item').length;
    const askedOf = () => game.getSession().inquiry.askedQuestions.slice();

    // 前置：先用只命中一题的输入，把其中一题问成「已问」
    const preIndices = resolveForTest(multiQs, '末次月经时间').indices;
    inquiryInput.value = '末次月经时间';
    window.sendInquiry();
    await new Promise(r => setTimeout(r, 400));
    check('S 前置：单意图问诊只记录一题',
        preIndices.length === 1 && askedOf().join() === preIndices.join(),
        `${JSON.stringify(preIndices)} / ${JSON.stringify(askedOf())}`);

    // 一句同时问三件事，且第一个索引就是刚问过的那题
    const multiText = '月经量情况，末次月经时间，月经颜色及血块情况';
    const multiIndices = resolveForTest(multiQs, multiText).indices.slice();
    check('S 前置：matcher 对同一句话返回 3 个意图', multiIndices.length === 3, JSON.stringify(multiIndices));
    check('S 前置：该句的第一个意图确实是已问过的那题',
        multiIndices[0] === preIndices[0], `${multiIndices[0]} vs ${preIndices[0]}`);

    const cluesBefore = clueNum();
    inquiryInput.value = multiText;
    window.sendInquiry();
    await new Promise(r => setTimeout(r, 400));

    const expected = multiIndices.slice().sort((a, b) => a - b);
    const askedAfter = askedOf().sort((a, b) => a - b);
    check('S 已问的题目不重复计入（长度 3，而非卡在 1）',
        askedAfter.length === expected.length, JSON.stringify(askedAfter));
    check('S 已问题目不重复、未问题目全部记账',
        askedAfter.join() === expected.join(),
        `期望 ${JSON.stringify(expected)} 实际 ${JSON.stringify(askedAfter)}`);
    check('S 未问的两题各自产生线索',
        clueNum() === cluesBefore + expected.length - 1,
        `${clueNum()} vs ${cluesBefore}+${expected.length - 1}`);
    const multiBubbles = document.querySelectorAll('#inquiryChatArea .chat-bubble');
    const multiAnswer = multiBubbles[multiBubbles.length - 1].textContent;
    check('S 患者回答同时含已问提示与两个新问题的答案',
        multiAnswer.includes('已经回答过') && /经色暗/.test(multiAnswer) && /月经量较少/.test(multiAnswer),
        multiAnswer);
    check('S getInquiryProgress 与已问列表一致、未误报完成',
        game.getInquiryProgress().asked === expected.length && game.getInquiryProgress().allAsked === false,
        JSON.stringify(game.getInquiryProgress()));

    // 逐题问完剩余问题，完成度应真正到达 100%（旧实现会在重复处提前 break）
    for (const [i, q] of multiQs.entries()) {
        if (askedOf().includes(i)) continue;
        inquiryInput.value = q.q;
        window.sendInquiry();
    }
    await new Promise(r => setTimeout(r, 500));
    const finalProgress = game.getInquiryProgress();
    check('S 逐题问完后完成度到达 100%',
        finalProgress.allAsked === true && finalProgress.asked === finalProgress.total,
        JSON.stringify(finalProgress));

    // 已全部问过后再问同一句：不得重复计数、不得重复产生线索
    const cluesAllAsked = clueNum();
    inquiryInput.value = multiText;
    window.sendInquiry();
    await new Promise(r => setTimeout(r, 400));
    check('S 已全部问过后再问同一句：已问数量不变',
        askedOf().length === finalProgress.total, JSON.stringify(askedOf()));
    check('S 已全部问过后再问同一句：不重复产生线索',
        clueNum() === cluesAllAsked, `${clueNum()} vs ${cluesAllAsked}`);

} catch (e) {
    restoreLog();
    console.error('\n❌ 运行异常：', e);
    fail++;
    failures.push('运行异常：' + e.message);
}

restoreLog();
console.log('\n=== 结果 ===');
console.log(`通过 ${pass}，失败 ${fail}`);
if (failures.length) {
    console.log('\n失败项：');
    failures.forEach(f => console.log(' - ' + f));
    process.exit(1);
}

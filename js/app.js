/* ===================== 应用入口（页面结构 / 导航 / 全局事件 / window 暴露） ===================== */
// 本模块负责页面 HTML 结构生成（initApp）、导航、投稿表单、全局事件，以及「我的」页。
// 视觉复刻解压文件 UI；功能逻辑全部复用既有模块（game / case-bank / storage / inquiry / inspection）。

import { loadCaseData, getAllCases } from './data.js';
import {
    renderDataStats, resetAllProgress, exportProgress, importProgress,
    applyImportMode, confirmCoverImport, closeImportModal,
    createProgressBackupCode, parseProgressBackupCode,
    openBackupModal, closeBackupModal, showBackupCode, copyBackupCode, copyBackupPart, renderBackupChoice, saveBackupFile,
    openRestoreChoice, startCodeRestore, checkBackupCode, triggerFileRestore, copyDiagnosticInfo,
    getCompletedCases, getWrongCases
} from './storage.js';
import {
    startChallenge, resetGameUI, selectDifficulty, showCurrentCase, prevCase, nextCase,
    exploreDiag, showOtherCheck, submitAnswer, viewAnswer, resetCurrentCase, showHistory,
    openSimpleResultModal, closeSimpleResultModal, registerModalOpeners, registerNav
} from './game.js';
import { openInquiryModal, sendInquiry, closeInquiryModal } from './inquiry.js';
import {
    openInspectionModal, closeInspectionModal, inspectPrev, inspectNext, submitTongueJudgment
} from './inspection.js';
import {
    openCaseBank, closeCaseBank, selectBankCategory, selectBankDiff, filterCaseBank,
    challengeCaseFromBank, openRecords, closeRecords, clearRecords,
    rechallengeCase, viewWrongCaseAnalysis, openCaseDetail, closeCaseDetail, renderFullCase,
    registerNav as registerBankNav
} from './case-bank.js';

/* ===================== 页面导航 ===================== */
function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page' + name)?.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.querySelectorAll('.top-nav .nav-link').forEach(l => l.classList.remove('nav-active'));
    const map = { Home: 'navHome', Game: 'navClinic', Bank: 'navBank', Me: 'navMe' };
    const navId = map[name];
    if (navId) document.getElementById(navId)?.classList.add('nav-active');
    // 对齐解压文件：首页/我的页使用 wide 壳层
    const widePages = ['Home', 'Me'];
    const wide = widePages.includes(name);
    ['siteHeaderInner', 'appContainer', 'siteFooterInner'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('wide', wide);
    });
}
function goHome() { showPage('Home'); }
function showAbout() { showPage('About'); }
function showMe() { renderMeStats(); showPage('Me'); }

/* ===================== 「我的」页统计 ===================== */
function renderMeStats() {
    const total = getAllCases().length;
    const done = getCompletedCases().length;
    const wrong = getWrongCases().length;
    const pct = total ? Math.round(done / total * 100) : 0;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('meStatDone', done);
    set('meStatWrong', wrong);
    set('meStatRemain', Math.max(0, total - done));
    set('meProgressPct', pct + '%');
    set('meWrongCountBadge', wrong + ' 条');
    const bar = document.getElementById('meProgressBar');
    if (bar) bar.style.width = pct + '%';
    const wrongEmpty = document.getElementById('meWrongEmpty');
    const wrongAction = document.getElementById('meWrongAction');
    const wrongBtn = document.getElementById('meWrongBtn');
    if (wrongEmpty) wrongEmpty.style.display = wrong === 0 ? 'block' : 'none';
    if (wrongAction) wrongAction.style.display = wrong === 0 ? 'none' : 'flex';
    if (wrongBtn) wrongBtn.textContent = '打开错题本 · ' + wrong + ' 条';
    renderDataStats();
}

function toggleMeDetail(id) {
    const card = document.getElementById(id);
    if (card) card.classList.toggle('open');
}

function toggleAnswerCard() {
    const body = document.getElementById('answerBody');
    const label = document.getElementById('answerToggleLabel');
    const hint = document.getElementById('answerClosedHint');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    if (label) label.textContent = open ? '展开' : '收起';
    if (hint) hint.style.display = open ? 'block' : 'none';
}

/* ===================== 页面结构 ===================== */
function initApp() {
    const appContainer = document.getElementById('appContainer');
    appContainer.innerHTML = `
        <div class="page active" id="pageHome">
            <section class="hero">
                <h1 class="hero-title">中医辨证推演馆</h1>
                <p class="hero-subtitle">你是一名接诊医生，通过望闻问切完成辨证。</p>
                <p class="hero-desc">像门诊一样四诊，像海龟汤一样推理。</p>
                <div class="home-buttons">
                    <button class="btn btn--primary btn--lg" style="min-width:208px;" onclick="startChallenge()">开始接诊</button>
                    <div class="home-secondary">
                        <a href="#" onclick="showAbout(); return false;">关于</a>
                        <span class="dot">·</span>
                        <a href="#" onclick="openCaseBank(); return false;">题库</a>
                    </div>
                </div>
            </section>
        </div>

        <div class="page" id="pageGame">
            <section id="difficultyPicker">
                <p class="eyebrow">接诊</p>
                <h1 class="page-title">选择关卡</h1>
                <p class="page-sub">选好难度后，只会出现主诉。四诊要你自己点开，线索不会预先摆上桌。</p>
                <div class="difficulty-list" id="difficultyBtns">
                    <button class="btn--difficulty" data-diff="basic" onclick="selectDifficulty('basic', this)">
                        <div><div class="difficulty-name">入门训练</div><div class="difficulty-blurb">证候较显，用来熟悉「读主诉 → 四诊 → 辨证」的节奏。</div></div>
                        <div class="difficulty-count" id="diffCount_basic">—</div>
                    </button>
                    <button class="btn--difficulty" data-diff="intermediate" onclick="selectDifficulty('intermediate', this)">
                        <div><div class="difficulty-name">综合训练</div><div class="difficulty-blurb">线索交叉，需要取舍，不再是单证对号入座。</div></div>
                        <div class="difficulty-count" id="diffCount_intermediate">—</div>
                    </button>
                    <button class="btn--difficulty" data-diff="advanced" onclick="selectDifficulty('advanced', this)">
                        <div><div class="difficulty-name">临床思维</div><div class="difficulty-blurb">更接近真实门诊：信息不完全，判断要自己立住。</div></div>
                        <div class="difficulty-count" id="diffCount_advanced">—</div>
                    </button>
                </div>
            </section>

            <section id="caseWorkspace" style="display:none;">
                <div class="case-topbar" id="caseTopbar">
                    <button class="btn btn--ghost btn--sm" onclick="resetGameUI()">重选关卡</button>
                    <span><span class="case-topbar-diff" id="caseTopDiffName"></span><span class="case-topbar-counter" id="caseTopCounter"></span></span>
                    <button class="btn btn--ghost btn--sm" onclick="resetCurrentCase()">重新探查</button>
                </div>

                <article class="chief-complaint-card" id="chiefComplaintCard">
                    <div class="cc-head">
                        <div class="eyebrow">主诉 · 谜面</div>
                        <button class="btn btn--ghost btn--sm" id="historyBtn" style="display:none;" onclick="showHistory()">病史</button>
                    </div>
                    <p id="chiefComplaintText"></p>
                    <div class="cc-foot">
                        <button class="btn btn--ghost" id="prevCaseBtn" onclick="prevCase()" style="display:none;">‹ 上一例</button>
                        <span id="caseCounter"></span>
                        <button class="btn btn--ghost" id="nextCaseBtn" onclick="nextCase()" style="display:none;">下一例 ›</button>
                    </div>
                </article>

                <div class="diag-section">
                    <div class="diag-section-head">
                        <h2>四诊</h2>
                        <button class="btn btn--ghost btn--sm" id="btnOtherCheck" onclick="showOtherCheck()" style="display:none;">其他检查</button>
                    </div>
                    <p class="diag-hint" id="diagHint">先读主诉，再点四诊。未问到的，不会主动告诉你。</p>
                    <div class="four-diagnosis" id="fourDiagBtns" style="display:none;">
                        <button class="btn--diag" id="btnWang" onclick="exploreDiag('inspection')"><span class="diag-char">望</span><span class="diag-label">望诊</span><span class="diag-hint">舌象与神色</span></button>
                        <button class="btn--diag" id="btnWen" onclick="exploreDiag('auscultation')"><span class="diag-char">闻</span><span class="diag-label">闻诊</span><span class="diag-hint">声息气味</span></button>
                        <button class="btn--diag" id="btnAsk" onclick="exploreDiag('inquiry')"><span class="diag-char">问</span><span class="diag-label">问诊</span><span class="diag-hint">逐项追问</span></button>
                        <button class="btn--diag" id="btnPulse" onclick="exploreDiag('pulse')"><span class="diag-char">切</span><span class="diag-label">切脉</span><span class="diag-hint">脉象按诊</span></button>
                    </div>
                </div>

                <div class="clue-section" id="clueCollectionCard">
                    <h2>线索</h2>
                    <div class="clue-area" id="clueArea"></div>
                </div>

                <div class="answer-section" id="answerCard">
                    <button class="answer-toggle" onclick="toggleAnswerCard()">
                        <h2>提交辨证</h2>
                        <span id="answerToggleLabel">展开</span>
                    </button>
                    <p class="answer-closed-hint" id="answerClosedHint">先探查至少一诊，再来立证。</p>
                    <div class="answer-body" id="answerBody" style="display:none;">
                        <div class="answer-area">
                            <input type="text" id="inputSyndrome" placeholder="证型，如肝郁脾虚">
                            <input type="text" id="inputDisease" placeholder="病名，如胃脘痛">
                        </div>
                        <div class="basis-area">
                            <label class="basis-label" for="inputBasis">辨证依据</label>
                            <textarea id="inputBasis" placeholder="结合主诉与四诊线索，写出你的辨证思路与主要依据。"></textarea>
                        </div>
                        <button class="btn btn--primary btn--block" style="margin-top:12px;" onclick="submitAnswer()">提交</button>
                    </div>
                    <div id="answerFeedback"></div>
                    <div id="fullAnalysisArea"></div>
                </div>

                <div style="display:flex;justify-content:center;margin-top:24px;">
                    <button class="btn btn--ghost" onclick="goHome()">返回首页</button>
                </div>
            </section>
        </div>

        <div class="page" id="pageBank">
            <p class="eyebrow">题库</p>
            <h1 class="page-title">病例题库</h1>
            <p class="page-sub" id="bankCount">点开即可按原关卡规则重诊。</p>
            <div id="caseBankContent"></div>
        </div>

        <div class="page" id="pageAbout">
            <p class="eyebrow">关于</p>
            <h1 class="page-title">关于本馆</h1>
            <section class="about-intro">
                <p>中医辨证推演馆采用「海龟汤式」的线索解锁方式，把传统中医医案变成主动探索式的辨证训练。</p>
                <p>玩家不会一开始就看到完整病例，而是作为接诊医生，通过望、闻、问、切逐步获取信息，最后独立完成辨证。</p>
                <p class="muted">本站内容仅供中医学习与病例推演，不构成诊断、处方或医疗建议。如有身体不适，请及时前往正规医疗机构就诊。</p>
            </section>
            <section class="about-play">
                <p class="eyebrow">玩法</p>
                <h2>怎么玩</h2>
                <ol>
                    <li><span>一</span><div><h3>接诊</h3><p>从一句主诉开始，像坐诊一样面对一位陌生患者。</p></div></li>
                    <li><span>二</span><div><h3>望闻问切</h3><p>主动挑出需要了解的信息，线索要靠四诊亲自采集。</p></div></li>
                    <li><span>三</span><div><h3>辨证</h3><p>把收集到的四诊信息收束到一起，立住自己的辨证链。</p></div></li>
                    <li><span>四</span><div><h3>揭晓</h3><p>提交辨证结果，再对照完整医案与解析，反思取舍。</p></div></li>
                </ol>
            </section>
        </div>

        <div class="page" id="pageMe">
            <p class="eyebrow">我的</p>
            <h1 class="page-title">个人学习案册</h1>
            <p class="page-sub">这里汇总你的学习概况、错题与数据管理。换设备前，请先备份。</p>

            <section class="me-section-card">
                <div class="me-section-head">
                    <h2>学习概况</h2>
                    <span id="meProgressPct">0%</span>
                </div>
                <dl class="me-stats">
                    <div class="me-stat"><dt>已完成</dt><dd id="meStatDone">0<small>例</small></dd></div>
                    <div class="me-stat"><dt>错题</dt><dd id="meStatWrong">0<small>条</small></dd></div>
                    <div class="me-stat"><dt>学习中</dt><dd id="meStatRemain">0<small>例</small></dd></div>
                </dl>
                <div class="me-progress"><div id="meProgressBar" style="width:0;"></div></div>
            </section>

            <section class="me-section-card">
                <div class="me-section-head">
                    <h2>我的错题</h2>
                    <span id="meWrongCountBadge">0 条</span>
                </div>
                <p class="me-section-desc">复习你曾经辨证失误的病例，再次走一遍四诊线索。</p>
                <div class="me-empty-state" id="meWrongEmpty" style="display:none;">
                    <p>暂无错题</p>
                    <p>先到「接诊」试一例，错了会记在这里。</p>
                </div>
                <div class="data-actions" id="meWrongAction" style="display:none;">
                    <button class="btn btn--outline btn--sm" onclick="openRecords()" id="meWrongBtn">打开错题本</button>
                </div>
            </section>

            <section class="me-section-card">
                <h2>我的投稿</h2>
                <p class="me-section-desc">分享你发现的优质病例，经过脱敏后投稿给本馆。</p>
                <div class="data-actions">
                    <button class="btn btn--outline btn--sm" onclick="openSubmissionModal()">投稿病例</button>
                </div>
            </section>

            <section class="me-section-card">
                <h2>学习数据</h2>
                <p class="me-section-desc">学习记录只保存在当前浏览器。建议定期备份。</p>
                <div class="data-actions">
                    <button onclick="openBackupModal()">备份</button>
                    <button onclick="openRestoreChoice()">恢复</button>
                    <button onclick="resetAllProgress(); renderMeStats();">重置进度</button>
                </div>
                <p class="form-hint" style="margin-top:12px;font-size:13px;color:var(--text-muted);line-height:1.7;">学习记录只保存在当前浏览器，换设备或其他浏览器前建议先备份。</p>
                <p id="dataStats" class="data-stats"></p>
            </section>
        </div>
    `;

    // 难度计数
    const all = getAllCases();
    const done = new Set(getCompletedCases());
    ['basic', 'intermediate', 'advanced'].forEach(diff => {
        const pool = all.filter(c => c.difficulty === diff);
        const remain = pool.filter(c => !done.has(c.id)).length;
        const el = document.getElementById('diffCount_' + diff);
        if (el) el.textContent = remain + ' / ' + pool.length;
    });
    // 题库计数
    const bc = document.getElementById('bankCount');
    if (bc) bc.textContent = '共 ' + all.length + ' 则。点开即可按原关卡规则重诊。';

    renderMeStats();
    showPage('Home');
}

/* ===================== 投稿表单 ===================== */
function openSubmissionModal() {
    document.getElementById('submissionModal').style.display = 'flex';
    document.getElementById('submissionFeedback').innerHTML = '';
    document.getElementById('formNext').value = window.location.href.split('?')[0] + '?submitted=true';
    document.getElementById('difficultyDisplay').textContent = '点击选择难度';
    document.getElementById('subDifficulty').value = '';
    document.getElementById('difficultyOptions').style.display = 'none';
    document.querySelectorAll('.difficulty-option').forEach(opt => opt.classList.remove('selected'));
}
function closeSubmissionModal() { document.getElementById('submissionModal').style.display = 'none'; }
function toggleDifficultyOptions() {
    const options = document.getElementById('difficultyOptions');
    options.style.display = options.style.display === 'none' ? 'block' : 'none';
}
function selectDifficultyOption(value, label, btn) {
    document.getElementById('difficultyDisplay').textContent = label;
    document.getElementById('subDifficulty').value = value;
    document.getElementById('difficultyOptions').style.display = 'none';
    document.querySelectorAll('.difficulty-option').forEach(opt => opt.classList.remove('selected'));
    btn.classList.add('selected');
}
function validateSubmissionForm() {
    const form = document.getElementById('submissionForm');
    const feedback = document.getElementById('submissionFeedback');
    const requiredFields = ['case_source', 'chief_complaint', 'past_history', 'inspection', 'auscultation', 'inquiry', 'pulse', 'analysis', 'syndrome', 'disease', 'western_diagnosis'];
    for (const fieldName of requiredFields) {
        const field = form.querySelector(`[name="${fieldName}"]`);
        if (!field || !field.value.trim()) { feedback.innerHTML = `<div class="result-box fail">请填写所有必填字段。</div>`; field?.focus(); return false; }
    }
    const difficulty = form.querySelector('[name="difficulty"]');
    if (!difficulty || !difficulty.value) { feedback.innerHTML = `<div class="result-box fail">请选择难度。</div>`; return false; }
    const fileInput = document.getElementById('subTonguePhoto');
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        if (file.size > 10 * 1024 * 1024) { feedback.innerHTML = `<div class="result-box fail">舌象照片大小不能超过10MB，请压缩后重新上传。</div>`; return false; }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { feedback.innerHTML = `<div class="result-box fail">仅支持 JPG、PNG 或 WebP 格式的舌象照片。</div>`; return false; }
    }
    if (!document.getElementById('submissionConsent').checked) { feedback.innerHTML = `<div class="result-box fail">请确认病例已脱敏并同意投稿数据处理方式。</div>`; return false; }
    feedback.innerHTML = '';
    return true;
}

/* ===================== 全局事件 ===================== */
document.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) e.target.style.display = 'none'; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); });
window.addEventListener('load', function() {
    if (window.location.search.includes('submitted=true')) {
        if (history.replaceState) history.replaceState(null, '', window.location.pathname);
        openSubmissionModal();
        document.getElementById('submissionFeedback').innerHTML = '<div class="result-box success">病例提交成功！感谢您的投稿。</div>';
    }
});

/* ===================== 模块间依赖注入 ===================== */
registerModalOpeners({ openInquiry: openInquiryModal, openInspection: openInspectionModal });
registerNav({ showPage });
registerBankNav({ showPage });

/* ===================== 暴露到 window（供内联 onclick 使用） ===================== */
window.goHome = goHome;
window.showAbout = showAbout;
window.showMe = showMe;
window.renderMeStats = renderMeStats;
window.toggleMeDetail = toggleMeDetail;
window.toggleAnswerCard = toggleAnswerCard;
window.startChallenge = startChallenge;
window.openCaseBank = openCaseBank;
window.openRecords = openRecords;
window.openSubmissionModal = openSubmissionModal;
window.closeSubmissionModal = closeSubmissionModal;
window.selectDifficulty = selectDifficulty;
window.showHistory = showHistory;
window.prevCase = prevCase;
window.nextCase = nextCase;
window.exploreDiag = exploreDiag;
window.showOtherCheck = showOtherCheck;
window.submitAnswer = submitAnswer;
window.viewAnswer = viewAnswer;
window.resetCurrentCase = resetCurrentCase;
window.openSimpleResultModal = openSimpleResultModal;
window.closeSimpleResultModal = closeSimpleResultModal;
window.sendInquiry = sendInquiry;
window.closeInquiryModal = closeInquiryModal;
window.openInspectionModal = openInspectionModal;
window.closeInspectionModal = closeInspectionModal;
window.inspectPrev = inspectPrev;
window.inspectNext = inspectNext;
window.submitTongueJudgment = submitTongueJudgment;
window.closeCaseBank = closeCaseBank;
window.filterCaseBank = filterCaseBank;
window.selectBankCategory = selectBankCategory;
window.selectBankDiff = selectBankDiff;
window.challengeCaseFromBank = challengeCaseFromBank;
window.closeRecords = closeRecords;
window.clearRecords = clearRecords;
window.rechallengeCase = rechallengeCase;
window.viewWrongCaseAnalysis = viewWrongCaseAnalysis;
window.openCaseDetail = openCaseDetail;
window.closeCaseDetail = closeCaseDetail;
window.toggleDifficultyOptions = toggleDifficultyOptions;
window.selectDifficultyOption = selectDifficultyOption;
window.validateSubmissionForm = validateSubmissionForm;
window.resetAllProgress = resetAllProgress;
window.exportProgress = exportProgress;
window.importProgress = importProgress;
window.applyImportMode = applyImportMode;
window.confirmCoverImport = confirmCoverImport;
window.closeImportModal = closeImportModal;
window.createProgressBackupCode = createProgressBackupCode;
window.parseProgressBackupCode = parseProgressBackupCode;
window.openBackupModal = openBackupModal;
window.closeBackupModal = closeBackupModal;
window.showBackupCode = showBackupCode;
window.copyBackupCode = copyBackupCode;
window.copyBackupPart = copyBackupPart;
window.renderBackupChoice = renderBackupChoice;
window.saveBackupFile = saveBackupFile;
window.openRestoreChoice = openRestoreChoice;
window.startCodeRestore = startCodeRestore;
window.checkBackupCode = checkBackupCode;
window.triggerFileRestore = triggerFileRestore;
window.copyDiagnosticInfo = copyDiagnosticInfo;

// 仅用于调试 / 兼容
window._getAllCases = getAllCases;
window._openCaseDetail = openCaseDetail;
window._renderFullCase = renderFullCase;
window._resetGameUI = resetGameUI;
window._showCurrentCase = showCurrentCase;

/* ===================== 启动 ===================== */
loadCaseData(initApp);

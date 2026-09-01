/* ===================== 应用入口（页面结构 / 导航 / 全局事件 / window 暴露） ===================== */
// 本模块：
//   1) 负责首页/闯关页/关于页的 HTML 结构生成（initApp）
//   2) 负责页面导航、投稿表单、全局事件
//   3) 将各模块的函数统一暴露到 window，供内联 onclick 使用（ES Module 下函数默认不挂全局）

import { loadCaseData, getAllCases } from './data.js';
import {
    renderDataStats, resetAllProgress, exportProgress, importProgress,
    applyImportMode, confirmCoverImport, closeImportModal,
    createProgressBackupCode, parseProgressBackupCode,
    openBackupModal, closeBackupModal, showBackupCode, copyBackupCode, renderBackupChoice, saveBackupFile,
    openRestoreChoice, startCodeRestore, checkBackupCode, triggerFileRestore
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
    const map = { Home: 'navHome', Game: 'navGame', About: 'navAbout' };
    document.getElementById(map[name])?.classList.add('nav-active');
}
function goHome() { showPage('Home'); }
function showAbout() { renderDataStats(); showPage('About'); }

/* ===================== 页面结构 ===================== */
function initApp() {
    const appContainer = document.getElementById('appContainer');
    appContainer.innerHTML = `
        <div class="page active" id="pageHome">
            <div class="card card--accent" style="text-align:center;">
                <div class="hero-title"><span class="icon">🏥</span> 中医辨证推演馆</div>
                <div class="hero-subtitle">—— 海龟汤式 · 四诊探案 ——</div>
                <div class="hero-desc">你是一名接诊医生。仅凭一句主诉，通过<strong>望、闻、问、切</strong>四诊探案，独立完成辨证论治。</div>
            </div>
            <div class="home-buttons">
                <button class="btn btn--primary" onclick="startChallenge()">🎯 开始闯关</button>
                <div class="home-secondary">
                    <button class="btn btn--outline btn--equal" onclick="openCaseBank()">📚 病例题库</button>
                    <button class="btn btn--ghost btn--equal" onclick="openRecords()">📝 我的错题</button>
                    <button class="btn btn--outline btn--equal" onclick="openSubmissionModal()" style="border-color: var(--gold); color: var(--gold);">📤 投稿病例</button>
                </div>
            </div>
        </div>
        <div class="page" id="pageGame">
            <div class="card" style="padding:16px 20px;">
                <div style="font-weight:700;color:var(--text-light);text-align:center;">📋 选择关卡</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;" id="difficultyBtns">
                    <button class="btn btn--difficulty btn--basic" data-diff="basic" onclick="selectDifficulty('basic', this)">🌱 入门训练</button>
                    <button class="btn btn--difficulty btn--intermediate" data-diff="intermediate" onclick="selectDifficulty('intermediate', this)">🌿 综合训练</button>
                    <button class="btn btn--difficulty btn--advanced" data-diff="advanced" onclick="selectDifficulty('advanced', this)">🌳 临床思维</button>
                </div>
            </div>
            <div class="card card--highlight" id="chiefComplaintCard" style="display:none;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <div style="font-weight:700;color:var(--accent);">🩺 病例主诉（谜面）</div>
                    <button class="btn btn--outline" id="historyBtn" style="display:none;padding:8px 16px;font-size:0.85em;" onclick="showHistory()">📜 病史</button>
                </div>
                <div id="chiefComplaintText" style="margin-top:8px;"></div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;">
                    <button class="btn btn--outline" id="prevCaseBtn" onclick="prevCase()" style="display:none;padding:8px 12px;font-size:0.9em;">‹ 上一例</button>
                    <span id="caseCounter" style="font-weight:600;color:var(--text-light);"></span>
                    <button class="btn btn--outline" id="nextCaseBtn" onclick="nextCase()" style="display:none;padding:8px 12px;font-size:0.9em;">下一例 ›</button>
                </div>
                <div style="font-size:0.78em;color:var(--text-muted);margin-top:6px;">⚡ 请通过下方四诊按钮主动探查线索</div>
            </div>
            <div class="four-diagnosis" id="fourDiagBtns" style="display:none;">
                <button class="btn btn--diag" id="btnWang" onclick="exploreDiag('inspection')"><span class="diag-icon">👁️</span><span class="diag-label">望 诊</span></button>
                <button class="btn btn--diag" id="btnWen" onclick="exploreDiag('auscultation')"><span class="diag-icon">👂</span><span class="diag-label">闻 诊</span></button>
                <button class="btn btn--diag" id="btnAsk" onclick="exploreDiag('inquiry')"><span class="diag-icon">💬</span><span class="diag-label">问 诊</span></button>
                <button class="btn btn--diag" id="btnPulse" onclick="exploreDiag('pulse')"><span class="diag-icon">🫀</span><span class="diag-label">切 脉</span></button>
            </div>
            <button class="btn btn--outline" id="btnOtherCheck" onclick="showOtherCheck()" style="display:none; margin-top:10px; width:100%;">📋 其他检查</button>
            <div class="card" id="clueCollectionCard" style="display:none;">
                <div style="font-weight:700;color:var(--text-light);">📋 线索收集区</div>
                <div class="clue-area" id="clueArea"></div>
            </div>
            <div class="card" id="answerCard" style="display:none;">
                <div style="font-weight:700;color:var(--text-light);">✍️ 提交辨证</div>
                <div class="answer-area">
                    <input type="text" id="inputSyndrome" placeholder="证型">
                    <input type="text" id="inputDisease" placeholder="病名">
                </div>
                <div style="margin-top:12px;">
                    <label style="font-weight:700;color:var(--text-light);font-size:0.9em;">请写出你的辩证依据 <span class="required-star">*</span></label>
                    <textarea id="inputBasis" placeholder="请写出你的辩证依据（病机分析、辨证思路等）" style="width:100%;min-height:100px;margin-top:6px;padding:10px 14px;border-radius:10px;border:2px solid var(--border);font-size:0.95em;background:#fffefb;outline:none;resize:vertical;font-family:var(--font-body);"></textarea>
                </div>
                <button class="btn btn--primary" style="width:100%;margin-top:12px;padding:14px 22px;font-size:1em;animation:none;" onclick="submitAnswer()">提交答案</button>
                <div id="answerFeedback"></div>
                <div id="fullAnalysisArea"></div>
            </div>
            <div style="display:flex;gap:10px;justify-content:center;" id="gameExtraBtns">
                <button class="btn btn--outline" onclick="resetCurrentCase()">🔄 重新探查</button>
                <button class="btn btn--ghost" onclick="goHome()">🏠 返回首页</button>
            </div>
        </div>
        <div class="page" id="pageAbout">
            <div class="card card--gold" style="text-align:center;">
                <div style="font-size:1.6em;color:var(--primary);">📖 关于本站</div>
                <div style="margin-top:16px;line-height:1.8;color:var(--text-light);">
                    <strong>中医辨证推演馆</strong> 是一个通过「海龟汤式」的线索解锁机制，按照 <strong>望 → 闻 → 问 → 切</strong> 的顺序收集证据，尝试把传统病例学习变成一个可以主动探索的推演过程的网站。<br><br>
                    <span style="color:var(--accent);font-weight:700;">@wuruilin</span>
                </div>
            </div>
            <div style="margin-top:14px;text-align:center;font-size:0.8em;color:var(--text-muted);line-height:1.7;">本站内容仅供中医学习与病例推演，不构成诊断、处方或医疗建议。如有身体不适，请及时前往正规医疗机构就诊。</div>
            <div style="text-align:center;"><button class="btn btn--outline" onclick="goHome()">🏠 返回首页</button></div>
            <div class="data-card">
                <h3>📦 学习数据</h3>
                <p class="data-stats" id="dataStats"></p>
                <p class="form-hint" style="line-height:1.7;margin:8px 0 14px;">💡 学习记录只保存在当前浏览器，换设备或其他浏览器前建议先备份。</p>
                <div class="data-actions">
                    <button onclick="openBackupModal()">📤 备份</button>
                    <button onclick="openRestoreChoice()">📥 恢复</button>
                    <button onclick="resetAllProgress()">🔄 重置进度</button>
                </div>
                <input type="file" id="importFileInput" accept=".json,application/json" style="display:none;" onchange="if(this.files[0]) importProgress(this.files[0]); this.value='';">
            </div>
        </div>
    `;
    renderDataStats();
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
        document.getElementById('submissionFeedback').innerHTML = '<div class="result-box success">✅ 病例提交成功！感谢您的投稿。</div>';
    }
});

/* ===================== 模块间依赖注入 ===================== */
// game.js 需要打开问诊/望诊弹窗；case-bank.js 与 game.js 需要页面导航函数。
registerModalOpeners({
    openInquiry: openInquiryModal,
    openInspection: openInspectionModal
});
registerNav({ showPage });
registerBankNav({ showPage });

/* ===================== 暴露到 window（供内联 onclick 使用） ===================== */
window.goHome = goHome;
window.startChallenge = startChallenge;
window.showAbout = showAbout;
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
window.renderBackupChoice = renderBackupChoice;
window.saveBackupFile = saveBackupFile;
window.openRestoreChoice = openRestoreChoice;
window.startCodeRestore = startCodeRestore;
window.checkBackupCode = checkBackupCode;
window.triggerFileRestore = triggerFileRestore;

// 仅用于调试 / 兼容（避免未使用导入告警）
window._getAllCases = getAllCases;
window._openCaseDetail = openCaseDetail;
window._renderFullCase = renderFullCase;
window._resetGameUI = resetGameUI;
window._showCurrentCase = showCurrentCase;

/* ===================== 启动 ===================== */
loadCaseData(initApp);

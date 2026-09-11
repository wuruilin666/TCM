/* ===================== 游戏会话（唯一游戏状态 + 闯关流程） =====================
 * 拥有：
 *   - 当前难度 / 当前病例 / 已收集线索 / 已探索诊法 / 问诊历史
 *   - 闯关流程（选关 → 展示病例 → 探索四诊 → 提交辨证 → 查看解析）
 *
 * 依赖方向：
 *   Game Session → Domain（answer-evaluator / data）
 *   Game Session ← Application 注入（导航、弹窗、进度存储）
 *
 * Game 不 import Storage，也不 import Inquiry / Inspection / Case Bank：
 * 进度读写通过 registerProgressService 注入，四诊弹窗通过 registerModalOpeners 注入。
 * 因此不存在模块循环依赖，也不会把 game 内部状态暴露给别的模块。
 * ================================================================================== */

import { escapeHtml, escapeHtmlWithBreaks } from './html-utils.js';
import { diffMap, diffOrder } from './data.js';
import { evaluateAnswer, ANSWER_RESULT } from './core/answer-evaluator.js';

/* ===================== 唯一游戏状态 ===================== */
// 只有本模块可写。其它模块一律通过下面导出的接口操作。
const state = {
    currentDifficulty: null,
    currentCase: null,
    collectedClues: [],
    exploredDiags: {},
    gameStarted: false,
    inquiryHistory: [],
    askedInquiryQuestions: [],
    unfinishedCases: [],
    currentCaseIndex: 0,
    inspectionImages: [],
    inspectionIndex: 0,
    inspectionNonTongueAdded: false,
    lastAnswerWasCorrect: false
};

/* ===================== 注入点（由 app.js 装配） ===================== */
// 导航
let showPageFn = null;
export function registerNav(fns) {
    if (fns && fns.showPage) showPageFn = fns.showPage;
}

// 四诊弹窗打开函数：inquiry / inspection 的 UI 入口由 Application 注入
let modalOpeners = {};
export function registerModalOpeners(fns) { modalOpeners = { ...modalOpeners, ...fns }; }

// 进度存储：Game 不 import Storage，只使用这个接口。
// 约定 progressService 需提供：getCompletedIds() / markCompleted(id) / saveWrong(entry) / removeWrong(id)
let progressService = null;
export function registerProgressService(service) { progressService = service; }

function requireProgressService() {
    if (!progressService) throw new Error('progressService 尚未注册，无法读写学习进度');
    return progressService;
}

/* ===================== 会话读取接口 ===================== */
// 供 Inquiry / Inspection 使用的只读视图，避免它们直接读 state 对象。
export function getSession() {
    return {
        currentCase: state.currentCase,
        inquiryHistory: state.inquiryHistory,
        askedInquiryQuestions: state.askedInquiryQuestions,
        inspectionImages: state.inspectionImages,
        inspectionIndex: state.inspectionIndex,
        inspectionNonTongueAdded: state.inspectionNonTongueAdded,
        gameStarted: state.gameStarted,
        difficulty: state.currentDifficulty
    };
}

export function getCurrentCase() { return state.currentCase; }

/* ===================== 会话写入接口 ===================== */
// 记录一条线索（去重）。返回是否真正新增。
export function addClue(type, content, tagText) {
    const tagMap = { inspection: 'tag-wang', auscultation: 'tag-wen', inquiry: 'tag-ask', pulse: 'tag-pulse' };
    const nameMap = { inspection: '望诊', auscultation: '闻诊', inquiry: '问诊', pulse: '切脉' };
    const tag = tagText || nameMap[type];
    if (state.collectedClues.some(c => c.content === content && c.tag === tag)) return false;
    const wasEmpty = state.collectedClues.length === 0;
    state.collectedClues.push({ tag, tagClass: tagMap[type], content });
    renderClues();
    if (wasEmpty) { expandAnswerCard(); updateAnswerClosedHint(false); }
    return true;
}

// 标记某诊法已探索：更新按钮态 + 状态位
export function setExplored(type) {
    const map = { inspection: 'btnWang', auscultation: 'btnWen', inquiry: 'btnAsk', pulse: 'btnPulse' };
    state.exploredDiags[type] = true;
    document.getElementById(map[type])?.classList.add('explored');
}

export function isExplored(type) { return !!state.exploredDiags[type]; }

// 记录一次追问：写入问诊历史 + 标记题目已问。
// 返回 { accepted, duplicate }，由 Inquiry 决定如何措辞回答。
export function recordInquiryTurn(question, answer, questionIndex) {
    const duplicate = state.askedInquiryQuestions.includes(questionIndex);
    if (!duplicate) {
        state.askedInquiryQuestions.push(questionIndex);
        addClue('inquiry', answer, '问诊·' + question);
    }
    return { accepted: !duplicate, duplicate };
}

export function appendInquiryMessage(role, text) { state.inquiryHistory.push({ role, text }); }

export function getInquiryProgress() {
    const total = state.currentCase ? state.currentCase.clues.inquiry.questions.length : 0;
    return { asked: state.askedInquiryQuestions.length, total, allAsked: total > 0 && state.askedInquiryQuestions.length >= total };
}

// 望诊图片浏览：由 Inspection 驱动，但索引与列表仍由会话持有
export function setInspectionImages(images) {
    state.inspectionImages = images.slice();
    state.inspectionIndex = 0;
}
export function getInspectionImages() { return state.inspectionImages; }
export function getInspectionIndex() { return state.inspectionIndex; }
export function setInspectionIndex(i) { state.inspectionIndex = i; }
export function setInspectionNonTongueAdded(flag) { state.inspectionNonTongueAdded = flag; }

/* ===================== 结果模态框（通用 UI 片段） ===================== */
export function openSimpleResultModal(title, content) {
    document.getElementById('simpleResultTitle').textContent = title;
    document.getElementById('simpleResultContent').textContent = content;
    document.getElementById('simpleResultModal').style.display = 'flex';
}
export function closeSimpleResultModal() { document.getElementById('simpleResultModal').style.display = 'none'; }

/* ===================== 闯关流程 ===================== */
export function startChallenge() {
    if (showPageFn) showPageFn('Game');
    resetGameUI();
}

export function resetGameUI() {
    state.currentDifficulty = null; state.currentCase = null; state.collectedClues = []; state.exploredDiags = {};
    state.gameStarted = false; state.inquiryHistory = []; state.askedInquiryQuestions = []; state.unfinishedCases = [];
    state.currentCaseIndex = 0; state.inspectionNonTongueAdded = false; state.lastAnswerWasCorrect = false;
    const picker = document.getElementById('difficultyPicker');
    const ws = document.getElementById('caseWorkspace');
    if (picker) picker.style.display = 'block';
    if (ws) ws.style.display = 'none';
    document.getElementById('fourDiagBtns').style.display = 'none';
    document.getElementById('btnOtherCheck').style.display = 'none';
    document.getElementById('historyBtn').style.display = 'none';
    document.getElementById('clueArea').innerHTML = '';
    document.getElementById('answerFeedback').innerHTML = '';
    document.getElementById('fullAnalysisArea').innerHTML = '';
    document.getElementById('inputSyndrome').value = '';
    document.getElementById('inputDisease').value = '';
    document.getElementById('inputBasis').value = '';
    collapseAnswerCard();
    updateAnswerClosedHint(true);
    document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => b.classList.remove('selected'));
    ['btnWang', 'btnWen', 'btnAsk', 'btnPulse'].forEach(id => document.getElementById(id)?.classList.remove('explored'));
}

export function selectDifficulty(diff, btnEl) {
    document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => b.classList.remove('selected'));
    btnEl.classList.add('selected');
    state.currentDifficulty = diff;
    const pool = getCasePool(diff);
    if (pool.length === 0) { alert('该难度暂无病例。'); return; }
    const completed = requireProgressService().getCompletedIds();
    state.unfinishedCases = pool.filter(c => !completed.includes(c.id));
    if (state.unfinishedCases.length === 0) {
        openSimpleResultModal('闯关完毕', '该难度下所有病例均已完成，无新病例可学习。您可以在病例题库中复习已完成的病例。');
        document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => b.classList.remove('selected'));
        state.currentDifficulty = null;
        return;
    }
    state.currentCaseIndex = 0;
    showCurrentCase();
}

// 病例池来源：由 Application 注入的全量病例读取器
let caseSourceFn = null;
export function registerCaseSource(fn) { caseSourceFn = fn; }

function getAllCases() {
    if (!caseSourceFn) throw new Error('病例数据源尚未注册，无法读取病例');
    return caseSourceFn();
}

function getCasePool(diff) { return getAllCases().filter(c => c.difficulty === diff); }

// 从题库 / 错题进入指定病例练习。Game 提供公开入口，题库不再自行拼装会话状态。
export function startCasePractice(caseId) {
    const target = getAllCases().find(c => c.id === caseId);
    if (!target) throw new Error('病例不存在：' + caseId);
    if (showPageFn) showPageFn('Game');
    resetGameUI();
    state.currentDifficulty = target.difficulty;
    document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => {
        b.classList.toggle('selected', b.dataset.diff === target.difficulty);
    });
    const completed = requireProgressService().getCompletedIds();
    state.unfinishedCases = getAllCases()
        .filter(c => c.difficulty === target.difficulty && !completed.includes(c.id));
    if (!state.unfinishedCases.some(c => c.id === caseId)) state.unfinishedCases.push(target);
    state.currentCaseIndex = state.unfinishedCases.findIndex(c => c.id === caseId);
    if (state.currentCaseIndex < 0) state.currentCaseIndex = 0;
    showCurrentCase();
}

export function showCurrentCase() {
    if (!state.unfinishedCases.length) return;
    state.currentCase = state.unfinishedCases[state.currentCaseIndex];
    state.collectedClues = [];
    state.exploredDiags = { inspection: false, auscultation: false, inquiry: false, pulse: false };
    state.inquiryHistory = []; state.askedInquiryQuestions = []; state.gameStarted = true;
    state.inspectionNonTongueAdded = false; state.lastAnswerWasCorrect = false;
    document.getElementById('chiefComplaintText').textContent = state.currentCase.chiefComplaint;
    document.getElementById('historyBtn').style.display = 'inline-flex';
    document.getElementById('fourDiagBtns').style.display = 'grid';
    document.getElementById('clueArea').innerHTML = '';
    document.getElementById('answerFeedback').innerHTML = '';
    document.getElementById('fullAnalysisArea').innerHTML = '';
    document.getElementById('inputSyndrome').value = '';
    document.getElementById('inputDisease').value = '';
    document.getElementById('inputBasis').value = '';
    collapseAnswerCard();
    updateAnswerClosedHint(true);
    ['btnWang', 'btnWen', 'btnAsk', 'btnPulse'].forEach(id => document.getElementById(id)?.classList.remove('explored'));
    document.getElementById('caseTopDiffName').textContent = diffMap[state.currentDifficulty]?.name || state.currentDifficulty;
    document.getElementById('caseTopCounter').textContent = `${state.currentCaseIndex + 1} / ${state.unfinishedCases.length}`;
    document.getElementById('caseCounter').textContent = `病例 ${state.currentCaseIndex + 1} / ${state.unfinishedCases.length}`;
    document.getElementById('prevCaseBtn').style.display = (state.unfinishedCases.length > 1 && state.currentCaseIndex > 0) ? 'inline-flex' : 'none';
    document.getElementById('nextCaseBtn').style.display = (state.unfinishedCases.length > 1 && state.currentCaseIndex < state.unfinishedCases.length - 1) ? 'inline-flex' : 'none';
    document.getElementById('btnOtherCheck').style.display = 'block';
    document.getElementById('difficultyPicker').style.display = 'none';
    document.getElementById('caseWorkspace').style.display = 'block';
    // 望诊图片列表来自病例数据自身，在进入病例时就确定下来
    setInspectionImages(state.currentCase.inspectionImages || []);
    document.getElementById('chiefComplaintCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function prevCase() {
    if (state.currentCaseIndex > 0) { state.currentCaseIndex--; showCurrentCase(); }
}

export function nextCase() {
    if (state.currentCaseIndex < state.unfinishedCases.length - 1) { state.currentCaseIndex++; showCurrentCase(); }
}

/* ===================== 四诊探索 ===================== */
export function exploreDiag(type) {
    if (!state.gameStarted || !state.currentCase) { alert('请先选择关卡。'); return; }
    if (type === 'inquiry') { modalOpeners.openInquiry?.(); return; }
    if (type === 'inspection') { modalOpeners.openInspection?.(); return; }
    if (state.exploredDiags[type]) { alert('该诊法已探索过。'); return; }
    setExplored(type);
    const clue = state.currentCase.clues[type];
    if (clue) {
        openSimpleResultModal(clue.displayTitle, clue.displayContent);
        addClue(type, clue.textSummary);
    }
}

export function showOtherCheck() {
    if (!state.currentCase) return;
    openSimpleResultModal('其他检查', state.currentCase.otherCheck || '无');
}

export function showHistory() {
    if (!state.currentCase) return;
    openSimpleResultModal('病史（既往史）', state.currentCase.history || '无');
}

export function renderClues() {
    const area = document.getElementById('clueArea');
    area.innerHTML = state.collectedClues
        .map(c => `<div class="clue-item"><span class="clue-tag ${escapeHtml(c.tagClass)}">${escapeHtml(c.tag)}</span><span>${escapeHtmlWithBreaks(c.content)}</span></div>`)
        .join('');
    area.scrollTop = area.scrollHeight;
}

function collapseAnswerCard() {
    const body = document.getElementById('answerBody');
    const label = document.getElementById('answerToggleLabel');
    if (body) body.style.display = 'none';
    if (label) label.textContent = '展开';
}

function expandAnswerCard() {
    const body = document.getElementById('answerBody');
    const label = document.getElementById('answerToggleLabel');
    if (body) body.style.display = 'block';
    if (label) label.textContent = '收起';
}

function updateAnswerClosedHint(empty) {
    const hint = document.getElementById('answerClosedHint');
    if (!hint) return;
    hint.textContent = empty ? '先探查至少一诊，再来立证。' : '线索已有，可以写下你的判断。';
}

/* ===================== 提交辨证 ===================== */
export function submitAnswer() {
    if (!state.gameStarted || !state.currentCase) { alert('请先选择关卡。'); return; }
    const syndrome = document.getElementById('inputSyndrome').value.trim();
    const disease = document.getElementById('inputDisease').value.trim();
    const basis = document.getElementById('inputBasis').value.trim();
    if (!syndrome && !disease) { alert('请至少输入证型或病名。'); return; }
    if (!basis) { alert('请写出你的辩证依据。'); return; }

    const correct = state.currentCase.correctAnswer;
    const verdict = evaluateAnswer(correct, { disease, syndrome, basis });
    state.lastAnswerWasCorrect = verdict.isCorrect;

    const progress = requireProgressService();
    let feedbackHtml;
    if (verdict.result === ANSWER_RESULT.CORRECT) {
        feedbackHtml = `<div class="result-box success"><h4>辨证正确</h4><p>${escapeHtml(correct.disease)} · ${escapeHtml(correct.syndrome)}</p>`;
        progress.removeWrong(state.currentCase.id);
    } else {
        if (verdict.result === ANSWER_RESULT.WRONG) {
            feedbackHtml = `<div class="result-box fail"><h4>辨证偏差较大</h4><p>建议继续探查四诊信息。</p>`;
        } else {
            const parts = [
                verdict.diseaseOk ? '病名基本正确' : '病名需调整',
                verdict.syndromeOk ? '证型判断准确' : '证型需斟酌'
            ];
            feedbackHtml = `<div class="result-box fail"><h4>部分正确</h4><p>${parts.join('，')}</p>`;
        }
        progress.saveWrong({ syndrome, disease, basis }, state.currentCase, state.currentDifficulty);
    }
    feedbackHtml += `<button class="btn btn--outline" style="margin-top:10px;" onclick="viewAnswer()">显示答案</button></div>`;

    const fb = document.getElementById('answerFeedback');
    fb.innerHTML = feedbackHtml;
    document.getElementById('fullAnalysisArea').innerHTML = '';
    fb.scrollIntoView({ behavior: 'smooth' });
}

export function viewAnswer() {
    if (!state.currentCase) return;
    showFullAnalysis(document.getElementById('fullAnalysisArea'));
    // 无论对错，做过的病例都标记为已完成，从闯关队列移除；
    // 只有从「我的错题」点击「重新挑战」才能再次进入闯关练习。
    requireProgressService().markCompleted(state.currentCase.id);
}

export function showFullAnalysis(el) {
    const c = state.currentCase;
    const fa = c.fullAnalysis;
    const sourceHtml = c.source
        ? `<p><strong>病例来源：</strong><span class="source-tag">${escapeHtml(c.source)}</span></p>`
        : '';
    el.innerHTML = `<div class="result-box success"><h4>完整医案解析</h4>
        <p><strong>中医病证：</strong>${escapeHtml(fa.disease)}（${escapeHtml(fa.syndrome)}）</p>
        <p><strong>西医诊断：</strong>${escapeHtml(fa.westernDiagnosis)}</p>
        ${sourceHtml}
        <hr><p><strong>病机分析：</strong>${escapeHtml(fa.pathogenesis)}</p>
        <hr><p><strong>推荐方药：</strong>${escapeHtml(fa.prescription)}</p>
        <hr><p><strong>知识点：</strong></p><ul>${fa.knowledgePoints.map(k => `<li>${escapeHtml(k)}</li>`).join('')}</ul>
        <hr><p style="color:var(--text-muted);font-size:0.9em;">提示：可自行查找该病例的二诊、三诊等后续诊疗情况。</p></div>`;
}

export function resetCurrentCase() {
    if (!state.currentCase) return;
    if (!confirm('确定重新探查吗？线索将清除。')) return;
    state.collectedClues = [];
    state.exploredDiags = { inspection: false, auscultation: false, inquiry: false, pulse: false };
    state.inquiryHistory = []; state.askedInquiryQuestions = [];
    state.inspectionNonTongueAdded = false; state.lastAnswerWasCorrect = false;
    document.getElementById('clueArea').innerHTML = '';
    document.getElementById('answerFeedback').innerHTML = '';
    document.getElementById('fullAnalysisArea').innerHTML = '';
    document.getElementById('inputSyndrome').value = '';
    document.getElementById('inputDisease').value = '';
    document.getElementById('inputBasis').value = '';
    collapseAnswerCard();
    updateAnswerClosedHint(true);
    ['btnWang', 'btnWen', 'btnAsk', 'btnPulse'].forEach(id => document.getElementById(id)?.classList.remove('explored'));
}

/* ===================== 难度元数据（供 UI 装配使用） ===================== */
export function getDifficultyOptions() {
    return diffOrder.map(d => ({ key: d, name: diffMap[d].name }));
}

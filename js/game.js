/* ===================== 闯关游戏（核心状态 + 游戏流程） ===================== */
// 本模块维护唯一的游戏状态 state，并负责闯关主流程。
// 为避免循环依赖：
//   - 其它模块通过 import { state } 读取/写入同一份状态（单一数据源）
//   - game.js 不直接 import 问诊/望诊/题库模块；问诊与望诊弹窗的打开函数
//     由 app.js 通过 registerModalOpeners 注入。

import {
    escapeHtml, escapeHtmlWithBreaks, getAllCases
} from './data.js';
import {
    getCompletedCases, markCaseCompleted, resolveWrongCase, saveWrongCase
} from './storage.js';
import { syncProgressToServer, maybeShowRegisterReminder } from './auth.js';

/* ===================== 唯一游戏状态 ===================== */
export const state = {
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
    lastAnswerWasCorrect: false,
};

// 由 app.js 注入：openInquiry / openInspection 等弹窗打开函数
let modalOpeners = {};
export function registerModalOpeners(fns) { modalOpeners = { ...modalOpeners, ...fns }; }

/* ===================== 页面导航（由 app.js 注入 showPage） ===================== */
let showPageFn = null;
export function registerNav(fns) { showPageFn = fns.showPage || showPageFn; }

/* ===================== 简单结果模态框 ===================== */
export function openSimpleResultModal(title, content) {
    document.getElementById('simpleResultTitle').textContent = title;
    document.getElementById('simpleResultContent').textContent = content;
    document.getElementById('simpleResultModal').style.display = 'flex';
}
export function closeSimpleResultModal() { document.getElementById('simpleResultModal').style.display = 'none'; }

/* ===================== 闯关逻辑 ===================== */
export function startChallenge() { if (showPageFn) showPageFn('Game'); resetGameUI(); }

export function resetGameUI() {
    state.currentDifficulty = null; state.currentCase = null; state.collectedClues = []; state.exploredDiags = {}; state.gameStarted = false;
    state.inquiryHistory = []; state.askedInquiryQuestions = []; state.unfinishedCases = []; state.currentCaseIndex = 0; state.inspectionNonTongueAdded = false; state.lastAnswerWasCorrect = false;
    document.getElementById('chiefComplaintCard').style.display = 'none';
    document.getElementById('fourDiagBtns').style.display = 'none';
    document.getElementById('btnOtherCheck').style.display = 'none';
    document.getElementById('clueCollectionCard').style.display = 'none';
    document.getElementById('answerCard').style.display = 'none';
    document.getElementById('gameExtraBtns').style.display = 'none';
    document.getElementById('historyBtn').style.display = 'none';
    document.getElementById('clueArea').innerHTML = '';
    document.getElementById('answerFeedback').innerHTML = '';
    document.getElementById('fullAnalysisArea').innerHTML = '';
    document.getElementById('inputSyndrome').value = '';
    document.getElementById('inputDisease').value = '';
    document.getElementById('inputBasis').value = '';
    document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => b.classList.remove('selected'));
    ['btnWang','btnWen','btnAsk','btnPulse'].forEach(id => document.getElementById(id)?.classList.remove('explored'));
}

export function selectDifficulty(diff, btnEl) {
    document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => b.classList.remove('selected'));
    btnEl.classList.add('selected');
    state.currentDifficulty = diff;
    const pool = getAllCases().filter(c => c.difficulty === diff);
    if (!pool || pool.length === 0) { alert('该难度暂无病例。'); return; }
    const completed = getCompletedCases();
    state.unfinishedCases = pool.filter(c => !completed.includes(c.id));
    if (state.unfinishedCases.length === 0) {
        openSimpleResultModal('🎉 闯关完毕', '该难度下所有病例均已完成，无新病例可学习。您可以在病例题库中复习已完成的病例。');
        document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => b.classList.remove('selected'));
        state.currentDifficulty = null;
        return;
    }
    state.currentCaseIndex = 0;
    showCurrentCase();
}

export function showCurrentCase() {
    if (!state.unfinishedCases.length) return;
    state.currentCase = state.unfinishedCases[state.currentCaseIndex];
    state.collectedClues = []; state.exploredDiags = { inspection: false, auscultation: false, inquiry: false, pulse: false };
    state.inquiryHistory = []; state.askedInquiryQuestions = []; state.gameStarted = true; state.inspectionNonTongueAdded = false; state.lastAnswerWasCorrect = false;
    document.getElementById('chiefComplaintCard').style.display = 'block';
    document.getElementById('chiefComplaintText').textContent = state.currentCase.chiefComplaint;
    document.getElementById('historyBtn').style.display = 'inline-flex';
    document.getElementById('fourDiagBtns').style.display = 'grid';
    document.getElementById('clueCollectionCard').style.display = 'block';
    document.getElementById('answerCard').style.display = 'block';
    document.getElementById('gameExtraBtns').style.display = 'flex';
    document.getElementById('clueArea').innerHTML = '';
    document.getElementById('answerFeedback').innerHTML = '';
    document.getElementById('fullAnalysisArea').innerHTML = '';
    document.getElementById('inputSyndrome').value = '';
    document.getElementById('inputDisease').value = '';
    document.getElementById('inputBasis').value = '';
    ['btnWang','btnWen','btnAsk','btnPulse'].forEach(id => document.getElementById(id)?.classList.remove('explored'));
    document.getElementById('caseCounter').textContent = `病例 ${state.currentCaseIndex + 1} / ${state.unfinishedCases.length}`;
    document.getElementById('prevCaseBtn').style.display = (state.unfinishedCases.length > 1 && state.currentCaseIndex > 0) ? 'inline-flex' : 'none';
    document.getElementById('nextCaseBtn').style.display = (state.unfinishedCases.length > 1 && state.currentCaseIndex < state.unfinishedCases.length - 1) ? 'inline-flex' : 'none';
    const otherCheckBtn = document.getElementById('btnOtherCheck');
    otherCheckBtn.style.display = 'block';
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
    if (type === 'inquiry') { if (modalOpeners.openInquiry) modalOpeners.openInquiry(); return; }
    if (type === 'inspection') { if (modalOpeners.openInspection) modalOpeners.openInspection(); return; }
    if (state.exploredDiags[type]) { alert('该诊法已探索过。'); return; }
    state.exploredDiags[type] = true; markExplored(type);
    const clue = state.currentCase.clues[type];
    if (clue) { openSimpleResultModal(clue.displayTitle, clue.displayContent); addClue(type, clue.textSummary); }
}

export function showOtherCheck() {
    if (!state.currentCase) return;
    openSimpleResultModal('📋 其他检查', state.currentCase.otherCheck || '无');
}

export function markExplored(type) {
    const map = { inspection: 'btnWang', auscultation: 'btnWen', inquiry: 'btnAsk', pulse: 'btnPulse' };
    document.getElementById(map[type])?.classList.add('explored');
}

export function addClue(type, content, tagText) {
    const tagMap = { inspection: 'tag-wang', auscultation: 'tag-wen', inquiry: 'tag-ask', pulse: 'tag-pulse' };
    const nameMap = { inspection: '望诊', auscultation: '闻诊', inquiry: '问诊', pulse: '切脉' };
    const tag = tagText || nameMap[type];
    if (state.collectedClues.some(c => c.content === content && c.tag === tag)) return;
    state.collectedClues.push({ tag, tagClass: tagMap[type], content });
    renderClues();
}

export function renderClues() {
    const area = document.getElementById('clueArea');
    area.innerHTML = state.collectedClues.map(c => `<div class="clue-item"><span class="clue-tag ${escapeHtml(c.tagClass)}">${escapeHtml(c.tag)}</span><span>${escapeHtmlWithBreaks(c.content)}</span></div>`).join('');
    area.scrollTop = area.scrollHeight;
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
    const fb = document.getElementById('answerFeedback');
    const analysis = document.getElementById('fullAnalysisArea');
    const dOk = disease && correct.disease.includes(disease.replace(/证$/, ''));
    const sOk = syndrome && (
        correct.syndrome.includes('风热') && syndrome.includes('风热') && syndrome.includes('津伤') ||
        correct.syndrome.includes('脾胃虚寒') && syndrome.includes('脾胃虚寒') ||
        correct.syndrome.includes('痰瘀互结') && syndrome.includes('痰瘀') && syndrome.includes('互结') ||
        correct.syndrome.includes('痰热壅肺') && syndrome.includes('痰热壅肺') ||
        syndrome === correct.syndrome || correct.syndrome.includes(syndrome) || syndrome.includes(correct.syndrome)
    );
    const isCorrect = dOk && sOk;
    state.lastAnswerWasCorrect = isCorrect;
    let feedbackHtml = '';
    if (isCorrect) {
        feedbackHtml = `<div class="result-box success"><h4>🎉 辨证正确！</h4><p>${escapeHtml(correct.disease)} · ${escapeHtml(correct.syndrome)}</p>`;
        // 答对时不能只删本地错题：必须同时写入 resolved tombstone，
        // 否则离线订正后，D1 里旧的 is_wrong=1 会在同步合并时把错题"复活"回本地。
        resolveWrongCase(state.currentCase.id);
        // 只在"提交答案"这个定局时刻同步一行到 D1，探查四诊等中间过程不产生任何云端写入。
        syncProgressToServer(state.currentCase.id, { isWrong: false, syndrome, disease, basis });
    } else {
        if (!dOk && !sOk) {
            feedbackHtml = `<div class="result-box fail"><h4>🤔 辨证偏差较大</h4><p>建议继续探查四诊信息。</p>`;
        } else {
            const parts = [];
            if (dOk) parts.push('✅ 病名基本正确'); else parts.push('⚠️ 病名需调整');
            if (sOk) parts.push('✅ 证型判断准确'); else parts.push('⚠️ 证型需斟酌');
            feedbackHtml = `<div class="result-box fail"><h4>🔍 部分正确</h4><p>${parts.join('，')}</p>`;
        }
        saveWrongCase({ syndrome, disease, basis }, state.currentCase, state.currentDifficulty);
        syncProgressToServer(state.currentCase.id, { isWrong: true, syndrome, disease, basis });
    }
    feedbackHtml += `<button class="btn btn--outline" style="margin-top:10px;" onclick="viewAnswer()">💡 显示答案</button></div>`;
    fb.innerHTML = feedbackHtml;
    analysis.innerHTML = '';
    fb.scrollIntoView({ behavior: 'smooth' });
}

export function viewAnswer() {
    if (!state.currentCase) return;
    showFullAnalysis(document.getElementById('fullAnalysisArea'));
    // 无论对错，做过的病例都标记为已完成，从闯关队列移除；
    // 只有从"我的错题"点击"重新挑战"才能再次进入闯关练习。
    markCaseCompleted(state.currentCase.id);
    // "查看解析"是另一个定局时刻，同步一次 is_completed；游客模式下 syncProgressToServer 内部会直接跳过。
    syncProgressToServer(state.currentCase.id, { isCompleted: true });
    maybeShowRegisterReminder();
}

export function showFullAnalysis(el) {
    const fa = state.currentCase.fullAnalysis;
    const sourceHtml = state.currentCase.source ? `<p><strong>病例来源：</strong><span class="source-tag">${escapeHtml(state.currentCase.source)}</span></p>` : '';
    el.innerHTML = `<div class="result-box success"><h4>📋 完整医案解析</h4>
        <p><strong>中医病证：</strong>${escapeHtml(fa.disease)}（${escapeHtml(fa.syndrome)}）</p>
        <p><strong>西医诊断：</strong>${escapeHtml(fa.westernDiagnosis)}</p>
        ${sourceHtml}
        <hr><p><strong>病机分析：</strong>${escapeHtml(fa.pathogenesis)}</p>
        <hr><p><strong>推荐方药：</strong>${escapeHtml(fa.prescription)}</p>
        <hr><p><strong>知识点：</strong></p><ul>${fa.knowledgePoints.map(k => `<li>${escapeHtml(k)}</li>`).join('')}</ul>
        <hr><p style="color:var(--text-muted);font-size:0.9em;">💡 提示：可自行查找该病例的二诊、三诊等后续诊疗情况。</p></div>`;
}

export function resetCurrentCase() {
    if (!state.currentCase) return;
    if (confirm('确定重新探查吗？线索将清除。')) {
        state.collectedClues = []; state.exploredDiags = { inspection: false, auscultation: false, inquiry: false, pulse: false };
        state.inquiryHistory = []; state.askedInquiryQuestions = []; state.inspectionNonTongueAdded = false; state.lastAnswerWasCorrect = false;
        document.getElementById('clueArea').innerHTML = '';
        document.getElementById('answerFeedback').innerHTML = '';
        document.getElementById('fullAnalysisArea').innerHTML = '';
        document.getElementById('inputSyndrome').value = '';
        document.getElementById('inputDisease').value = '';
        document.getElementById('inputBasis').value = '';
        ['btnWang','btnWen','btnAsk','btnPulse'].forEach(id => document.getElementById(id)?.classList.remove('explored'));
    }
}

export function showHistory() {
    if (!state.currentCase) return;
    openSimpleResultModal('📜 病史（既往史）', state.currentCase.history || '无');
}

/* ===================== 问诊（问什么，只回答什么） ===================== */
import { state, addClue, markExplored } from './game.js';
import { resolveInquiry as resolveByIntent, detectIntents } from './inquiry-matcher.js';

// 开发调试：地址栏加 ?debug=1 或 localStorage.setItem('inquiryDebug','1')
const DEBUG = (() => {
    try { return /[?&]debug\b/.test(location.search) || localStorage.getItem('inquiryDebug') === '1'; }
    catch (e) { return false; }
})();

/* 对外的解析入口：intent 匹配 + 调试输出（生产环境不展示给用户） */
export function resolveInquiry(questions, text) {
    const res = resolveByIntent(questions, text);
    if (DEBUG) {
        const d = detectIntents(text);
        console.debug('[inquiry] 用户输入：', text);
        console.debug('[inquiry] 识别 dimension：', d.dims.join(', ') || '(无)');
        console.debug('[inquiry] 识别 intent：', res.intent || '(无对应)',
            '| aspects：', (res.aspects || []).join(', ') || '(无)');
        console.debug('[inquiry] 候选取分：', (res.debug && res.debug.candidates) || res.debug);
        if (res.index >= 0) console.debug('[inquiry] 最终命中：', questions[res.index].q, '→', res.answer);
        else console.debug('[inquiry] 最终命中：无（中性回答）');
    }
    return res;
}

/* ===================== 问诊弹窗 ===================== */
export function openInquiryModal() {
    if (!state.currentCase) return;
    document.getElementById('inquiryChatArea').innerHTML = '';
    state.inquiryHistory.forEach(m => appendChat(m.role, m.text));
    document.getElementById('inquiryInput').value = '';
    document.getElementById('inquiryModal').style.display = 'flex';
    document.getElementById('inquiryInput').focus();
}

function appendChat(role, text) {
    const div = document.createElement('div');
    div.className = 'chat-bubble ' + (role === 'user' ? 'user' : 'patient');
    div.textContent = text;
    document.getElementById('inquiryChatArea').appendChild(div);
    document.getElementById('inquiryChatArea').scrollTop = document.getElementById('inquiryChatArea').scrollHeight;
}

export function sendInquiry() {
    const input = document.getElementById('inquiryInput');
    const q = input.value.trim();
    if (!q || !state.currentCase) return;
    state.inquiryHistory.push({ role: 'user', text: q }); appendChat('user', q);
    input.value = '';
    const questions = state.currentCase.clues.inquiry.questions;
    const res = resolveInquiry(questions, q);
    let answer = res.answer;
    if (res.type === 'match' || res.type === 'joint') {
        // 多意图合并回答：逐个记入线索与已问
        for (const idx of (res.indices && res.indices.length ? res.indices : [res.index])) {
            if (idx == null || idx < 0) continue;
            if (!state.askedInquiryQuestions.includes(idx)) {
                state.askedInquiryQuestions.push(idx);
                addClue('inquiry', questions[idx].a, '问诊·' + questions[idx].q);
            } else {
                answer += '（这个问题刚才已经回答过了）';
                break;
            }
        }
    }
    // catchall / neutral 不写入线索、不计入已问，避免剧透或虚构"正常"
    setTimeout(() => {
        state.inquiryHistory.push({ role: 'patient', text: answer }); appendChat('patient', answer);
        if (state.askedInquiryQuestions.length >= questions.length) { state.exploredDiags.inquiry = true; markExplored('inquiry'); }
    }, 300);
}

export function closeInquiryModal() {
    document.getElementById('inquiryModal').style.display = 'none';
    if (state.currentCase && state.askedInquiryQuestions.length >= state.currentCase.clues.inquiry.questions.length) {
        state.exploredDiags.inquiry = true; markExplored('inquiry');
    }
}

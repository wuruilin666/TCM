/* ===================== 问诊（问什么，只回答什么） =====================
 * 职责：
 *   - 问诊弹窗的交互与消息渲染
 *   - 调用 inquiry-matcher 解析用户输入
 *   - 通过 Game Session 的公开接口把结果写回会话
 *
 * 不直接读写 game 的 state，也不负责匹配算法（属于 inquiry-matcher）。
 * ================================================================================== */

import { resolveInquiry as resolveByIntent, detectIntents } from './inquiry-matcher.js';
import {
    getSession, getCurrentCase, appendInquiryMessage, recordInquiryTurn,
    setExplored, getInquiryProgress
} from './game.js';

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
    if (!getCurrentCase()) return;
    document.getElementById('inquiryChatArea').innerHTML = '';
    getSession().inquiryHistory.forEach(m => appendChat(m.role, m.text));
    document.getElementById('inquiryInput').value = '';
    document.getElementById('inquiryModal').style.display = 'flex';
    document.getElementById('inquiryInput').focus();
}

function appendChat(role, text) {
    const area = document.getElementById('inquiryChatArea');
    const div = document.createElement('div');
    div.className = 'chat-bubble ' + (role === 'user' ? 'user' : 'patient');
    div.textContent = text;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
}

export function sendInquiry() {
    const input = document.getElementById('inquiryInput');
    const q = input.value.trim();
    const currentCase = getCurrentCase();
    if (!q || !currentCase) return;

    appendInquiryMessage('user', q);
    appendChat('user', q);
    input.value = '';

    const questions = currentCase.clues.inquiry.questions;
    const res = resolveInquiry(questions, q);
    let answer = res.answer;

    if (res.type === 'match' || res.type === 'joint') {
        // 多意图合并回答：逐个记入线索与已问
        const indices = (res.indices && res.indices.length) ? res.indices : [res.index];
        for (const idx of indices) {
            if (idx == null || idx < 0) continue;
            const turn = recordInquiryTurn(questions[idx].q, questions[idx].a, idx);
            if (turn.duplicate) {
                answer += '（这个问题刚才已经回答过了）';
                break;
            }
        }
    }
    // catchall / neutral 不写入线索、不计入已问，避免剧透或虚构"正常"
    setTimeout(() => {
        appendInquiryMessage('patient', answer);
        appendChat('patient', answer);
        const progress = getInquiryProgress();
        if (progress.allAsked) setExplored('inquiry');
    }, 300);
}

export function closeInquiryModal() {
    document.getElementById('inquiryModal').style.display = 'none';
    if (!getCurrentCase()) return;
    if (getInquiryProgress().allAsked) setExplored('inquiry');
}

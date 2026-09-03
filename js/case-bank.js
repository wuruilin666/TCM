/* ===================== 病例题库 / 我的错题 / 病例解析 ===================== */
import { state, resetGameUI, showCurrentCase } from './game.js';
import {
    getAllCases, diffMap, categoryMap, diffOrder, escapeHtml, escapeHtmlWithBreaks
} from './data.js';
import { getCompletedCases, getWrongCases, formatDate, resolveWrongCases } from './storage.js';
import { authState, syncProgressToServer } from './auth.js';

// 题库筛选状态
let bankCategory = 'all';
let bankDiff = 'all';

// 由 app.js 注入 showPage（避免循环依赖）
let showPageFn = null;
export function registerNav(fns) { showPageFn = fns.showPage || showPageFn; }

export function openCaseBank() {
    bankCategory = 'all'; bankDiff = 'all';
    document.getElementById('caseBankContent').innerHTML = `
        <div style="margin-bottom:12px;">
            <input type="text" id="caseSearchInput" placeholder="搜索主诉关键词" oninput="filterCaseBank()" style="width:100%;padding:10px 14px;border-radius:24px;border:2px solid var(--border);font-size:0.95em;background:#fffefb;outline:none;">
        </div>
        <div id="bankFilterBar"></div>
        <div id="caseBankList"></div>
    `;
    renderBankFilters();
    filterCaseBank();
    document.getElementById('caseBankModal').style.display = 'flex';
}

// 获取 casesDB 中实际存在的一级分类（保持 categoryMap 顺序，不含 'all'）
function getActiveCategories() {
    const cases = getAllCases();
    const present = new Set();
    for (const c of cases) present.add(c.category);
    return Object.keys(categoryMap).filter(k => present.has(k));
}
// 获取 casesDB 中实际存在的训练阶段（保持 diffOrder 顺序，不含 'all'）
function getActiveDifficulties() {
    const cases = getAllCases();
    const present = new Set();
    for (const c of cases) present.add(c.difficulty);
    return diffOrder.filter(d => present.has(d));
}

// 渲染分类 + 难度筛选栏（分类/难度/搜索三种可叠加）
function renderBankFilters() {
    const bar = document.getElementById('bankFilterBar');
    if (!bar) return;
    const cases = getAllCases();
    // 分类按钮组：全部 + 全部一级分类（含暂无病例的分类，标注「暂无」）
    const catCount = {};
    for (const c of cases) catCount[c.category] = (catCount[c.category] || 0) + 1;
    const catKeys = Object.keys(categoryMap).filter(k => k !== 'all');
    const catHtml = ['all', ...catKeys].map(key => {
        if (key === 'all') {
            return `<button class="bank-chip${bankCategory === 'all' ? ' active' : ''}" onclick="selectBankCategory('all')">全部</button>`;
        }
        const hasCase = (catCount[key] || 0) > 0;
        const mark = hasCase ? '' : '<span style="color:#c9b8a6;font-weight:400;">（暂无）</span>';
        return `<button class="bank-chip${bankCategory === key ? ' active' : ''}${hasCase ? '' : ' empty'}" onclick="selectBankCategory('${key}')">${categoryMap[key].name}${mark}</button>`;
    }).join('');
    // 难度按钮组：全部 + 有病例的训练阶段
    const diffHtml = ['all', ...getActiveDifficulties()].map(d =>
        `<button class="bank-chip${bankDiff === d ? ' active' : ''}" onclick="selectBankDiff('${d}')">${d === 'all' ? '全部' : diffMap[d].name}</button>`
    ).join('');
    bar.innerHTML = `
        <div class="bank-block"><div class="bank-label">分类</div><div class="bank-chip-wrap">${catHtml}</div></div>
        <div class="bank-block"><div class="bank-label">难度</div><div class="bank-chip-wrap">${diffHtml}</div></div>
    `;
}

function selectBankCategory(key) { bankCategory = key; renderBankFilters(); filterCaseBank(); }
function selectBankDiff(d) { bankDiff = d; renderBankFilters(); filterCaseBank(); }

function filterCaseBank() {
    const listEl = document.getElementById('caseBankList');
    if (!listEl) return;
    const keyword = (document.getElementById('caseSearchInput')?.value || '').trim().toLowerCase();
    const completedIds = getCompletedCases();
    const wrongIds = getWrongCases().map(w => w.id);
    const cases = getAllCases();

    const filtered = cases.filter(c => {
        if (bankCategory !== 'all' && c.category !== bankCategory) return false;
        if (bankDiff !== 'all' && c.difficulty !== bankDiff) return false;
        if (keyword && !c.chiefComplaint.toLowerCase().includes(keyword)) return false;
        return true;
    });

    // 排序：未完成在前，已完成在后；同状态按原始顺序
    filtered.sort((a, b) => {
        const ca = completedIds.includes(a.id) ? 1 : 0;
        const cb = completedIds.includes(b.id) ? 1 : 0;
        if (ca !== cb) return ca - cb;
        return 0; // 保持原顺序（Array.sort 稳定）
    });

    let html = '';
    const count = filtered.length;
    const doneCount = filtered.filter(c => completedIds.includes(c.id)).length;
    html += `<div class="bank-summary">共 ${count} 例（未完成 ${count - doneCount} · 已完成 ${doneCount}）</div>`;

    if (filtered.length === 0) {
        if (bankCategory !== 'all') {
            const cm = categoryMap[bankCategory];
            html += `<p style="text-align:center;color:#b5a595;padding:12px 0;">${cm ? cm.emoji + ' ' + cm.name : ''}暂无病例，敬请期待。</p>`;
        } else {
            html += '<p style="text-align:center;color:#b5a595;padding:12px 0;">未找到匹配病例</p>';
        }
        listEl.innerHTML = html;
        return;
    }

    filtered.forEach((c) => {
        const isCompleted = completedIds.includes(c.id);
        const isWrong = wrongIds.includes(c.id);
        const diffMeta = diffMap[c.difficulty] || { name: c.difficulty, emoji: '' };
        const catMeta = categoryMap[c.category] || { name: c.category, emoji: '' };
        // 主标题：完整主诉（保留换行）；卡片不暴露诊断（病名/证型）
        const fullComplaint = escapeHtmlWithBreaks(c.chiefComplaint);
        // 右上角标签：分类 + 难度
        const tag = `<span class="case-tag case-tag-cat">${catMeta.emoji} ${catMeta.name}</span> <span class="case-tag">${diffMeta.emoji} ${diffMeta.name}</span>`;
        const header = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
            <div style="font-weight:700;color:var(--text-light);flex:1;min-width:0;font-size:0.95em;line-height:1.6;">${fullComplaint}</div>
            <div style="display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;">${tag}</div>
        </div>`;
        if (isCompleted && !isWrong) {
            // 已做对：列表标题为主诉，下方展开完整医案（此时才显示诊断）
            html += `<div class="case-bank-item done" style="padding:12px;margin:8px 0;background:#fdfaf5;border-radius:10px;border:2px solid var(--gold-light);font-size:0.9em;line-height:1.7;">
                ${header}
                <div class="case-full">${renderFullCase(c)}</div>
            </div>`;
        } else if (isCompleted && isWrong) {
            // 做错过：提供"重新挑战"
            html += `<div class="case-bank-item wrong" style="padding:12px;margin:8px 0;background:#fdfaf5;border-radius:8px;border:1px solid var(--border);font-size:0.9em;line-height:1.7;">
                ${header}
                <div style="margin-top:8px;">
                    <button class="btn btn--primary btn--sm" onclick="challengeCaseFromBank('${escapeHtml(c.id)}')">🔄 重新挑战</button>
                    <span style="color:var(--text-muted);font-size:0.85em;margin-left:8px;">⚠️ 本题作答有误，可重新挑战</span>
                </div>
            </div>`;
        } else {
            // 未做过：提供"挑战病例"
            html += `<div class="case-bank-item todo" style="padding:12px;margin:8px 0;background:#fdfaf5;border-radius:8px;border:1px solid var(--border);font-size:0.9em;line-height:1.7;">
                ${header}
                <div style="margin-top:8px;">
                    <button class="btn btn--primary btn--sm" onclick="challengeCaseFromBank('${escapeHtml(c.id)}')">⚔️ 挑战病例</button>
                    <span style="color:var(--text-muted);font-size:0.85em;margin-left:8px;">❓ 完成挑战后可查看完整医案</span>
                </div>
            </div>`;
        }
    });
    listEl.innerHTML = html;
}

// 从题库点击"挑战病例"：跳转到闯关页并练习该病例
function challengeCaseFromBank(caseId) {
    const c = findCaseById(caseId);
    if (!c) { alert('病例不存在。'); return; }
    closeCaseBank();
    if (showPageFn) showPageFn('Game');
    resetGameUI();
    state.currentDifficulty = c.difficulty;
    document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => b.classList.toggle('selected', b.dataset.diff === c.difficulty));
    const completed = getCompletedCases();
    state.unfinishedCases = getAllCases().filter(x => x.difficulty === c.difficulty && !completed.includes(x.id));
    if (!state.unfinishedCases.some(x => x.id === caseId)) state.unfinishedCases.push(c);
    state.currentCaseIndex = state.unfinishedCases.findIndex(x => x.id === caseId);
    if (state.currentCaseIndex < 0) state.currentCaseIndex = 0;
    showCurrentCase();
}

function renderFullCase(c) {
    const fa = c.fullAnalysis; const cl = c.clues;
    let html = `<div style="margin:6px 0 10px 0;"><strong>🩺 主诉 / 基本情况：</strong><br>${escapeHtmlWithBreaks(c.chiefComplaint)}</div>`;
    if (c.history) html += `<div style="margin:6px 0 10px 0;"><strong>📜 既往史：</strong><br>${escapeHtmlWithBreaks(c.history)}</div>`;
    html += `<div style="margin:6px 0 10px 0;"><strong>🔍 四诊情况：</strong><br>`;
    html += `【望诊】${escapeHtml(cl.inspection.displayContent)}<br>【闻诊】${escapeHtml(cl.auscultation.displayContent)}<br>`;
    if (cl.inquiry && cl.inquiry.questions) html += `【问诊】<br>` + cl.inquiry.questions.map(q => `· ${escapeHtml(q.q)}：${escapeHtml(q.a)}`).join('<br>') + `<br>`;
    html += `【切诊】${escapeHtml(cl.pulse.displayContent)}</div>`;
    if (c.otherCheck) html += `<div style="margin:6px 0 10px 0;"><strong>📋 其他检查：</strong><br>${escapeHtmlWithBreaks(c.otherCheck)}</div>`;
    html += `<div style="margin:6px 0 4px 0;"><strong>📋 辨证分析过程：</strong><br>中医病证：${escapeHtml(fa.disease)}（${escapeHtml(fa.syndrome)}）<br>`;
    if (fa.westernDiagnosis) html += `西医诊断：${escapeHtml(fa.westernDiagnosis)}<br>`;
    if (c.source) html += `<span class="source-tag">病例来源：${escapeHtml(c.source)}</span><br>`;
    html += `病机分析：${escapeHtml(fa.pathogenesis)}<br>推荐方药：${escapeHtml(fa.prescription)}<br>`;
    if (fa.knowledgePoints && fa.knowledgePoints.length) html += `知识点：${fa.knowledgePoints.map(escapeHtml).join('；')}`;
    html += `</div>`;
    html += `<div style="margin-top:6px;color:var(--text-muted);font-size:0.88em;">💡 提示：可自行查找该病例的二诊、三诊等后续诊疗情况。</div>`;
    return html;
}

function closeCaseBank() { document.getElementById('caseBankModal').style.display = 'none'; }

/* ===================== 我的错题 ===================== */
function openRecords() {
    const wrongs = getWrongCases();
    const el = document.getElementById('recordsContent');
    if (wrongs.length === 0) {
        el.innerHTML = '<p style="text-align:center;color:#b5a595;">🎉 暂无错题，继续保持！</p>';
    } else {
        const items = wrongs.slice().reverse().map((w, i) => {
            const c = findCaseById(w.id);
            // 优先使用当前静态病例 JSON 中的病例数据；题库中不存在时才回退本地缓存
            const title = c ? c.title : w.title;
            const chiefComplaint = c ? c.chiefComplaint : w.chiefComplaint;
            const diffMeta = c ? (diffMap[c.difficulty] || { name: c.difficulty, emoji: '' }) : { name: w.difficulty || '', emoji: '' };
            const answerParts = [];
            if (w.syndrome) answerParts.push('证型：' + w.syndrome);
            if (w.disease) answerParts.push('病名：' + w.disease);
            const answerStr = answerParts.join('；') || '未填写';
            return `<div class="wrong-card">
                <div class="wrong-title">错题${i + 1} ${diffMeta.emoji ? '<span style="font-size:0.85em;color:var(--text-muted);margin-left:6px;">' + escapeHtml(diffMeta.emoji + ' ' + diffMeta.name) + '</span>' : ''}</div>
                <div class="wrong-meta">${formatDate(w.date)}</div>
                <div><strong>标题：</strong>${escapeHtml(title || '未知病例')}</div>
                <div><strong>主诉：</strong>${escapeHtmlWithBreaks(chiefComplaint || '暂无')}</div>
                <div><strong>我的答案：</strong>${escapeHtml(answerStr)}</div>
                <div><strong>我的辨证依据：</strong>${escapeHtml(w.basis || '未填写')}</div>
                <div class="wrong-actions">
                    <button class="btn btn--outline btn--sm" onclick="rechallengeCase('${escapeHtml(w.id)}')">🔄 重新挑战</button>
                    <button class="btn btn--ghost btn--sm" onclick="viewWrongCaseAnalysis('${escapeHtml(w.id)}')">💡 查看解析</button>
                </div>
            </div>`;
        }).join('');
        el.innerHTML = items + '<button class="btn btn--ghost" style="margin-top:10px;width:100%;" onclick="clearRecords()">🗑️ 清空错题</button>';
    }
    document.getElementById('recordsModal').style.display = 'flex';
}

function closeRecords() { document.getElementById('recordsModal').style.display = 'none'; }

async function clearRecords() {
    if (!confirm('清空我的错题？')) return;
    const wrongs = getWrongCases();
    // 清空也要写 tombstone：否则同步时 D1 里旧的 is_wrong=1 会把这些错题复活回来
    resolveWrongCases(wrongs.map(w => w.id));
    // 登录用户：把清空操作同步到 D1，避免下次拉取又把旧错题覆盖回来
    if (authState.loggedIn) {
        for (const w of wrongs) {
            try { await syncProgressToServer(w.id, { isWrong: false }); } catch (e) {}
        }
    }
    closeRecords();
}

function findCaseById(caseId) {
    return getAllCases().find(x => x.id === caseId) || null;
}

function findCaseDifficulty(caseId) {
    const c = findCaseById(caseId);
    return c ? c.difficulty : null;
}

function rechallengeCase(caseId) {
    closeRecords();
    const diff = findCaseDifficulty(caseId);
    if (!diff) { alert('病例不存在。'); return; }
    if (showPageFn) showPageFn('Game');
    resetGameUI();
    state.currentDifficulty = diff;
    document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => b.classList.toggle('selected', b.dataset.diff === diff));
    const pool = getAllCases().filter(c => c.difficulty === diff);
    const completed = getCompletedCases();
    state.unfinishedCases = pool.filter(c => !completed.includes(c.id));
    if (!state.unfinishedCases.some(c => c.id === caseId)) {
        const c = findCaseById(caseId);
        if (c) state.unfinishedCases.push(c);
    }
    state.currentCaseIndex = state.unfinishedCases.findIndex(c => c.id === caseId);
    if (state.currentCaseIndex < 0) state.currentCaseIndex = 0;
    showCurrentCase();
}

function viewWrongCaseAnalysis(caseId) {
    const c = findCaseById(caseId);
    if (!c) { alert('病例不存在。'); return; }
    openCaseDetail(c);
}

function openCaseDetail(c) {
    document.getElementById('caseDetailTitle').textContent = '📋 ' + c.title;
    document.getElementById('caseDetailContent').innerHTML = renderFullCase(c);
    document.getElementById('caseDetailModal').style.display = 'flex';
}

function closeCaseDetail() { document.getElementById('caseDetailModal').style.display = 'none'; }

/* ===================== 导出（供 app.js 暴露到 window） ===================== */
export {
    selectBankCategory, selectBankDiff, filterCaseBank,
    challengeCaseFromBank, renderFullCase, closeCaseBank,
    openRecords, closeRecords, findCaseById, findCaseDifficulty,
    rechallengeCase, viewWrongCaseAnalysis, openCaseDetail, closeCaseDetail,
    clearRecords, getActiveCategories, getActiveDifficulties, renderBankFilters
};

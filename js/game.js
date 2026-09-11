/* ===================== 游戏会话（唯一游戏状态 + 闯关流程） =====================
 * 拥有：
 *   - 会话阶段（IDLE / EXPLORING / SUBMITTED）
 *   - 当前难度 / 当前病例 / 闯关队列 / 关卡内序号
 *   - 已收集线索 / 已探索诊法 / 问诊历史 / 望诊图片浏览位置
 *   - 闯关流程（选关 → 展示病例 → 探索四诊 → 提交辨证 → 查看解析）
 *
 * 依赖方向：
 *   Game Session → Domain（answer-evaluator / data）
 *   Game Session ← Application 注入（导航、弹窗、进度存储、病例数据源）
 *
 * Game 不 import Storage，也不 import Inquiry / Inspection / Case Bank：
 * 进度读写通过 registerProgressService 注入，四诊弹窗通过 registerModalOpeners 注入。
 * 因此不存在模块循环依赖，也不会把 game 内部状态暴露给别的模块。
 *
 * 会话读写规则：
 *   - 会话「状态」只有 getSession() 一个公开读取入口。它返回的是快照：
 *     每层容器都是新对象、每个数组都是新数组，外部改动不会影响内部真实会话。
 *   - getCurrentCase() 是唯一例外，它直接返回当前病例记录。病例对象来自 data.js
 *     的只读数据，game.js 从不修改它，因此没有必要（也不应该）为它建立深拷贝体系。
 *   - 写入一律走本模块导出的写入接口，外部模块不得直接修改会话字段。
 * ================================================================================== */

import { escapeHtml, escapeHtmlWithBreaks } from './html-utils.js';
import { diffMap } from './data.js';
import { evaluateAnswer, ANSWER_RESULT } from './core/answer-evaluator.js';

/* ===================== 会话阶段 ===================== */
// 判断「当前处于哪个阶段」只允许读 state.phase，
// 不要再靠 gameStarted / currentCase / lastAnswerWasCorrect 等字段组合去推测。
const PHASE = {
    IDLE: 'IDLE',           // 没有正在推演的病例
    EXPLORING: 'EXPLORING', // 正在望 / 闻 / 问 / 切、收集线索，尚未提交最终答案
    SUBMITTED: 'SUBMITTED'  // 已提交最终答案，进入正误判断 / 结果 / 解析
};

/* ===================== 唯一游戏状态 ===================== */
// 只有本模块可写。结构固定为「一层语义分组」，不再往下嵌套。
function createSession() {
    return {
        phase: PHASE.IDLE,
        case: {
            current: null,
            difficulty: null,
            index: 0
        },
        diagnosis: {
            collectedClues: [],
            exploredDiags: {},
            lastAnswerWasCorrect: null
        },
        inquiry: {
            history: [],
            askedQuestions: []
        },
        inspection: {
            images: [],
            index: 0,
            nonTongueAdded: false
        },
        progress: {
            unfinishedCases: []
        }
    };
}

// createSession() 是会话初始状态的唯一来源。
// 所有入口（选关 / 题库挑战 / 上一例 / 下一例 / 重选关卡）都从它重建会话，
// 不允许再出现「每个入口各自手工清一部分字段」的写法。
let state = createSession();

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

// 病例池来源：由 Application 注入的全量病例读取器
let caseSourceFn = null;
export function registerCaseSource(fn) { caseSourceFn = fn; }

function getAllCases() {
    if (!caseSourceFn) throw new Error('病例数据源尚未注册，无法读取病例');
    return caseSourceFn();
}

function getCasePool(diff) { return getAllCases().filter(c => c.difficulty === diff); }

/* ===================== 会话读取接口 ===================== */
// 返回会话快照。逐层复制容器与数组（记录元素也做一层浅拷贝），
// 保证外部拿到 session.inquiry.history.push(...) 之类操作改不到内部真实会话。
// 病例记录与闯关队列元素来自 data.js 的只读数据，不属于会话可变状态，不复制。
export function getSession() {
    return {
        phase: state.phase,
        case: { ...state.case },
        diagnosis: {
            collectedClues: state.diagnosis.collectedClues.map(clue => ({ ...clue })),
            exploredDiags: { ...state.diagnosis.exploredDiags },
            lastAnswerWasCorrect: state.diagnosis.lastAnswerWasCorrect
        },
        inquiry: {
            history: state.inquiry.history.map(msg => ({ ...msg })),
            askedQuestions: state.inquiry.askedQuestions.slice()
        },
        inspection: {
            images: state.inspection.images.slice(),
            index: state.inspection.index,
            nonTongueAdded: state.inspection.nonTongueAdded
        },
        progress: { unfinishedCases: state.progress.unfinishedCases.slice() }
    };
}

// 当前病例记录的具名读取入口。病例对象是 data.js 的只读数据，
// 直接返回引用即可；这样调用方不必为了拿一个病例引用而构造整个会话快照。
export function getCurrentCase() { return state.case.current; }

/* ===================== 会话写入接口 ===================== */
// 记录一条线索（去重）。返回是否真正新增。
export function addClue(type, content, tagText) {
    const tagMap = { inspection: 'tag-wang', auscultation: 'tag-wen', inquiry: 'tag-ask', pulse: 'tag-pulse' };
    const nameMap = { inspection: '望诊', auscultation: '闻诊', inquiry: '问诊', pulse: '切脉' };
    const tag = tagText || nameMap[type];
    const clues = state.diagnosis.collectedClues;
    if (clues.some(c => c.content === content && c.tag === tag)) return false;
    const wasEmpty = clues.length === 0;
    clues.push({ tag, tagClass: tagMap[type], content });
    renderClues();
    if (wasEmpty) { expandAnswerCard(); updateAnswerClosedHint(false); }
    return true;
}

// 标记某诊法已探索：更新按钮态 + 状态位
export function setExplored(type) {
    const map = { inspection: 'btnWang', auscultation: 'btnWen', inquiry: 'btnAsk', pulse: 'btnPulse' };
    state.diagnosis.exploredDiags[type] = true;
    document.getElementById(map[type])?.classList.add('explored');
}

// 记录一次追问：写入问诊历史 + 标记题目已问。
// 返回 { accepted, duplicate }，由 Inquiry 决定如何措辞回答。
export function recordInquiryTurn(question, answer, questionIndex) {
    const asked = state.inquiry.askedQuestions;
    const duplicate = asked.includes(questionIndex);
    if (!duplicate) {
        asked.push(questionIndex);
        addClue('inquiry', answer, '问诊·' + question);
    }
    return { accepted: !duplicate, duplicate };
}

export function appendInquiryMessage(role, text) { state.inquiry.history.push({ role, text }); }

export function getInquiryProgress() {
    const current = state.case.current;
    const total = current ? current.clues.inquiry.questions.length : 0;
    const askedCount = state.inquiry.askedQuestions.length;
    return { asked: askedCount, total, allAsked: total > 0 && askedCount >= total };
}

// 望诊图片浏览：列表与索引由会话持有，Inspection 通过下面的接口驱动。
// 装载新病例的图片列表时同步把浏览位置复位到第一张。
export function setInspectionImages(images) {
    state.inspection.images = images.slice();
    state.inspection.index = 0;
}
export function setInspectionIndex(i) { state.inspection.index = i; }
export function setInspectionNonTongueAdded(flag) { state.inspection.nonTongueAdded = flag; }

/* ===================== 结果模态框（通用 UI 片段） ===================== */
export function openSimpleResultModal(title, content) {
    document.getElementById('simpleResultTitle').textContent = title;
    document.getElementById('simpleResultContent').textContent = content;
    document.getElementById('simpleResultModal').style.display = 'flex';
}
export function closeSimpleResultModal() { document.getElementById('simpleResultModal').style.display = 'none'; }

/* ===================== 会话重建 ===================== */
// 用 createSession() 重建会话，只保留「不属于本病例探查结果」的部分：
// 当前病例、难度、关卡内序号、闯关队列，以及望诊图片列表与浏览位置。
// 是否重新装载望诊图片由调用方决定（切换病例要装载，重新探查不装载）。
function rebuildSessionForCurrentCase() {
    const { difficulty, index } = state.case;
    const { unfinishedCases } = state.progress;
    const { images, index: inspectionIndex } = state.inspection;
    const current = unfinishedCases[index];

    state = createSession();
    state.case = { current, difficulty, index };
    state.progress.unfinishedCases = unfinishedCases;
    state.phase = PHASE.EXPLORING;
    state.inspection.images = images;
    state.inspection.index = inspectionIndex;
    return current;
}

/* ===================== 闯关流程 ===================== */
export function startChallenge() {
    if (showPageFn) showPageFn('Game');
    resetGameUI();
}

export function resetGameUI() {
    state = createSession();
    const picker = document.getElementById('difficultyPicker');
    const ws = document.getElementById('caseWorkspace');
    if (picker) picker.style.display = 'block';
    if (ws) ws.style.display = 'none';
    document.getElementById('fourDiagBtns').style.display = 'none';
    document.getElementById('btnOtherCheck').style.display = 'none';
    document.getElementById('historyBtn').style.display = 'none';
    clearCaseWorkspaceUI();
    document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => b.classList.remove('selected'));
}

export function selectDifficulty(diff, btnEl) {
    document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => b.classList.remove('selected'));
    btnEl.classList.add('selected');
    state.case.difficulty = diff;
    const pool = getCasePool(diff);
    if (pool.length === 0) { alert('该难度暂无病例。'); return; }
    const completed = requireProgressService().getCompletedIds();
    state.progress.unfinishedCases = pool.filter(c => !completed.includes(c.id));
    if (state.progress.unfinishedCases.length === 0) {
        openSimpleResultModal('闯关完毕', '该难度下所有病例均已完成，无新病例可学习。您可以在病例题库中复习已完成的病例。');
        document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => b.classList.remove('selected'));
        state.case.difficulty = null;
        return;
    }
    state.case.index = 0;
    showCurrentCase();
}

// 从题库 / 错题进入指定病例练习。Game 提供公开入口，题库不再自行拼装会话状态。
export function startCasePractice(caseId) {
    const target = getAllCases().find(c => c.id === caseId);
    if (!target) throw new Error('病例不存在：' + caseId);
    if (showPageFn) showPageFn('Game');
    resetGameUI();
    state.case.difficulty = target.difficulty;
    document.querySelectorAll('#difficultyBtns .btn--difficulty').forEach(b => {
        b.classList.toggle('selected', b.dataset.diff === target.difficulty);
    });
    const completed = requireProgressService().getCompletedIds();
    state.progress.unfinishedCases = getAllCases()
        .filter(c => c.difficulty === target.difficulty && !completed.includes(c.id));
    if (!state.progress.unfinishedCases.some(c => c.id === caseId)) state.progress.unfinishedCases.push(target);
    state.case.index = state.progress.unfinishedCases.findIndex(c => c.id === caseId);
    if (state.case.index < 0) state.case.index = 0;
    showCurrentCase();
}

export function showCurrentCase() {
    const unfinished = state.progress.unfinishedCases;
    if (!unfinished.length) return;

    const current = rebuildSessionForCurrentCase();
    document.getElementById('chiefComplaintText').textContent = current.chiefComplaint;
    document.getElementById('historyBtn').style.display = 'inline-flex';
    document.getElementById('fourDiagBtns').style.display = 'grid';
    clearCaseWorkspaceUI();
    document.getElementById('caseTopDiffName').textContent = diffMap[state.case.difficulty]?.name || state.case.difficulty;
    document.getElementById('caseTopCounter').textContent = `${state.case.index + 1} / ${unfinished.length}`;
    document.getElementById('caseCounter').textContent = `病例 ${state.case.index + 1} / ${unfinished.length}`;
    document.getElementById('prevCaseBtn').style.display = (unfinished.length > 1 && state.case.index > 0) ? 'inline-flex' : 'none';
    document.getElementById('nextCaseBtn').style.display = (unfinished.length > 1 && state.case.index < unfinished.length - 1) ? 'inline-flex' : 'none';
    document.getElementById('btnOtherCheck').style.display = 'block';
    document.getElementById('difficultyPicker').style.display = 'none';
    document.getElementById('caseWorkspace').style.display = 'block';
    // 望诊图片列表来自病例数据自身，在进入病例时就确定下来
    setInspectionImages(current.inspectionImages || []);
    document.getElementById('chiefComplaintCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function prevCase() {
    if (state.case.index > 0) { state.case.index--; showCurrentCase(); }
}

export function nextCase() {
    if (state.case.index < state.progress.unfinishedCases.length - 1) { state.case.index++; showCurrentCase(); }
}

/* ===================== 四诊探索 ===================== */
export function exploreDiag(type) {
    // 只有 IDLE 才拦。SUBMITTED 之后仍允许继续探查与重新提交，与原实现行为一致。
    if (state.phase === PHASE.IDLE || !state.case.current) { alert('请先选择关卡。'); return; }
    if (type === 'inquiry') { modalOpeners.openInquiry?.(); return; }
    if (type === 'inspection') { modalOpeners.openInspection?.(); return; }
    if (state.diagnosis.exploredDiags[type]) { alert('该诊法已探索过。'); return; }
    setExplored(type);
    const clue = state.case.current.clues[type];
    if (clue) {
        openSimpleResultModal(clue.displayTitle, clue.displayContent);
        addClue(type, clue.textSummary);
    }
}

export function showOtherCheck() {
    if (!state.case.current) return;
    openSimpleResultModal('其他检查', state.case.current.otherCheck || '无');
}

export function showHistory() {
    if (!state.case.current) return;
    openSimpleResultModal('病史（既往史）', state.case.current.history || '无');
}

export function renderClues() {
    const area = document.getElementById('clueArea');
    area.innerHTML = state.diagnosis.collectedClues
        .map(c => `<div class="clue-item"><span class="clue-tag ${escapeHtml(c.tagClass)}">${escapeHtml(c.tag)}</span><span>${escapeHtmlWithBreaks(c.content)}</span></div>`)
        .join('');
    area.scrollTop = area.scrollHeight;
}

// 清空「当前病例」工作区的界面区域。
// 只碰 DOM，不碰会话状态——会话状态一律由 createSession() 重建。
function clearCaseWorkspaceUI() {
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
    if (state.phase === PHASE.IDLE || !state.case.current) { alert('请先选择关卡。'); return; }
    const syndrome = document.getElementById('inputSyndrome').value.trim();
    const disease = document.getElementById('inputDisease').value.trim();
    const basis = document.getElementById('inputBasis').value.trim();
    if (!syndrome && !disease) { alert('请至少输入证型或病名。'); return; }
    if (!basis) { alert('请写出你的辩证依据。'); return; }

    const currentCase = state.case.current;
    const correct = currentCase.correctAnswer;
    const verdict = evaluateAnswer(correct, { disease, syndrome, basis });
    state.diagnosis.lastAnswerWasCorrect = verdict.isCorrect;
    state.phase = PHASE.SUBMITTED;

    const progress = requireProgressService();
    let feedbackHtml;
    if (verdict.result === ANSWER_RESULT.CORRECT) {
        feedbackHtml = `<div class="result-box success"><h4>辨证正确</h4><p>${escapeHtml(correct.disease)} · ${escapeHtml(correct.syndrome)}</p>`;
        progress.removeWrong(currentCase.id);
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
        progress.saveWrong({ syndrome, disease, basis }, currentCase, state.case.difficulty);
    }
    feedbackHtml += `<button class="btn btn--outline" style="margin-top:10px;" onclick="viewAnswer()">显示答案</button></div>`;

    const fb = document.getElementById('answerFeedback');
    fb.innerHTML = feedbackHtml;
    document.getElementById('fullAnalysisArea').innerHTML = '';
    fb.scrollIntoView({ behavior: 'smooth' });
}

export function viewAnswer() {
    if (!state.case.current) return;
    showFullAnalysis(document.getElementById('fullAnalysisArea'));
    // 无论对错，做过的病例都标记为已完成，从闯关队列移除；
    // 只有从「我的错题」点击「重新挑战」才能再次进入闯关练习。
    requireProgressService().markCompleted(state.case.current.id);
}

export function showFullAnalysis(el) {
    const c = state.case.current;
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
    if (!state.case.current) return;
    if (!confirm('确定重新探查吗？线索将清除。')) return;
    // 重建会话后回到 EXPLORING。与原实现一致：重新探查不改变望诊图片列表与浏览位置。
    rebuildSessionForCurrentCase();
    clearCaseWorkspaceUI();
}

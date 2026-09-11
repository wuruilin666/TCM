/* ===================== 望诊（舌象加载 / 多图 / 预加载 / 判定） =====================
 * 职责：
 *   - 望诊弹窗的交互与图片渲染
 *   - 舌象判断流程（判定算法在 core/tongue-judge.js）
 *   - 通过 Game Session 的公开接口写回会话（线索、探索状态、图片索引）
 *
 * 会话状态一律通过 getSession() 读取（它返回快照），写入走会话的写入接口。
 * 不直接读写 game 的 state。
 * ================================================================================== */

import { getCurrentCase, addClue, setExplored, getSession,
    setInspectionIndex, setInspectionNonTongueAdded, TONGUE_CLUE_MARK } from './game.js';
import { judgeTongue, describeTongueReference, TONGUE_RESULT, TONGUE_DIM_STATUS } from './core/tongue-judge.js';
import { tongueImageTypeMap } from './data.js';

export function openInspectionModal() {
    const currentCase = getCurrentCase();
    if (!currentCase) return;

    const img = document.getElementById('inspectionImg');
    // 摘掉 src 而不是设成 ''：空 URL 会被浏览器当成一次真实请求并触发 onerror，
    // 那样「没有图片」就会被误报成「图片加载失败」。
    img.removeAttribute('src');
    img.style.display = 'none';
    document.getElementById('inspectionCounter').textContent = '图片加载中...';
    document.getElementById('tongueImageBadge').textContent = tongueImageTypeMap[currentCase.id] || '原始病例图片';
    document.getElementById('tongueJudgmentInput').value = '';

    const nonTongue = currentCase.clues.inspection.nonTongue || '';
    const nonTongueEl = document.getElementById('inspectionNonTongue');
    if (nonTongue) {
        nonTongueEl.style.display = 'block';
        nonTongueEl.textContent = '其他望诊：' + nonTongue;
        if (!getSession().inspection.nonTongueAdded) {
            setInspectionNonTongueAdded(true);
            addClue('inspection', nonTongue, '望诊·其他');
        }
    } else {
        nonTongueEl.style.display = 'none';
    }

    renderInspection();
    document.getElementById('inspectionModal').style.display = 'flex';

    img.onload = function () {
        this.style.display = 'block';
        const { images, index } = getSession().inspection;
        document.getElementById('inspectionCounter').textContent =
            images.length > 1 ? (index + 1) + ' / ' + images.length : '';
    };
    img.onerror = function () {
        // 有路径但加载失败：换占位图并明说「图片加载失败」。
        // 先摘掉 onerror，避免替换 src 时再次触发，形成死循环。
        this.onerror = null;
        this.style.display = 'block';
        this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="260" height="347" viewBox="0 0 260 347"%3E%3Crect width="260" height="347" fill="%23fdfaf5"/%3E%3Ctext x="130" y="170" font-size="14" fill="%23b5a595" text-anchor="middle"%3E图片加载失败%3C/text%3E%3C/svg%3E';
        document.getElementById('inspectionCounter').textContent = '图片加载失败';
    };
}

export function renderInspection() {
    const { images, index } = getSession().inspection;
    const img = document.getElementById('inspectionImg');
    const counter = document.getElementById('inspectionCounter');
    const hasMultiple = images.length > 1;

    if (images[index]) {
        // 先藏起来，等 onload 解码成功再显示（避免切换时闪出上一张）
        img.style.display = 'none';
        img.src = images[index];
    } else {
        // 没有可用图片路径：清掉 src 并明说「暂无舌象图片」，与「图片加载失败」是两种状态
        img.removeAttribute('src');
        img.style.display = 'none';
        counter.textContent = '暂无舌象图片';
    }

    document.getElementById('inspectPrev').style.display = hasMultiple ? 'flex' : 'none';
    document.getElementById('inspectNext').style.display = hasMultiple ? 'flex' : 'none';
    if (hasMultiple) counter.textContent = (index + 1) + ' / ' + images.length;

    preloadNextImage();
}

// 预加载下一张舌象图片
export function preloadNextImage() {
    const { images, index } = getSession().inspection;
    const nextIndex = index + 1;
    if (nextIndex < images.length) {
        const img = new Image();
        img.src = images[nextIndex];
    }
}

export function inspectPrev() {
    const { index } = getSession().inspection;
    if (index > 0) { setInspectionIndex(index - 1); renderInspection(); }
}

export function inspectNext() {
    const { images, index } = getSession().inspection;
    if (index < images.length - 1) { setInspectionIndex(index + 1); renderInspection(); }
}

export function closeInspectionModal() {
    document.getElementById('inspectionModal').style.display = 'none';
    // 关闭模态框后清空图片地址，释放内存（摘掉 src，不设成空 URL）
    document.getElementById('inspectionImg').removeAttribute('src');
}

const TONGUE_DIM_LABEL = { color: '舌色', shape: '舌形', coating: '舌苔' };

// 折叠态摘要用的总体结论（带正误符号），「正确舌象」必须直接可见，防止做完其他三诊后遗忘
const TONGUE_HEADLINE = {
    [TONGUE_RESULT.CORRECT]: '✅ 判断正确',
    [TONGUE_RESULT.PARTIAL]: '△ 部分正确',
    [TONGUE_RESULT.WRONG]: '❌ 判断有误'
};

// 逐维度反馈行。病例没提供的维度标「本病例未提供」（not_tested），与「未提及」（missing）、
// 写错的（wrong）区分开；未考查的维度不进分母。
function tongueDimensionLines(verdict) {
    return Object.entries(verdict.dimensions).map(([dim, d]) => {
        const label = TONGUE_DIM_LABEL[dim] || dim;
        if (d.status === TONGUE_DIM_STATUS.NOT_TESTED) return `${label} — 本病例未提供`;
        if (d.status === TONGUE_DIM_STATUS.MISSING) return `${label} ○ 未提及`;
        if (d.status === TONGUE_DIM_STATUS.CORRECT) return `${label} ✅`;
        return `${label} ❌ 应为「${d.expected}」`;
    });
}

// 舌象判断线索文本。摘要（分隔标记之前）= 正确舌象 + 判断正误，
// 详情 = 你的判断 → 逐维度反馈；无分隔标记（无可考维度）时整条按普通线索渲染。
function buildTongueClueText(verdict, userText, correctText) {
    if (verdict.status === TONGUE_RESULT.NOT_TESTABLE) {
        return `正确舌象：${correctText}\n本病例没有可供舌象判断的结构化考点。`;
    }
    const summary = `正确舌象：${correctText}`
        + `\n${TONGUE_HEADLINE[verdict.status] || '❌ 判断有误'}（${verdict.matched}/${verdict.total}）`;
    const detail = `你的判断：${userText}\n逐维度判断：\n${tongueDimensionLines(verdict).join('\n')}`;
    return `${summary}\n${TONGUE_CLUE_MARK}\n${detail}`;
}

export function submitTongueJudgment() {
    const currentCase = getCurrentCase();
    if (!currentCase) return;
    const userText = document.getElementById('tongueJudgmentInput').value.trim();
    if (!userText) { alert('请填写你的舌象判断。'); return; }

    const inspection = currentCase.clues.inspection;
    // 第三个参数是病例原文舌象描述：用于判断病例里的「正常」有没有原文依据
    const verdict = judgeTongue(inspection.tongueJudgment, userText, inspection.tongueDesc || '');
    const correctText = describeTongueReference(inspection);
    const clueText = buildTongueClueText(verdict, userText, correctText);

    addClue('inspection', clueText, '望诊·舌象');
    setExplored('inspection');
    closeInspectionModal();
}

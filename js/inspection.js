/* ===================== 望诊（舌象加载 / 多图 / 预加载 / 判定） =====================
 * 职责：
 *   - 望诊弹窗的交互与图片渲染
 *   - 舌象判断流程（判定算法在 core/tongue-judge.js）
 *   - 通过 Game Session 的公开接口写回会话（线索、探索状态、图片索引）
 *
 * 不直接读写 game 的 state。
 * ================================================================================== */

import { getCurrentCase, addClue, setExplored, getSession,
    setInspectionIndex, setInspectionNonTongueAdded } from './game.js';
import { judgeTongue, describeTongueReference } from './core/tongue-judge.js';
import { tongueImageTypeMap } from './data.js';

export function openInspectionModal() {
    const currentCase = getCurrentCase();
    if (!currentCase) return;

    document.getElementById('inspectionImg').src = '';
    document.getElementById('inspectionImg').style.display = 'none';
    document.getElementById('inspectionCounter').textContent = '图片加载中...';
    document.getElementById('tongueImageBadge').textContent = tongueImageTypeMap[currentCase.id] || '原始病例图片';
    document.getElementById('tongueJudgmentInput').value = '';

    const nonTongue = currentCase.clues.inspection.nonTongue || '';
    const nonTongueEl = document.getElementById('inspectionNonTongue');
    if (nonTongue) {
        nonTongueEl.style.display = 'block';
        nonTongueEl.textContent = '其他望诊：' + nonTongue;
        if (!getSession().inspectionNonTongueAdded) {
            setInspectionNonTongueAdded(true);
            addClue('inspection', nonTongue, '望诊·其他');
        }
    } else {
        nonTongueEl.style.display = 'none';
    }

    renderInspection();
    document.getElementById('inspectionModal').style.display = 'flex';

    const img = document.getElementById('inspectionImg');
    img.onload = function () {
        this.style.display = 'block';
        const images = getSession().inspectionImages;
        const index = getSession().inspectionIndex;
        document.getElementById('inspectionCounter').textContent =
            images.length > 1 ? (index + 1) + ' / ' + images.length : '';
    };
    img.onerror = function () {
        this.style.display = 'block';
        this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="260" height="347" viewBox="0 0 260 347"%3E%3Crect width="260" height="347" fill="%23fdfaf5"/%3E%3Ctext x="130" y="170" font-size="14" fill="%23b5a595" text-anchor="middle"%3E图片加载失败%3C/text%3E%3C/svg%3E';
        document.getElementById('inspectionCounter').textContent = '图片加载失败';
    };
}

export function renderInspection() {
    const { inspectionImages, inspectionIndex } = getSession();
    document.getElementById('inspectionImg').src = inspectionImages[inspectionIndex] || '';
    const hasMultiple = inspectionImages.length > 1;
    document.getElementById('inspectPrev').style.display = hasMultiple ? 'flex' : 'none';
    document.getElementById('inspectNext').style.display = hasMultiple ? 'flex' : 'none';
    document.getElementById('inspectionCounter').textContent =
        hasMultiple ? (inspectionIndex + 1) + ' / ' + inspectionImages.length : '';
    preloadNextImage();
}

// 预加载下一张舌象图片
export function preloadNextImage() {
    const { inspectionImages, inspectionIndex } = getSession();
    const nextIndex = inspectionIndex + 1;
    if (nextIndex < inspectionImages.length) {
        const img = new Image();
        img.src = inspectionImages[nextIndex];
    }
}

export function inspectPrev() {
    const { inspectionIndex } = getSession();
    if (inspectionIndex > 0) { setInspectionIndex(inspectionIndex - 1); renderInspection(); }
}

export function inspectNext() {
    const { inspectionImages, inspectionIndex } = getSession();
    if (inspectionIndex < inspectionImages.length - 1) { setInspectionIndex(inspectionIndex + 1); renderInspection(); }
}

export function closeInspectionModal() {
    document.getElementById('inspectionModal').style.display = 'none';
    // 关闭模态框后清空图片地址，释放内存
    document.getElementById('inspectionImg').src = '';
}

export function submitTongueJudgment() {
    const currentCase = getCurrentCase();
    if (!currentCase) return;
    const userText = document.getElementById('tongueJudgmentInput').value.trim();
    if (!userText) { alert('请填写你的舌象判断。'); return; }

    const inspection = currentCase.clues.inspection;
    const ok = judgeTongue(inspection.tongueJudgment || {}, userText);
    const correctText = describeTongueReference(inspection);
    const clueText = `舌象判断\n${ok ? '判断正确' : '判断有偏差'}：你的描述：${userText}\n正确答案：${correctText}`;

    addClue('inspection', clueText, '望诊·舌象');
    setExplored('inspection');
    closeInspectionModal();
}

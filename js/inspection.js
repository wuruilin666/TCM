/* ===================== 望诊（舌象加载 / 多图 / 预加载 / 判定，逻辑保持不变） ===================== */
import { state, addClue, markExplored } from './game.js';
import { tongueImages, tongueImageTypeMap } from './data.js';

export function openInspectionModal() {
    if (!state.currentCase) return;
    state.inspectionImages = state.currentCase.inspectionImages || [tongueImages[state.currentCase.id] || ''];
    state.inspectionIndex = 0;
    document.getElementById('inspectionImg').src = '';
    document.getElementById('inspectionImg').style.display = 'none';
    document.getElementById('inspectionCounter').textContent = '图片加载中...';
    document.getElementById('tongueImageBadge').textContent = tongueImageTypeMap[state.currentCase.id] || '原始病例图片';
    document.getElementById('tongueJudgmentInput').value = '';
    const nonTongue = state.currentCase.clues.inspection.nonTongue || '';
    const nonTongueEl = document.getElementById('inspectionNonTongue');
    if (nonTongue) {
        nonTongueEl.style.display = 'block';
        nonTongueEl.textContent = '其他望诊：' + nonTongue;
        if (!state.inspectionNonTongueAdded) {
            state.inspectionNonTongueAdded = true;
            addClue('inspection', nonTongue, '望诊·其他');
        }
    } else {
        nonTongueEl.style.display = 'none';
    }
    renderInspection();
    document.getElementById('inspectionModal').style.display = 'flex';
    document.getElementById('inspectionImg').onload = function() {
        this.style.display = 'block';
        document.getElementById('inspectionCounter').textContent = state.inspectionImages.length > 1 ? (state.inspectionIndex + 1) + ' / ' + state.inspectionImages.length : '';
    };
    document.getElementById('inspectionImg').onerror = function() {
        this.style.display = 'block';
        this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="260" height="347" viewBox="0 0 260 347"%3E%3Crect width="260" height="347" fill="%23fdfaf5"/%3E%3Ctext x="130" y="170" font-size="14" fill="%23b5a595" text-anchor="middle"%3E图片加载失败%3C/text%3E%3C/svg%3E';
        document.getElementById('inspectionCounter').textContent = '图片加载失败';
    };
}

export function renderInspection() {
    document.getElementById('inspectionImg').src = state.inspectionImages[state.inspectionIndex] || '';
    const hasMultiple = state.inspectionImages.length > 1;
    document.getElementById('inspectPrev').style.display = hasMultiple ? 'flex' : 'none';
    document.getElementById('inspectNext').style.display = hasMultiple ? 'flex' : 'none';
    document.getElementById('inspectionCounter').textContent = hasMultiple ? (state.inspectionIndex + 1) + ' / ' + state.inspectionImages.length : '';
    // 预加载下一张图片
    preloadNextImage();
}

// 新增函数：预加载下一张舌象图片
export function preloadNextImage() {
    const nextIndex = state.inspectionIndex + 1;
    if (nextIndex < state.inspectionImages.length) {
        const img = new Image();
        img.src = state.inspectionImages[nextIndex];
    }
}

export function inspectPrev() { if (state.inspectionIndex > 0) { state.inspectionIndex--; renderInspection(); } }
export function inspectNext() { if (state.inspectionIndex < state.inspectionImages.length - 1) { state.inspectionIndex++; renderInspection(); } }

export function closeInspectionModal() {
    document.getElementById('inspectionModal').style.display = 'none';
    // 关闭模态框后清空图片地址，释放内存
    document.getElementById('inspectionImg').src = '';
}

export function submitTongueJudgment() {
    if (!state.currentCase) return;
    const userText = document.getElementById('tongueJudgmentInput').value.trim();
    if (!userText) { alert('请填写你的舌象判断。'); return; }
    const tj = state.currentCase.clues.inspection.tongueJudgment || {};
    const ok = judgeTongueField(userText, tj);
    // 正确答案直接用病例对舌象的原始描述，不自行补充「舌形正常」等原病例未提及的内容
    const correctText = (state.currentCase.clues.inspection.tongueDesc || '').trim()
        || `舌色${tj.color || '未述'}，舌苔${tj.coating || '未述'}`;
    const clueText = `舌象判断\n${ok ? '✅' : '❌'} 你的描述：${userText}\n正确答案：${correctText}`;
    addClue('inspection', clueText, '望诊·舌象');
    state.exploredDiags.inspection = true;
    markExplored('inspection');
    closeInspectionModal();
}

function judgeTongueField(userText, tj) {
    if (!userText || !tj) return false;
    const u = userText.replace(/\s+/g, '');
    const colorOk = /正常|无异常|无明显异常|未见异常|无特殊/.test(tj.color || '') ? /正常|无异常|无明显异常|未见异常|无特殊/.test(u) : matchTerm(u, tj.color);
    const shapeOk = /正常|无异常|无明显异常|未见异常|无特殊/.test(tj.shape || '') ? /正常|无异常|无明显异常|未见异常|无特殊/.test(u) : matchTerm(u, tj.shape);
    const coatingOk = /正常|无异常|无明显异常|未见异常|无特殊/.test(tj.coating || '') ? /正常|无异常|无明显异常|未见异常|无特殊/.test(u) : matchTerm(u, tj.coating);
    return (colorOk || shapeOk || coatingOk) && (colorOk + shapeOk + coatingOk >= 2);
}

function matchTerm(u, correctVal) {
    if (!correctVal) return false;
    const strip = s => s.replace(/^舌(质|体|色|形|苔)?/, '').replace(/^苔/, '');
    const cc = strip(correctVal);
    if (!cc) return false;
    return u.includes(cc) || (cc.length >= 2 && cc.split('').some((_, i) => u.includes(cc.substr(i, 2))));
}

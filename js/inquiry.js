/* ===================== 问诊（算法与逻辑保持不变） ===================== */
import { state, addClue, markExplored } from './game.js';

/* ===================== 通用问诊同义词库 ===================== */
const TCM_SYNONYMS = {
    chillHeat: ['寒','冷','热','怕','温','烧','恶寒','畏风','发烧','寒热','身热','怕冷','喜温'],
    sweat:     ['汗','汗出','出汗','盗汗','自汗','流汗','无汗','少汗'],
    diet:      ['食','吃','饭','纳','就餐','饿','饱','饮食','饭量','吃得下','吃东西','胃口','食欲','厌油','泛恶','恶心'],
    sleep:     ['睡','眠','夜','休息','寐','夜休','睡眠','失眠','多梦','早醒'],
    stool:     ['大便','便','溏','泻','拉','屎','秘','干结','排便','腹泻','便秘','完谷','里急后重'],
    urine:     ['小便','尿','溺','尿频','尿急','尿痛','夜尿','尿色'],
    emotion:   ['情','志','绪','烦','焦虑','郁','怒','紧张','心情','易怒','喜','悲','思','惊','恐'],
    thirst:    ['渴','饮','口干','喝水','口苦','口黏','口淡','口咸'],
    pain:      ['痛','疼','胀','酸','麻','木','痹','楚','不适','难受'],
    head:      ['头','晕','眩','昏','头痛','头胀'],
    breath:    ['喘','咳','嗽','痰','胸闷','气短','气促','呼吸','息'],
    face:      ['面','色','苍白','潮红','萎黄','面色'],
    energy:    ['乏','疲','倦','力','神','累','气短','无力','精神'],
    women:     ['经','带','孕','产','月事','月经','白带','崩漏','妊娠','经期','痛经','经量']
};
const DIMENSION_VAGUE = {
    chillHeat: '（患者）冷热都还行，没特别怕冷怕热。',
    sweat:     '（患者）平时不怎么出汗，没觉得反常。',
    diet:      '（患者）吃饭倒没什么问题，胃口跟平时差不多。',
    sleep:     '（患者）睡觉还行，没什么特别。',
    stool:     '（患者）大便挺正常的，一天一次，成形。',
    urine:     '（患者）小便没什么异常。',
    emotion:   '（患者）心情还好，没啥烦心的。',
    thirst:    '（患者）不怎么口渴，喝水正常。',
    pain:      '（患者）这个倒没太注意，身上没啥明显不舒服的。',
    head:      '（患者）头不晕不痛，没什么不对劲。',
    breath:    '（患者）呼吸顺畅，没觉着胸闷气短。',
    face:      '（患者）气色看着还好。',
    energy:    '（患者）精神还行，不觉得特别累。',
    women:     '（患者）这方面没啥特别要说的。'
};
const GENERIC_VAGUE = '（患者）这个我倒没太留意，没什么不对劲的。';

// 命中关键词的得分：长词更能代表该维度，单字得分低以降低跨维度误判
function dimensionScore(text, keywords){
    let score = 0;
    for (const k of keywords){ if (text.includes(k)) score += k.length * k.length; }
    return score;
}

// 返回问题自身关键词命中的“维度集合”{ 维度: 得分 }。
// 只依据关键词（不含题目标题），避免标题里的单字（如“痰的情况”的“情”）
// 把问题误判到别的维度；复合题目（关键词跨多个维度）会同时属于多个维度。
function questionDimensionSet(qObj){
    const keywords = qObj.keywords || [];
    const set = {};
    for (const dim in TCM_SYNONYMS){
        let s = 0;
        for (const k of TCM_SYNONYMS[dim]){
            for (const kw of keywords){ if (kw.includes(k)) s += k.length * k.length; }
        }
        if (s > 0) set[dim] = s;
    }
    return set;
}

function detectInputDimensions(text){
    const dims = [];
    for (const dim in TCM_SYNONYMS){
        const s = dimensionScore(text, TCM_SYNONYMS[dim]);
        if (s > 0) dims.push({ dim, score: s });
    }
    return dims.sort((a, b) => b.score - a.score).map(d => d.dim);
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
    // 先识别用户输入属于哪些维度（按得分排序）
    const dims = detectInputDimensions(q);
    let best = -1, bestScore = 0;
    for (let i = 0; i < questions.length; i++) {
        // 用问题关键词的“维度集合”与用户输入维度做交集判定：
        // 只要两者有重叠维度即允许命中，避免把复合题目（关键词跨维度）误拒，
        // 同时仍能阻止“问小便却答大便”这类跨维度串题。
        const qDims = Object.keys(questionDimensionSet(questions[i]));
        const overlap = dims.length === 0 || qDims.some(d => dims.includes(d));
        if (!overlap) continue;
        // 在维度重叠内，用问题自身关键词与用户输入做精确命中打分
        let score = 0;
        questions[i].keywords.forEach(k => { if (q.includes(k)) score += k.length * k.length; });
        if (score > bestScore) { bestScore = score; best = i; }
    }
    let answer = '';
    if (best >= 0 && bestScore > 0) {
        answer = questions[best].a;
        if (!state.askedInquiryQuestions.includes(best)) {
            state.askedInquiryQuestions.push(best);
            addClue('inquiry', answer, '问诊·' + questions[best].q);
        } else { answer += '（这个问题刚才已经回答过了）'; }
    } else if (dims.length > 0) {
        // 识别到维度但该维度没有对应题目：返回该维度的模糊回答，绝不串到别的维度
        answer = DIMENSION_VAGUE[dims[0]] || GENERIC_VAGUE;
    } else {
        answer = GENERIC_VAGUE;
    }
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

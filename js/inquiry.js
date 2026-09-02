/* ===================== 问诊（问什么，只回答什么） ===================== */
import { state, addClue, markExplored } from './game.js';

/* ===================== 通用问诊同义词库（按维度归类） ===================== */
// 每个维度一组关键词，用于“识别用户输入属于哪个维度”。
// 注意：匹配时只认 question.dimension，不会从 answer 文本反推维度。
const TCM_SYNONYMS = {
    chillHeat:   ['寒','冷','热','怕','温','烧','恶寒','畏风','发烧','寒热','身热','怕冷','喜温','畏冷','畏寒','潮热','烘热','五心烦热','烦热','恶热'],
    sweat:       ['汗','汗出','出汗','盗汗','自汗','流汗','无汗','少汗','恶风'],
    diet:        ['食','吃','饭','纳','就餐','饿','饱','饮食','饭量','吃得下','吃东西','胃口','食欲','厌油','生冷','嗜食','辛辣','肥甘','厚腻'],
    sleep:       ['睡','眠','夜','休息','寐','夜休','睡眠','失眠','多梦','早醒','入睡','易醒','醒'],
    stool:       ['大便','便','溏','泻','拉','屎','秘','干结','排便','腹泻','便秘','完谷','里急后重'],
    urine:       ['小便','尿','溺','尿频','尿急','尿痛','夜尿','尿色'],
    emotion:     ['情','志','绪','烦','焦虑','郁','怒','紧张','心情','易怒','喜','悲','思','惊','恐','急躁','烦躁','情志','不畅'],
    thirst:      ['渴','饮','口干','喝水','口苦','口黏','口淡','口咸','咽干','口'],
    pain:        ['痛','疼','酸','麻','木','痹','楚','不适','难受','刺痛','隐痛','胀痛','牵扯','碰水'],
    head:        ['头','晕','眩','昏','头痛','头胀','颞'],
    breath:      ['喘','咳','嗽','痰','气短','气促','呼吸','息','咳痰','咯痰'],
    face:        ['面','色','苍白','潮红','萎黄','面色','黑斑'],
    energy:      ['乏','疲','倦','力','神','累','无力','精神','体倦','神疲','虚弱'],
    menstruation:['经','带','孕','产','月事','月经','白带','崩漏','妊娠','经期','痛经','经量','延后','后期'],
    women:       ['带下','孕','产','妊娠','阴道'],
    nose:        ['鼻','涕','鼻塞','流涕','喷嚏'],
    throat:      ['咽','喉','嗓','异物感','梗喉'],
    chest:       ['胸','胸闷','胸痛','心前区','胁','胸胁','两胁','放射'],
    abdomen:     ['腹','肚','肠','胃脘','腹胀','腹痛','纳差','反酸','烧心','酸','灼热','喜按','纳后'],
    vomiting:    ['呕','吐','恶心','泛恶','反胃','干呕','呃逆','嗳气','打嗝'],
    sexual:      ['性欲','性'],
    skin:        ['痒','瘙痒','皮疹','湿疮','皲裂','脱屑','红斑'],
    ear:         ['耳','鸣','耳鸣'],
    back:        ['脊背','背','后背'],
    palpitation: ['心慌','心悸','心跳'],
    seizure:     ['发作','抽搐','意识','仆倒','痰鸣','涎沫','四肢','两目','痫','昏倒','不省'],
    onset:       ['诱因','起病','起因','原因','加重','熬夜','压力','惊吓','接触'],
    frequency:   ['频率','次数','每月','每年','反复','多久','阵发性','阵作'],
    check:       ['检查','化验','实验室','血常','CT','核磁','脑电图','MRI','心电图','B超','查体'],
    treatment:   ['治疗','胃镜','西药','医院','缓解','反复','慢性胃炎','药','就诊','手术'],
    neck:        ['颈','项','僵硬'],
    limb:        ['腰','膝','肢','下肢','腰膝','酸软'],
    eye:         ['黑矇','视物','旋转','眼'],
    tongue:      ['舌肿胀','舌','舌苔'],
    oral:        ['口腔','刷牙','卫生','吸烟','口气','口臭']
};

// 综合追问 / 想一次性拿走所有信息的问法 —— 禁止返回病例全部问诊答案
const CATCH_ALL_PHRASES = [
    '所有情况','所有症状','全部告诉','都告诉我','一起告诉我','还有哪些症状','还有什么症状',
    '还有什么异常','还有什么不舒服','把问诊','问诊情况','说一下所有','全部症状','所有不舒服',
    '还有什么','还有啥','其他症状','还有什么要','还有什么想'
];
function isCatchAll(text){
    for (const p of CATCH_ALL_PHRASES) if (text.includes(p)) return true;
    if (text.includes('所有') || text.includes('全部')) return true;
    if (text.includes('还有') && (text.includes('什么') || text.includes('哪些') || text.includes('不舒服') || text.includes('症状'))) return true;
    return false;
}
const CATCH_ALL_REPLY = '（患者）你可以逐项问我，我会根据你问的情况回答。';

// 没有病例证据时，使用“中性”回答，绝不虚构“正常”。
const GENERIC_NEUTRAL = '（患者）这方面我没特别留意，没什么不对劲的。';

// 命中关键词的得分：长词更能代表该维度，单字得分低以降低跨维度误判
function dimensionScore(text, keywords){
    let score = 0;
    for (const k of keywords){ if (text.includes(k)) score += k.length * k.length; }
    return score;
}

// 识别用户输入属于哪些维度（按得分排序）
function detectInputDimensions(text){
    const dims = [];
    for (const dim in TCM_SYNONYMS){
        const s = dimensionScore(text, TCM_SYNONYMS[dim]);
        if (s > 0) dims.push({ dim, score: s });
    }
    return dims.sort((a, b) => b.score - a.score).map(d => d.dim);
}

// 核心匹配：返回最佳题目索引；-1 表示无具体题目。
// 规则（严格按维度，禁止跨维度串题）：
//   1) 直接关键词命中：仅当该题目维度与输入维度一致（或输入无维度）时才采纳，
//      防止“含大便关键词的综合题”把大便之外的信息一起泄露。
//   2) 维度命中：只匹配 dimension 与输入维度完全一致的题目。
//   3) 两者都没有 -> -1（交给中性/兜底回答）。
function matchQuestion(questions, text){
    const dims = detectInputDimensions(text);

    // 1) 直接关键词命中
    let bestK = -1, bestKScore = 0;
    for (let i = 0; i < questions.length; i++){
        const q = questions[i];
        let s = 0;
        for (const k of (q.keywords || [])) if (text.includes(k)) s += k.length * k.length;
        if (s > bestKScore){ bestKScore = s; bestK = i; }
    }
    const kDim = bestK >= 0 ? questions[bestK].dimension : null;
    const kDimOk = bestK >= 0 && (dims.length === 0 || !kDim || dims.includes(kDim));

    // 2) 维度命中（只认与输入维度一致者）
    let bestD = -1, bestDScore = 0;
    if (dims.length){
        for (let i = 0; i < questions.length; i++){
            const dim = questions[i].dimension;
            if (dim && dims.includes(dim)){
                let s = 0;
                for (const k of (TCM_SYNONYMS[dim] || [])) if (text.includes(k)) s += k.length;
                if (s > bestDScore){ bestDScore = s; bestD = i; }
            }
        }
    }

    if (bestK >= 0 && kDimOk) return bestK; // 关键词最精确且维度一致
    if (bestD >= 0) return bestD;           // 维度一致，不越界
    if (bestK >= 0) return bestK;           // 仅关键词命中（输入无维度，如“胃脘”）
    return -1;
}

// 对外解析：返回 { type:'catchall'|'match'|'neutral', index, answer }
export function resolveInquiry(questions, text){
    if (isCatchAll(text)) return { type: 'catchall', index: -1, answer: CATCH_ALL_REPLY };
    const idx = matchQuestion(questions, text);
    if (idx >= 0) return { type: 'match', index: idx, answer: questions[idx].a };
    const dims = detectInputDimensions(text);
    const answer = dims.length ? GENERIC_NEUTRAL : GENERIC_NEUTRAL;
    return { type: 'neutral', index: -1, answer };
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
    if (res.type === 'match') {
        const idx = res.index;
        if (!state.askedInquiryQuestions.includes(idx)) {
            state.askedInquiryQuestions.push(idx);
            addClue('inquiry', answer, '问诊·' + questions[idx].q);
        } else {
            answer += '（这个问题刚才已经回答过了）';
        }
    }
    // catchall / neutral 不写入线索、不计入已问，避免剧透或虚构“正常”
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

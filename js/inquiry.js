/* ===================== 问诊（问什么，只回答什么） ===================== */
import { state, addClue, markExplored } from './game.js';

/* ===================== 通用问诊同义词库（按维度归类） ===================== */
// 每个维度一组关键词，用于“识别用户输入属于哪个维度”。
// 注意：匹配时只认 question.dimension，不会从 answer 文本反推维度。
// 收紧原则：优先使用长度 >= 2 的明确词语；仅保留少量“绝不跨维度”的必要单字。
// 已剔除高危单字：情 / 口 / 夜 / 食 / 便 / 舌 / 孕 / 产 / 经 / 色 / 饮 / 力 / 神 / 木 / 性 等。
const TCM_SYNONYMS = {
    chillHeat:   ['恶寒','畏风','畏冷','畏寒','怕冷','怕风','怕热','恶热','发烧','发热','寒热','身热','喜温','喜暖','潮热','烘热','五心烦热','烦热','手足凉','发凉'],
    sweat:       ['汗出','出汗','盗汗','自汗','流汗','无汗','少汗','汗多','恶风','汗'],
    diet:        ['饮食','吃饭','食欲','胃口','纳差','纳食','饭量','吃东西','吃得下','就餐','食量','进食','饿','饱','厌油','生冷','嗜食','辛辣','肥甘','厚腻','吃'],
    sleep:       ['睡眠','睡觉','失眠','入睡','易醒','早醒','多梦','夜眠','夜休','休息','寐','睡','眠'],
    // 二便严格分开：“便”绝不能作为 stool 的单独关键词（否则“小便”会被误判为大便）。
    // 联合询问（大小便 / 二便 / 排泄情况）由 JOINT_STOOL_URINE 单独处理。
    stool:       ['大便','排便','便秘','泄泻','大便干','大便稀','便溏','排便情况','便干','干结','腹泻','拉肚','解大便','完谷','里急后重','溏','泻','屎'],
    urine:       ['小便','排尿','尿量','尿频','尿急','尿痛','夜尿','尿黄','尿色','尿','溺'],
    emotion:     ['情绪','心情','情志','急躁','烦躁','焦虑','抑郁','易怒','紧张','心烦','生气','脾气','不畅','郁','怒','烦'],
    thirst:      ['口干','口苦','口渴','咽干','喝水','饮水','口黏','口淡','口咸','想喝','渴'],
    // pain 只收“无需部位限定”的通用疼痛问法；隐痛/胀痛/刺痛 等性质词是修饰语，
    // 不足以单独判定维度（否则问“隐痛吗”会被锁在 pain 而错过 abdomen 的胃脘胀痛题）。
    // 另剔除“不适/难受”（泛化词，会把“胃脘不适”误判为 pain）与“酸软/酸”（属 limb / abdomen）。
    pain:        ['疼痛','酸痛','周身疼','浑身疼','周身','浑身','全身','麻木','牵扯','碰水','痹','麻'],
    head:        ['头痛','头晕','头胀','头昏','眩晕','昏沉','颞部','头','晕','眩'],
    breath:      ['咳嗽','咳痰','咯痰','气短','气促','呼吸','喘息','喘','咳','嗽','痰'],
    face:        ['面色','面容','苍白','潮红','萎黄','黑斑','面'],
    energy:      ['乏力','疲乏','疲倦','疲劳','无力','精神','体倦','神疲','虚弱','困倦','身困','没劲','累','乏','疲','倦'],
    // “白带”只归 women，避免问白带时命中 menstruation 的月经题。
    menstruation:['月经','经期','痛经','经量','月事','闭经','经血','来经','崩漏','延后','后期'],
    women:       ['带下','白带','阴道','妊娠','怀孕'],
    nose:        ['鼻塞','流涕','喷嚏','鼻','涕'],
    throat:      ['咽喉','嗓子','咽干','异物感','梗喉','咽','喉','嗓'],
    chest:       ['胸闷','胸痛','心前区','胸胁','两胁','放射','胸','胁'],
    abdomen:     ['胃脘','腹胀','腹痛','胃部','肚子','反酸','烧心','灼热','喜按','纳后','腹','肚','肠','胃'],
    vomiting:    ['恶心','呕吐','泛恶','反胃','干呕','呃逆','嗳气','打嗝','呕','吐'],
    sexual:      ['性欲','房事','性生活'],
    skin:        ['瘙痒','皮疹','湿疮','皲裂','脱屑','红斑','皮肤','痒'],
    ear:         ['耳鸣','耳朵','耳'],
    back:        ['脊背','后背','背部','背'],
    palpitation: ['心慌','心悸','心跳'],
    seizure:     ['发作','抽搐','意识','仆倒','痰鸣','涎沫','四肢','两目','昏倒','不省','癫痫','痫'],
    onset:       ['诱因','起病','起因','原因','加重','熬夜','压力','惊吓','接触','怎么引起','什么引起'],
    frequency:   ['频率','次数','每月','每年','多久','多长时间','阵发性','阵作','反复'],
    check:       ['检查','化验','实验室','血常规','血常','脑电图','心电图','核磁','查体','CT','MRI','B超'],
    treatment:   ['治疗','就诊','医院','胃镜','西药','吃药','服药','用药','缓解','慢性胃炎','手术','药'],
    neck:        ['颈部','脖子','僵硬','颈','项'],
    limb:        ['腰膝','酸软','下肢','四肢','腰','膝','肢'],
    eye:         ['黑矇','视物','旋转','眼睛','眼'],
    tongue:      ['舌肿胀','舌苔','舌头'],
    oral:        ['口腔','刷牙','卫生','吸烟','口气','口臭','牙']
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

// 二便联合询问：只有出现这些明确联合关键词时，才允许 stool + urine 同时回答。
// 平时“便秘吗 / 小便怎么样”等单维问法，两个维度严格分开，绝不串答。
const JOINT_STOOL_URINE = ['大小便','二便','大小便情况','二便情况','排泄情况'];
function isJointStoolUrine(text){
    return JOINT_STOOL_URINE.some(k => text.includes(k));
}

// 没有病例证据时，使用“中性”回答，绝不虚构“正常”，也不暗示“正常”。
const GENERIC_NEUTRAL = '（患者）这方面我没特别留意。';

// 二便未记录时的患者自然表达：没有记录 ≠ 正常，只用“没有特别不适”这类
// 患者口吻的模糊表达，绝不说“正常/调”，也绝不说“未记录/原病例未记载”。
// 这些句子只用于患者对话，不会进入线索（addClue），因此不参与辨证评分。
const MISSING_REPLY = {
    stool: '大便方面没有特别不适。',
    urine: '小便方面没有特别不适。'
};
const MISSING_BOTH_REPLY = '大小便方面没有明显不适。';

// 关键词权重：长度 >= 2 的词按 len*len 计分（长词优先）；
// 长度为 1 的单字只记 1 分，不足以压过任何长词，避免“口”压过“口苦”、“便”压过“大便”。
function keywordWeight(k){
    const len = (k || '').length;
    return len >= 2 ? len * len : (len === 1 ? 1 : 0);
}

// 命中关键词的得分：长词更能代表该维度，单字得分极低以降低跨维度误判
function dimensionScore(text, keywords){
    let score = 0;
    for (const k of keywords){ if (text.includes(k)) score += keywordWeight(k); }
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
// 关键：一旦识别出用户的明确问诊维度，绝不返回其它 dimension 的题目（无跨维度后门）。
function matchQuestion(questions, text){
    const dims = detectInputDimensions(text);

    // 1) 直接关键词命中
    let bestK = -1, bestKScore = 0;
    for (let i = 0; i < questions.length; i++){
        const q = questions[i];
        let s = 0;
        for (const k of (q.keywords || [])) if (text.includes(k)) s += keywordWeight(k);
        if (s > bestKScore){ bestKScore = s; bestK = i; }
    }
    const kDim = bestK >= 0 ? questions[bestK].dimension : null;
    const kDimOk = bestK >= 0 && (dims.length === 0 || !kDim || dims.includes(kDim));

    // 1b) 关键词最高分题目维度不符时，退而在“与输入维度一致”的题目里找关键词命中，
    //     仍然不越维度（例如问“大便”时不会落到 emotion / sleep 题上）。
    let bestKSameDim = -1, bestKSameDimScore = 0;
    if (dims.length){
        for (let i = 0; i < questions.length; i++){
            const dim = questions[i].dimension;
            if (!dim || !dims.includes(dim)) continue;
            let s = 0;
            for (const k of (questions[i].keywords || [])) if (text.includes(k)) s += keywordWeight(k);
            if (s > bestKSameDimScore){ bestKSameDimScore = s; bestKSameDim = i; }
        }
    }

    // 2) 维度命中（只认 dimension 与输入维度完全一致者）
    let bestD = -1, bestDScore = 0;
    if (dims.length){
        for (let i = 0; i < questions.length; i++){
            const dim = questions[i].dimension;
            if (dim && dims.includes(dim)){
                let s = 0;
                for (const k of (TCM_SYNONYMS[dim] || [])) if (text.includes(k)) s += keywordWeight(k);
                if (s > bestDScore){ bestDScore = s; bestD = i; }
            }
        }
    }

    if (bestK >= 0 && kDimOk) return bestK;              // 关键词最精确且维度一致
    if (bestKSameDim >= 0) return bestKSameDim;          // 同维度内的关键词命中
    if (bestD >= 0) return bestD;                        // 维度一致，不越界
    if (bestK >= 0 && dims.length === 0) return bestK;   // 输入无可识别维度时才允许纯关键词命中
    return -1;                                           // 已有明确维度但无对应题目 -> 中性回答
}

// 对外解析：返回 { type:'catchall'|'match'|'joint'|'neutral', index, answer }
// joint = 二便联合回答（answer 为合并后的一句话，indices 为命中的 stool/urine 题目索引）
export function resolveInquiry(questions, text){
    if (isCatchAll(text)) return { type: 'catchall', index: -1, answer: CATCH_ALL_REPLY };

    // 第一步：二便联合询问 -> 合并成一句患者回答（不拆两个标题）。
    // 资料齐全照答；只缺其一用 MISSING_REPLY 补患者口吻；两者都没记录则总述一句。
    if (isJointStoolUrine(text)){
        const pick = (dim) => {
            let best = -1, bestS = 0;
            for (let i = 0; i < questions.length; i++){
                if (questions[i].dimension !== dim) continue;
                if (best < 0) best = i;
                let s = 0;
                for (const k of (questions[i].keywords || [])) if (text.includes(k)) s += keywordWeight(k);
                if (s > bestS){ bestS = s; best = i; }
            }
            return best;
        };
        const si = pick('stool'), ui = pick('urine');
        if (si >= 0 && ui >= 0){
            const merged = questions[si].a.replace(/[。！？；]+$/, '') + '，' + questions[ui].a;
            return { type: 'joint', index: si, indices: [si, ui], answer: merged };
        }
        // 只有其一有资料：有资料的部分照答，缺的用患者口吻补一句，绝不虚构“正常”
        if (si >= 0){
            const merged = questions[si].a.replace(/[。！？；]+$/, '') + '，' + MISSING_REPLY.urine;
            return { type: 'joint', index: si, indices: [si], answer: merged };
        }
        if (ui >= 0){
            const merged = questions[ui].a.replace(/[。！？；]+$/, '') + '，' + MISSING_REPLY.stool;
            return { type: 'joint', index: ui, indices: [ui], answer: merged };
        }
        // 两个维度病例都没记录
        return { type: 'neutral', index: -1, answer: MISSING_BOTH_REPLY };
    }

    const idx = matchQuestion(questions, text);
    if (idx >= 0) return { type: 'match', index: idx, answer: questions[idx].a };
    // 二便单维问法但病例未记录该维度：患者口吻的自然表达，不虚构“正常”
    const dims = detectInputDimensions(text);
    const hasStool = dims.includes('stool'), hasUrine = dims.includes('urine');
    if (hasStool && hasUrine) return { type: 'neutral', index: -1, answer: MISSING_BOTH_REPLY };
    if (hasStool) return { type: 'neutral', index: -1, answer: MISSING_REPLY.stool };
    if (hasUrine) return { type: 'neutral', index: -1, answer: MISSING_REPLY.urine };
    // 无病例证据 ≠ 正常：统一中性回答，不虚构、不暗示正常。
    return { type: 'neutral', index: -1, answer: GENERIC_NEUTRAL };
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
    } else if (res.type === 'joint') {
        // 联合回答：只把病例中真实存在的题目记入线索与已问；
        // “XX方面没有特别不适”是患者对话补充，不进线索、不参与辨证评分。
        for (const idx of res.indices) {
            if (!state.askedInquiryQuestions.includes(idx)) {
                state.askedInquiryQuestions.push(idx);
                addClue('inquiry', questions[idx].a, '问诊·' + questions[idx].q);
            }
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

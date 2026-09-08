/* ===================== 问诊语义匹配引擎（纯逻辑，无 DOM / 无状态） =====================
 * 匹配链路（四层）：
 *   用户输入 → ① 识别大维度 dimension → ② 识别具体问诊意图 intent
 *             → ③ 只在该 intent 对应的病例问题中匹配 → ④ 返回该 question 的 answer
 *
 * 设计原则：
 *   1. 关键词只表达"这个问题本身"，不表达"这个问题所属的大类"。
 *   2. 一旦识别出具体 intent，绝不允许同维度其它 intent 的题目顶上来（禁止串题）。
 *   3. 没有病例证据时统一中性回答，绝不暗示"正常"。
 *   4. 禁止按 case.id 写特判；新增病例只要标注 intent 即自动继承本机制。
 * ================================================================================== */

/* ---------------- 文本归一化 ---------------- */
const NORM_RE = /[\s，。！？、；：""''「」『』（）()\[\]【】~\-—…·,.?!;:'"\/\\]/g;
export function normalize(text) {
    return String(text || '').toLowerCase().replace(NORM_RE, '');
}

/* ---------------- 权重：长词优先，单字几乎无权重 ---------------- */
function w(k) {
    const n = (k || '').length;
    return n >= 2 ? n * n : n;
}
function hitScore(text, words) {
    let s = 0;
    const hit = [];
    for (const k of words) if (text.includes(k)) { s += w(k); hit.push(k); }
    return { score: s, hit };
}
export function keywordScore(text, keywords) {
    return hitScore(text, keywords || []).score;
}

/* ===================== 第一层：大维度词库 ===================== */
// 只用于「兜底识别维度」与「二便缺失回答」。单字仅保留不会跨维度串题者。
export const TCM_SYNONYMS = {
    chillHeat:   ['恶寒','畏风','畏冷','畏寒','怕冷','怕风','怕热','恶热','发烧','发热','寒热','身热','喜温','喜暖','潮热','烘热','五心烦热','烦热','手足凉','发凉','肢冷','肢凉'],
    sweat:       ['汗出','出汗','盗汗','自汗','流汗','无汗','少汗','汗多','汗'],
    diet:        ['饮食','吃饭','食欲','胃口','纳差','纳呆','纳食','食纳','纳谷','饭量','吃东西','吃得下','就餐','食量','进食','饿','饱','厌油','生冷','嗜食','辛辣','肥甘','厚腻'],
    sleep:       ['睡眠','睡觉','失眠','入睡','易醒','早醒','多梦','夜眠','夜休','休息','寐','眠'],
    // 二便严格分开："便"绝不能作为 stool 的单独关键词（否则"小便"会被误判为大便）。
    stool:       ['大便','排便','便秘','泄泻','大便干','大便稀','便溏','干结','腹泻','拉肚','解大便','完谷','里急后重','溏','泻','屎'],
    urine:       ['小便','排尿','尿量','尿频','尿急','尿痛','夜尿','尿黄','尿色','尿','溺'],
    emotion:     ['情绪','心情','情志','急躁','烦躁','焦虑','抑郁','易怒','紧张','心烦','生气','脾气','不畅','郁','怒','烦'],
    thirst:      ['口干','口苦','口渴','咽干','喝水','饮水','口黏','口淡','口咸','想喝','渴'],
    // pain 只收"无需部位限定"的通用疼痛问法；性质词（隐痛/胀痛…）交给 intent 层处理。
    pain:        ['疼痛','酸痛','周身','浑身','麻木','牵扯','痹','麻'],
    // 已剔除高危单字"头"："头痛"与"头晕"必须由 intent 层严格区分。
    head:        ['头痛','头疼','头晕','头胀','头昏','眩晕','昏沉','颞部','头部'],
    breath:      ['咳嗽','干咳','咯痰','咳痰','气短','气促','呼吸','喘息','喘','咳','嗽','痰'],
    face:        ['面色','脸色','面容','苍白','潮红','萎黄','黑斑','面'],
    energy:      ['乏力','疲乏','疲倦','疲劳','无力','没劲','精神','体倦','神疲','虚弱','困倦','身困','累','乏','倦','体力','体质','素体'],
    // "白带"只归 women，避免问白带时命中 menstruation 的月经题。
    menstruation:['月经','经期','痛经','经量','月事','闭经','经血','来经','崩漏','延后','后期','经色','血块'],
    women:       ['带下','白带','阴道','妊娠','怀孕','干涩'],
    nose:        ['鼻塞','流涕','喷嚏','鼻涕','鼻','涕'],
    throat:      ['咽喉','嗓子','咽干','异物感','梗喉','咽','喉','嗓','声音'],
    chest:       ['胸闷','胸痛','心前区','胸胁','两胁','胸口','胸部','胸','胁','肋'],
    abdomen:     ['胃脘','腹胀','腹痛','胃胀','胃痛','腹部','肚子','反酸','烧心','灼热','喜按','纳后','脘腹','肠鸣','胃'],
    vomiting:    ['恶心','呕吐','泛恶','反胃','干呕','呃逆','嗳气','打嗝','呕','吐'],
    sexual:      ['性欲','房事','性生活'],
    skin:        ['瘙痒','皮疹','湿疮','皲裂','脱屑','红斑','皮肤','痒'],
    ear:         ['耳鸣','耳朵','耳'],
    back:        ['脊背','后背','背部','背'],
    palpitation: ['心慌','心悸','心跳','心脏'],
    seizure:     ['发作','抽搐','意识','仆倒','痰鸣','涎沫','四肢','两目','昏倒','不省','癫痫','痫'],
    onset:       ['诱因','起病','起因','原因','加重','熬夜','压力','惊吓','接触','怎么引起','什么引起'],
    frequency:   ['频率','次数','每月','每年','多久','多长时间','阵发性','阵作','反复'],
    check:       ['检查','化验','实验室','血常规','血常','脑电图','心电图','核磁','查体','CT','MRI','B超'],
    treatment:   ['治疗','就诊','医院','胃镜','西药','吃药','服药','用药','缓解','慢性胃炎','手术','药'],
    neck:        ['颈部','脖子','僵硬','颈','项'],
    limb:        ['腰膝','酸软','下肢','四肢','腰','膝','腿','肢'],
    eye:         ['黑矇','视物','旋转','眼睛','眼'],
    tongue:      ['舌肿胀','舌苔','舌头','舌'],
    oral:        ['口腔','刷牙','卫生','吸烟','口气','口臭','牙']
};

/* ===================== 第二层：具体问诊意图（最高优先级） ===================== */
// 命中这些意图后，只在该 intent 的病例问题中匹配，绝不退让给同维度其它 intent。
export const INTENT_RULES = [
    /* ---- head：头痛 / 头晕 / 头胀 必须严格分开 ---- */
    { id: 'head.headache',   dim: 'head', words: ['头痛','头疼','头部疼痛','头会不会痛','头会痛','头疼痛'] },
    { id: 'head.dizziness',  dim: 'head', words: ['头晕','头昏','眩晕','昏沉','晕不晕','会晕吗','晕吗'] },
    { id: 'head.distension', dim: 'head', words: ['头胀','头重','头发胀','头昏沉','头闷'] },

    /* ---- energy：体力 / 乏力 必须能听懂患者口语 ---- */
    { id: 'energy.general',  dim: 'energy', words: ['身体素质','体质怎么样','体质','体力怎么样','体力','身体怎么样','身体有力','有力气','有力吗','有没有力气','有劲','没劲','有没有劲','身体素质怎么样','素体','虚不虚','身体虚','身体状况','全身情况','全身感觉','全身怎么样'] },
    { id: 'energy.strength', dim: 'energy', words: ['有力','力气','有劲','劲','体力','身体素质','体质','身体素质怎么样'] },
    { id: 'energy.fatigue',  dim: 'energy', words: ['乏力','疲乏','疲倦','疲劳','没劲','容易累','会累','累吗','困倦','身困','神疲','没力气','没精神','疲倦吗','虚乏'] },

    /* ---- diet：食欲 ≠ 饮食偏好 ---- */
    { id: 'diet.appetite',    dim: 'diet', words: ['胃口','食欲','纳差','纳呆','纳食','食纳','纳谷','想吃东西','吃得下','不想吃','不思饮食','吃饭香','有胃口','没胃口','能吃得下','吃东西香','饮食情况','饮食怎么样','饮食如何'] },
    { id: 'diet.preference',  dim: 'diet', words: ['喜欢吃什么','喜欢吃','偏好','口味','嗜食','喜食','爱吃','辛辣','肥甘','厚腻','生冷','喝咖啡','喝茶','饮食习惯','爱吃什么'] },
    { id: 'diet.amount',      dim: 'diet', words: ['饭量','吃多少','食量','进食量','吃得多','吃得少'] },
    { id: 'diet.afterEating', dim: 'diet', words: ['饭后','餐后','吃完','食后','纳后','进食后','饭后胀'] },

    /* ---- breath：气短 / 咳 / 痰 / 喘 分开 ---- */
    { id: 'breath.shortness', dim: 'breath', words: ['气短','气促','气不够','气不足','喘不上气','喘不过气','呼吸困难','气喘','上气不接下气','气够不够','不够用','气急'] },
    { id: 'breath.cough',     dim: 'breath', words: ['咳嗽','干咳','咳不咳','咳嗽吗','咳'] },
    { id: 'breath.phlegm',    dim: 'breath', words: ['咳痰','咯痰','吐痰','有痰','痰多','痰'] },
    { id: 'breath.wheeze',    dim: 'breath', words: ['哮鸣','喘息','喘鸣','喉中哮鸣'] },

    /* ---- menstruation：末次月经 vs 周期 必须分开 ---- */
    { id: 'menstruation.lmp',        dim: 'menstruation', words: ['末次月经','上一次月经','最后一次月经','上次月经','最近一次月经','上一次来','最后一次来','上次来','末次','什么时候来的','哪天来的','哪一天来的','最近一次'] },
    { id: 'menstruation.cycle',      dim: 'menstruation', words: ['月经周期','周期多少','周期','规律吗','月经规律','经期规律','月经稀发','月经频发','延后','提前','后期'] },
    { id: 'menstruation.frequency',  dim: 'menstruation', words: ['多久来一次','几个月来一次','多久一次','多长时间来一次','月经多久'] },
    { id: 'menstruation.amount',     dim: 'menstruation', words: ['月经量','经量','量多','量少','血量','出血量','经血多','经血少','量怎么样'] },
    { id: 'menstruation.periodPain', dim: 'menstruation', words: ['痛经','经期腹痛','经行腹痛','来月经痛','经期痛'] },
    { id: 'menstruation.color',      dim: 'menstruation', words: ['经血颜色','月经颜色','经色','血色','颜色'] },
    { id: 'menstruation.clot',       dim: 'menstruation', words: ['血块','有没有血块','经块','有块'] },

    /* ---- chest / abdomen / palpitation：部位 + 性质 ---- */
    { id: 'chest.pain',       dim: 'chest', words: ['胸痛','心痛','胸口痛','心前区痛','胸部疼痛','胸疼'] },
    { id: 'chest.oppression', dim: 'chest', words: ['胸闷','胸口闷','憋闷','胸部憋闷','闷不闷','胸口'] },
    { id: 'abdomen.pain',       dim: 'abdomen', words: ['胃痛','胃脘痛','腹痛','肚子痛','上腹痛','腹部疼痛','胃部疼痛','胃疼','肚子疼'] },
    { id: 'abdomen.distension', dim: 'abdomen', words: ['腹胀','胃胀','脘腹胀','肚子胀','胀满','上腹胀','腹部胀'] },
    { id: 'abdomen.reflux',     dim: 'abdomen', words: ['反酸','烧心','灼热','泛酸','吐酸','胃酸'] },
    { id: 'palpitation.general', dim: 'palpitation', words: ['心慌','心悸','心跳','心脏不舒服','心跳快'] },

    /* ---- pain：有无疼痛 ---- */
    { id: 'pain.presence', dim: 'pain', words: ['痛吗','疼吗','痛不痛','疼不疼','会不会痛','会不会疼','有没有痛','有没有疼','还痛吗','还疼吗','会痛','会疼','痛不','疼不'] },

    /* ---- 其它常见维度 ---- */
    { id: 'thirst.general',    dim: 'thirst',    words: ['口渴','口干','想喝水','喝水吗','饮水','渴','口淡','口苦'] },
    { id: 'stool.general',     dim: 'stool',     words: ['大便','排便','便秘','腹泻','拉肚子','解大手','大便怎么样'] },
    { id: 'urine.general',     dim: 'urine',     words: ['小便','排尿','尿频','尿急','尿痛','夜尿','尿量','尿色','尿黄','尿多','尿少','小便怎么样'] },
    { id: 'sleep.general',     dim: 'sleep',     words: ['睡眠','睡觉','失眠','入睡','多梦','易醒','早醒','眠浅','睡不着'] },
    { id: 'sweat.general',     dim: 'sweat',     words: ['汗出','出汗','盗汗','自汗','汗多','汗'] },
    { id: 'emotion.general',   dim: 'emotion',   words: ['情绪','心情','情志','烦躁','焦虑','急躁','易怒','心烦','抑郁','生气','郁不郁'] },
    { id: 'chillHeat.general', dim: 'chillHeat', words: ['恶寒','畏寒','怕冷','怕风','发热','发烧','恶热','怕热','潮热','烘热','五心烦热','体温','寒热'] },
    { id: 'vomiting.belching', dim: 'vomiting',  words: ['嗳气','打嗝','呃逆'] },
    { id: 'vomiting.vomiting', dim: 'vomiting',  words: ['恶心','呕吐','干呕','反胃','想吐'] },
    { id: 'nose.general',      dim: 'nose',      words: ['鼻塞','流涕','鼻涕','喷嚏','鼻子'] },
    { id: 'throat.general',    dim: 'throat',    words: ['咽喉','嗓子','咽干','异物感','梗喉','咽部','喉咙','声音'] },
    { id: 'limb.general',      dim: 'limb',      words: ['腰膝','酸软','下肢','四肢','腰','膝','腿'] },
    { id: 'back.general',      dim: 'back',      words: ['脊背','后背','背部','背'] },
    { id: 'neck.general',      dim: 'neck',      words: ['颈部','脖子','项','僵硬'] },
    { id: 'ear.general',       dim: 'ear',       words: ['耳鸣','耳朵','听力'] },
    { id: 'eye.general',       dim: 'eye',       words: ['黑矇','视物','眼睛','眼花'] },
    { id: 'skin.itch',         dim: 'skin',      words: ['瘙痒','皮疹','皮肤','痒','湿疮'] },
    { id: 'onset.general',     dim: 'onset',     words: ['诱因','起病','起因','怎么引起','什么引起','发病','接触','受惊','惊吓'] },
    { id: 'treatment.general', dim: 'treatment', words: ['治疗','就诊','医院','胃镜','西药','吃药','服药','用药','手术','诊治经过','诊治'] },
    { id: 'check.general',     dim: 'check',     words: ['检查','化验','血常规','心电图','脑电图','核磁','MRI','CT','B超','查体'] },
    { id: 'seizure.general',   dim: 'seizure',   words: ['发作','抽搐','意识','仆倒','痰鸣','涎沫','癫痫','痫'] },
    { id: 'women.general',     dim: 'women',     words: ['带下','白带','阴道','妊娠','怀孕','干涩'] },
    { id: 'sexual.general',    dim: 'sexual',    words: ['性欲','房事','性生活'] },
    { id: 'face.general',      dim: 'face',      words: ['面色','脸色','萎黄','黑斑','潮红','苍白'] },
    { id: 'tongue.general',    dim: 'tongue',    words: ['舌肿胀','舌苔','舌头','自觉舌','其他感觉'] },
    { id: 'oral.general',      dim: 'oral',      words: ['口腔','刷牙','口臭','口气','吸烟'] }
];

/* ===================== 元问题：问的是"哪个方面" ===================== */
// 部位 / 性质 / 放射 / 时间 / 频率 / 持续 / 诱因 / 缓解 / 末次 / 量 / 色
// 这些语义模式优先于任何单字关键词。
export const ASPECT_RULES = [
    { id: 'lastTime',  words: ['上一次','上一回','最后一次','最近一次','末次','上次是','哪一天','哪天','什么时候来的','最近什么时候'] },
    { id: 'location',  words: ['哪里','哪儿','在哪','什么地方','什么部位','哪个位置','部位','位置','何处','牵涉到哪','牵连到哪','连到哪','痛连','疼连','放射到哪','放散到哪','痛到哪','疼到哪','牵扯到哪','往哪'] },
    { id: 'radiation', words: ['放射','放散','牵扯','牵涉','放射状','串到','往别处','扩散','牵连'] },
    { id: 'quality',   words: ['怎么痛','怎么个痛','怎么疼','怎样的痛','什么样的痛','什么性质','疼痛性质','性质','什么感觉','怎么个痛法','属于什么痛','什么痛','是刺痛','是胀痛','是隐痛','是绞痛','是灼痛','是酸痛','是跳痛','是钝痛','是抽痛','是闷痛','刺痛吗','胀痛吗','隐痛吗','绞痛吗','灼痛吗','酸痛吗','跳痛吗','钝痛吗','抽痛吗','闷痛吗','牵扯样'] },
    { id: 'duration',  words: ['持续多久','一次多久','每次多久','痛多久','疼多久','痛了多久','疼了多久','能持续','持续几天','疼几天','痛几天','持续多长时间','每次持续','一次持续','持续多长','痛多长时间','发作多久','持续多少'] },
    { id: 'frequency', words: ['多久一次','多长时间一次','经常吗','反复吗','会反复','多久发作','发作几次','频率','阵发','间隔多久','每隔多久','几天一次','一天几次','一日几次','发作频率','多久犯','常不常','经常发作','几次'] },
    { id: 'timing',    words: ['什么时候','何时','什么时间','一般什么时候','通常什么时候','什么时候发作','何时发作','什么时候出现','发作时间','什么时候容易','什么时候疼','什么时候痛','发作规律','什么时候开始','一般几点','发作时间点'] },
    // 说明："诱因 / 怎么引起 / 什么引起" 属 onset（起病因由），不放在 trigger
    { id: 'trigger',   words: ['什么情况下','什么情况','什么诱发','怎么诱发','加重','什么会加重','遇到什么','因为什么','吃了什么','碰了什么','饭后','餐后','吃完','进食后','纳后','活动后','运动后','劳累后','生气后','受凉'] },
    { id: 'relief',    words: ['怎么缓解','如何缓解','什么能缓解','怎么才缓解','怎样缓解','休息后','按揉','按压','热敷','好些','减轻','能好吗','会不会好'] },
    { id: 'amount',    words: ['量多','量少','多少','量大','量小','经量','用量','血量','出血量','量怎么样'] },
    { id: 'color',     words: ['什么颜色','颜色','血色','经色','深色','色暗'] }
];
// 某些 aspect 在特定维度下有专属 intent 名
const ASPECT_ALIAS = {
    lastTime: { menstruation: 'menstruation.lmp' }
};

/* ===================== 意图识别 ===================== */
export function detectIntents(rawText) {
    const t = normalize(rawText);

    // ① 具体 intent 短语
    const specific = [];
    for (const r of INTENT_RULES) {
        const h = hitScore(t, r.words);
        if (h.score > 0) specific.push({ id: r.id, dim: r.dim, score: h.score * 10, src: 'intent', hit: h.hit });
    }

    // ② 元问题 aspect
    const aspects = [];
    for (const r of ASPECT_RULES) {
        const h = hitScore(t, r.words);
        if (h.score > 0) aspects.push({ id: r.id, score: h.score * 10, hit: h.hit });
    }
    aspects.sort((a, b) => b.score - a.score);
    // "上一次 / 最后一次" 归 lastTime，不再算普通 timing
    const hasLast = aspects.some(a => a.id === 'lastTime');

    // ③ 大维度
    const dims = [];
    for (const d in TCM_SYNONYMS) {
        const h = hitScore(t, TCM_SYNONYMS[d]);
        if (h.score > 0) dims.push({ dim: d, score: h.score, hit: h.hit });
    }
    dims.sort((a, b) => b.score - a.score);

    // ④ 组合候选：aspect × 维度，以及维度兜底 general
    const composed = [];
    for (const a of aspects) {
        if (a.id === 'timing' && hasLast) continue;
        composed.push({ id: 'pain.' + a.id, score: a.score, src: 'aspect', aspect: a.id });
        for (const d of dims) {
            const alias = ASPECT_ALIAS[a.id] && ASPECT_ALIAS[a.id][d.dim];
            composed.push({ id: alias || (d.dim + '.' + a.id), score: a.score + d.score, src: 'aspect+dim', aspect: a.id, dim: d.dim });
        }
    }
    const general = dims.map(d => ({ id: d.dim + '.general', score: d.score, src: 'dim', dim: d.dim }));

    const all = specific.concat(composed, general).sort((x, y) => y.score - x.score);
    return { text: t, specific, aspects, dims: dims.map(d => d.dim), candidates: all };
}

/* ===================== 取题目的 intent 列表 ===================== */
export function questionIntents(q) {
    const raw = q && (q.intents || q.intent);
    if (!raw) return [];
    return Array.isArray(raw) ? raw.filter(Boolean) : String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

/* ===================== 核心匹配 ===================== */
// "xxx.general" 只是"大类问题"，不构成强意图（"大便怎么样"这类泛问允许在该维度内兜底）
const isGeneral = id => /\.general$/.test(id);

// 返回 { index, indices, intent, aspects, score }
// index = -1 表示病例无对应证据（交给中性回答）。
export function matchQuestion(questions, rawText) {
    const info = detectIntents(rawText);
    const t = info.text;
    const kw = questions.map(q => keywordScore(t, q.keywords || []));
    const cands = info.candidates;
    const intentsOf = questions.map(questionIntents);

    // 收集：list = 参与打分的候选意图；withDimFallback = 是否允许"维度兜底"
    const collect = (list, withDimFallback) => {
        const out = [];
        for (let i = 0; i < questions.length; i++) {
            let best = 0, why = null;
            for (const c of list) {
                if (!intentsOf[i].includes(c.id)) continue;
                const v = c.score * 1000;
                if (v > best) { best = v; why = c.id; }
            }
            if (!best && withDimFallback && questions[i].dimension && info.dims.includes(questions[i].dimension)) {
                best = 1; why = 'dim:' + questions[i].dimension;   // 泛问：该维度有记录即可答
            }
            if (!best) continue;                                   // 意图不一致的题目直接出局
            out.push({ i, intent: why, score: best + kw[i] });
        }
        return out.sort((a, b) => b.score - a.score);
    };

    const strong = cands.filter(c => !isGeneral(c.id));
    // ① 识别出具体意图（部位/性质/时间/食欲…）时，只在该意图内匹配，绝不退让给同维度其它意图
    let scored = strong.length ? collect(strong, false) : [];
    let isStrong = scored.length > 0;
    // ② 只识别出大类别（"大便怎么样""胃怎么样"）时，才允许维度内兜底
    if (!scored.length && !strong.length) scored = collect(cands, true);

    // 一句话里明确问了两件事（≥2 个元问题）时才同时回答，避免主动扩展泄露
    const multiAspect = isStrong && info.aspects.length >= 2;

    if (scored.length) {
        const indices = [];
        if (multiAspect) {
            const usedAspects = new Set();
            for (const s of scored) {
                const c = cands.find(x => x.id === s.intent);
                const a = c && c.aspect;
                if (a && usedAspects.has(a)) continue;
                if (a) usedAspects.add(a);
                indices.push(s.i);
                if (indices.length >= 3) break;
            }
        } else {
            indices.push(scored[0].i);
        }
        return {
            index: indices[0],
            indices,
            intent: scored[0].intent,
            aspects: info.aspects.map(a => a.id),
            dims: info.dims,
            score: scored[0].score,
            debug: { text: t, strong: strong.map(c => c.id), candidates: cands.slice(0, 6), scored: scored.slice(0, 6) }
        };
    }

    // 完全没有识别到任何意图：退回题目关键词匹配（兼容未覆盖问法）
    let bk = -1, bs = 0;
    for (let i = 0; i < questions.length; i++) if (kw[i] > bs) { bs = kw[i]; bk = i; }
    return {
        index: bs > 0 ? bk : -1,
        indices: bs > 0 ? [bk] : [],
        intent: null,
        aspects: info.aspects.map(a => a.id),
        dims: info.dims,
        score: bs,
        debug: { text: t, fallbackKeyword: true }
    };
}

/* ===================== 兜底话术 ===================== */
export const GENERIC_NEUTRAL = '（患者）这方面我没特别留意。';
export const MISSING_REPLY = {
    stool: '大便方面没有特别不适。',
    urine: '小便方面没有特别不适。'
};
export const MISSING_BOTH_REPLY = '大小便方面没有明显不适。';
export const CATCH_ALL_REPLY = '（患者）你可以逐项问我，我会根据你问的情况回答。';

const CATCH_ALL_PHRASES = [
    '所有情况','所有症状','全部告诉','都告诉我','一起告诉我','还有哪些症状','还有什么症状',
    '还有什么异常','还有什么不舒服','把问诊','问诊情况','说一下所有','全部症状','所有不舒服',
    '还有什么','还有啥','其他症状','还有什么要','还有什么想'
];
export function isCatchAll(rawText) {
    const t = normalize(rawText);
    for (const p of CATCH_ALL_PHRASES) if (t.includes(p)) return true;
    if (t.includes('所有') || t.includes('全部')) return true;
    if (t.includes('还有') && (t.includes('什么') || t.includes('哪些') || t.includes('不舒服') || t.includes('症状'))) return true;
    return false;
}

const JOINT_STOOL_URINE = ['大小便','二便','大小便情况','二便情况','排泄情况'];
export function isJointStoolUrine(rawText) {
    const t = normalize(rawText);
    return JOINT_STOOL_URINE.some(k => t.includes(k));
}

// 按维度取题：优先关键词，其次该维度第一题（保持二便联合问法的既有行为）
export function pickByDimension(questions, rawText, dim) {
    const t = normalize(rawText);
    let best = -1, bs = -1;
    for (let i = 0; i < questions.length; i++) {
        if (questions[i].dimension !== dim) continue;
        const s = keywordScore(t, questions[i].keywords || []);
        if (s > bs) { bs = s; best = i; }
    }
    return best;
}

/* ===================== 对外解析 ===================== */
// 返回 { type:'catchall'|'match'|'joint'|'neutral', index, indices, answer, intent, debug }
export function resolveInquiry(questions, rawText) {
    const base = { index: -1, indices: [], intent: null, aspects: [], dims: [] };

    if (isCatchAll(rawText)) return { ...base, type: 'catchall', answer: CATCH_ALL_REPLY };

    if (isJointStoolUrine(rawText)) {
        const si = pickByDimension(questions, rawText, 'stool');
        const ui = pickByDimension(questions, rawText, 'urine');
        const cut = s => s.replace(/[。！？；]+$/, '');
        if (si >= 0 && ui >= 0) {
            return { ...base, type: 'joint', index: si, indices: [si, ui], answer: cut(questions[si].a) + '，' + questions[ui].a, intent: 'stool.general+urine.general' };
        }
        if (si >= 0) return { ...base, type: 'joint', index: si, indices: [si], answer: cut(questions[si].a) + '，' + MISSING_REPLY.urine, intent: 'stool.general' };
        if (ui >= 0) return { ...base, type: 'joint', index: ui, indices: [ui], answer: cut(questions[ui].a) + '，' + MISSING_REPLY.stool, intent: 'urine.general' };
        return { ...base, type: 'neutral', answer: MISSING_BOTH_REPLY };
    }

    const m = matchQuestion(questions, rawText);
    if (m.index >= 0) {
        const answer = m.indices.map(i => questions[i].a).join('');
        return {
            ...base,
            type: 'match',
            index: m.index,
            indices: m.indices,
            intent: m.intent,
            aspects: m.aspects,
            dims: m.dims,
            answer,
            debug: m.debug
        };
    }

    const dims = m.dims && m.dims.length ? m.dims : detectIntents(rawText).dims;
    const hasStool = dims.includes('stool'), hasUrine = dims.includes('urine');
    if (hasStool && hasUrine) return { ...base, type: 'neutral', answer: MISSING_BOTH_REPLY, dims };
    if (hasStool) return { ...base, type: 'neutral', answer: MISSING_REPLY.stool, dims };
    if (hasUrine) return { ...base, type: 'neutral', answer: MISSING_REPLY.urine, dims };
    return { ...base, type: 'neutral', answer: GENERIC_NEUTRAL, dims, debug: m.debug };
}

/* ===================== 静态自检：病例标注体检 ===================== */
// 返回 { total, missingIntent, riskyKeywords, dupIntents }
export function auditQuestions(cases) {
    const RISKY = ['头','痛','身','食','纳','便','尿','经','力','胃','口','色','面','背','耳','舌','牙','药','热','汗','睡','醒','水','气'];
    const out = { total: 0, missingIntent: [], riskyKeywords: [], dupIntents: [], emptyKeywords: [] };
    for (const c of cases) {
        const qs = (c.clues && c.clues.inquiry && c.clues.inquiry.questions) || [];
        const seen = {};
        qs.forEach((q, i) => {
            out.total++;
            const tag = `${c.id}#${i}(${q.q})`;
            const intents = questionIntents(q);
            if (!intents.length) out.missingIntent.push(tag);
            if (!(q.keywords || []).length) out.emptyKeywords.push(tag);
            for (const k of (q.keywords || [])) if (k.length === 1 && RISKY.includes(k)) out.riskyKeywords.push(`${tag} -> ${k}`);
            for (const it of intents) {
                if (seen[it]) out.dupIntents.push(`${c.id}: ${it} 重复于 #${seen[it]} 与 #${i}`);
                seen[it] = i;
            }
        });
    }
    return out;
}

# -*- coding: utf-8 -*-
"""为 data/cases/*.json 的 inquiry.questions 标注 intent，并清理高风险宽关键词。

只做两件事：
  1) 写入/覆盖 question.intent（字符串或数组）
  2) 按需覆盖 question.keywords（仅替换成更精确的表达，不改任何医学内容）

question.q / question.a / answer 正文 / dimension 语义一律不改动。
"""
import json, io, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ['basic.json', 'intermediate.json', 'advanced.json']

# (case_id, question_index) -> (intent, keywords or None)
M = {
 # ---------------- basic-001 咳嗽案 ----------------
 ('basic-001', 0): ('thirst.general', ['口渴', '口干', '喝水', '想喝', '饮水', '渴']),
 ('basic-001', 1): ('stool.general', ['大便', '便秘', '干结', '排便', '几天一解']),
 ('basic-001', 2): (['sweat.general', 'chillHeat.general'], ['汗出', '出汗', '无汗', '汗多', '恶寒', '怕冷']),
 ('basic-001', 3): ('vomiting.belching', ['嗳气', '打嗝', '呃逆']),
 ('basic-001', 4): ('nose.general', ['鼻涕', '鼻塞', '流涕', '鼻子']),
 # ---------------- basic-002 胃痛案 ----------------
 ('basic-002', 0): ('abdomen.reflux', ['反酸', '烧心', '胃脘', '灼热', '泛酸', '吐酸']),
 ('basic-002', 1): (['abdomen.pain', 'abdomen.distension'], ['胃痛', '胃胀', '胃脘', '胃脘痛', '胀痛', '上腹疼痛', '胃部疼痛']),
 ('basic-002', 2): ('diet.appetite', ['饮食', '食欲', '纳食', '纳差', '胃口', '吃得下', '纳谷']),
 ('basic-002', 3): ('thirst.general', ['口干', '口苦', '口渴', '咽干']),
 ('basic-002', 4): ('head.headache', ['头痛', '头疼', '头部疼痛']),
 ('basic-002', 5): ('emotion.general', None),
 # ---------------- basic-003 月经后期案 ----------------
 ('basic-003', 0): (['menstruation.cycle', 'menstruation.general'], ['月经', '延后', '后期', '经期', '周期', '月经推迟']),
 ('basic-003', 1): ('emotion.general', None),
 ('basic-003', 2): (['chest.pain', 'chest.distension', 'chest.oppression', 'pain.location'], ['胸胁', '两胁', '胁肋', '胁痛', '胸胁胀痛']),
 ('basic-003', 3): ('back.general', ['脊背', '后背', '背部']),
 ('basic-003', 4): ('abdomen.distension', ['腹胀', '肚子胀', '腹部胀', '脘腹']),
 ('basic-003', 5): ('stool.general', ['便秘', '大便', '排便', '干结']),
 ('basic-003', 6): ('diet.appetite', ['饮食', '食欲', '胃口', '纳食', '纳谷', '纳差']),
 ('basic-003', 7): ('sleep.general', ['睡眠', '入睡', '寐', '眠', '睡觉']),
 # ---------------- basic-004 不寐案 ----------------
 ('basic-004', 0): ('sleep.general', ['失眠', '入睡', '眠浅', '多梦', '易醒', '睡眠', '睡觉', '睡不着']),
 ('basic-004', 1): ('ear.general', ['耳鸣', '耳朵']),
 ('basic-004', 2): ('chest.oppression', ['胸闷', '胸口', '胸部', '憋闷']),
 ('basic-004', 3): ('diet.appetite', ['饮食', '食欲', '胃口', '纳食', '纳谷']),
 ('basic-004', 4): ('stool.general', ['大便', '排便', '便秘']),
 ('basic-004', 5): ('urine.general', ['小便', '排尿', '尿量', '尿频', '尿急', '夜尿', '尿黄']),
 # ---------------- inter-001 肺痈案 ----------------
 ('inter-001', 0): ('chillHeat.general', ['发热', '低热', '体温', '发烧', '身热']),
 ('inter-001', 1): (['breath.phlegm', 'breath.cough'], ['痰', '咯痰', '带血', '咳痰', '痰中带血']),
 ('inter-001', 2): (['sweat.general', 'chillHeat.general'], ['汗出', '出汗', '恶风', '恶热', '无汗', '汗多']),
 ('inter-001', 3): ('stool.general', ['大便', '溏', '软', '腹泻', '排便']),
 ('inter-001', 4): (['energy.fatigue', 'energy.general', 'energy.strength'], ['乏力', '疲乏', '累', '体重', '消瘦', '有力', '力气', '没劲', '体力', '虚弱', '精神']),
 ('inter-001', 5): ('throat.general', ['声音', '沙哑', '嗓子', '发声']),
 # ---------------- inter-002 哮病案 ----------------
 ('inter-002', 0): (['breath.cough', 'breath.general'], ['咳嗽', '干咳', '夜咳', '呼吸', '急促', '咳']),
 ('inter-002', 1): ('vomiting.vomiting', ['呕吐', '呕', '恶心', '吐']),
 ('inter-002', 2): ('breath.phlegm', ['痰', '有痰', '无痰', '咳痰', '咯痰']),
 ('inter-002', 3): ('nose.general', ['鼻涕', '鼻塞', '流涕', '喷嚏', '鼻子']),
 ('inter-002', 4): ('abdomen.pain', ['肚子', '腹痛', '腹部疼痛', '肠']),
 ('inter-002', 5): ('stool.general', ['大便', '排便', '臭', '臭秽']),
 ('inter-002', 6): ('sweat.general', ['出汗', '汗出', '汗少']),
 ('inter-002', 7): ('oral.general', ['口臭', '口气', '口腔']),
 # ---------------- inter-003 感冒案 ----------------
 ('inter-003', 0): ('chillHeat.general', ['发热', '体温', '发烧']),
 ('inter-003', 1): ('sweat.general', ['出汗', '汗出', '汗多', '无汗']),
 ('inter-003', 2): ('thirst.general', ['口渴', '口干', '喝水', '喜饮', '饮水']),
 ('inter-003', 3): (['head.headache', 'pain.location'], ['头痛', '头疼', '头部疼痛']),
 ('inter-003', 4): (['energy.fatigue', 'energy.general', 'energy.strength'], ['困重', '无力', '乏力', '累', '疲倦', '身困', '有力', '力气', '没劲', '体力']),
 ('inter-003', 5): ('diet.appetite', ['纳呆', '纳食', '食欲', '胃口', '纳差', '吃得下', '不想吃']),
 ('inter-003', 6): ('vomiting.belching', ['嗳气', '打嗝', '呃逆']),
 ('inter-003', 7): ('abdomen.reflux', ['胃灼热', '烧心', '灼热', '胃部灼热', '反酸']),
 ('inter-003', 8): ('stool.general', ['大便', '溏', '腹泻', '便溏', '排便']),
 ('inter-003', 9): ('urine.general', ['小便', '尿黄', '尿色', '排尿', '尿量']),
 ('inter-003', 10): ('check.general', ['实验室', '白细胞', '淋巴细胞', '中性粒', '检查', '化验']),
 # ---------------- inter-004 胃脘痛案 ----------------
 ('inter-004', 0): (['abdomen.pain', 'abdomen.distension', 'pain.quality', 'pain.timing', 'pain.trigger', 'diet.afterEating'], ['胃脘', '胃胀', '腹胀', '胀满', '疼痛', '胀痛', '隐痛', '进食', '纳后', '饭后', '餐后']),
 ('inter-004', 1): (['pain.radiation', 'pain.location'], ['胁', '两胁', '胸胁', '放射', '牵涉', '痛连', '疼连', '连到']),
 ('inter-004', 2): (['pain.trigger', 'emotion.general'], ['情绪', '波动', '烦躁', '焦虑', '生气', '心情']),
 ('inter-004', 3): ('diet.appetite', ['纳差', '纳食', '食欲', '胃口', '纳谷', '吃得下']),
 ('inter-004', 4): ('onset.general', ['诱因', '起病', '熬夜', '压力', '原因', '加重', '惊吓', '怎么引起']),
 ('inter-004', 5): (['vomiting.belching', 'abdomen.reflux'], ['嗳气', '反酸', '打嗝', '呃逆']),
 ('inter-004', 6): ('stool.general', ['大便', '溏', '次数', '腹泻', '日行', '排便']),
 ('inter-004', 7): ('diet.appetite', ['食欲', '食纳', '纳食', '纳差', '胃口', '想吃东西']),
 ('inter-004', 8): (['energy.fatigue', 'energy.general', 'energy.strength'], ['乏力', '神疲', '精神', '体力', '累', '疲倦', '有力', '力气', '没劲']),
 ('inter-004', 9): ('treatment.general', None),
 # ---------------- inter-005 痫病案 ----------------
 ('inter-005', 0): ('seizure.general', None),
 ('inter-005', 1): (['head.headache', 'head.distension'], ['头痛', '头疼', '头部疼痛', '头胀', '发作前']),
 ('inter-005', 2): ('chest.oppression', ['胸闷', '胸口', '胸部', '发作前', '前兆']),
 ('inter-005', 3): (['seizure.frequency', 'pain.frequency'], ['频率', '次数', '每月', '每年', '反复', '发作频率', '多久一次']),
 ('inter-005', 4): ('onset.general', ['诱因', '惊吓', '起因', '原因', '受惊']),
 ('inter-005', 5): ('emotion.general', None),
 ('inter-005', 6): ('thirst.general', ['口苦', '咽干', '口干', '口渴']),
 ('inter-005', 7): ('diet.appetite', ['纳差', '纳食', '食欲', '胃口', '纳谷']),
 ('inter-005', 8): ('stool.general', ['大便', '便秘', '排便', '大便干', '干结']),
 ('inter-005', 9): ('urine.general', ['小便', '尿黄', '尿色', '排尿', '尿量']),
 ('inter-005', 10): ('sleep.general', ['夜眠', '睡眠', '眠', '入睡', '寐', '睡觉']),
 ('inter-005', 11): ('check.general', ['检查', '脑电图', 'MRI', '查体', '神经', '头部', '核磁']),
 # ---------------- inter-006 湿疮案 ----------------
 ('inter-006', 0): ('onset.general', ['起病', '诱因', '接触', '水泥', '反复', '原因']),
 ('inter-006', 1): ('skin.itch', ['痒', '瘙痒', '皮疹', '皮肤痒']),
 ('inter-006', 2): (['pain.presence', 'pain.trigger'], ['疼痛', '碰水', '沾水', '疼痛明显', '疼']),
 ('inter-006', 3): ('emotion.general', ['情绪', '急躁', '烦躁', '心情']),
 ('inter-006', 4): ('sleep.general', ['睡眠', '入睡', '失眠', '易醒', '眠', '睡觉']),
 ('inter-006', 5): ('diet.appetite', ['饮食', '食欲', '纳食', '胃口']),
 ('inter-006', 6): ('stool.general', ['大便', '排便']),
 ('inter-006', 7): ('urine.general', ['小便', '排尿', '尿量', '尿色']),
 ('inter-006', 8): ('treatment.general', ['治疗', '医院', '用药', '吃药', '抗组胺', '卤米松', '尿素', '维A酸', '水杨酸', '高锰酸钾', '诊治', '检查']),
 # ---------------- inter-007 心悸案 ----------------
 ('inter-007', 0): (['palpitation.general', 'pain.trigger', 'pain.duration', 'pain.relief'], ['心慌', '心悸', '心跳', '活动', '休息', '缓解', '持续']),
 ('inter-007', 1): ('breath.shortness', ['气短', '气促', '喘', '气不够', '气不足', '喘不上气', '呼吸困难']),
 ('inter-007', 2): (['energy.fatigue', 'energy.general', 'energy.strength'], ['乏力', '神疲', '精神', '累', '疲倦', '有力', '力气', '没劲', '体力', '虚弱']),
 ('inter-007', 3): ('head.dizziness', ['头晕', '眩', '昏', '头昏', '眩晕']),
 ('inter-007', 4): ('ear.general', ['耳鸣', '耳朵']),
 ('inter-007', 5): ('chillHeat.general', ['五心烦热', '烦热', '手心', '脚心', '手足心热']),
 ('inter-007', 6): ('limb.general', ['腰膝', '酸软', '腰', '膝', '下肢']),
 ('inter-007', 7): ('sleep.general', ['夜休', '睡眠', '失眠', '寐', '睡觉']),
 ('inter-007', 8): ('urine.general', ['小便', '尿黄', '尿色', '排尿', '尿量']),
 ('inter-007', 9): ('stool.general', ['大便', '便秘', '排便', '大便干', '干结']),
 ('inter-007', 10): ('check.general', None),
 # ---------------- inter-008 头痛案 ----------------
 ('inter-008', 0): (['pain.location', 'pain.radiation'], ['头痛', '疼痛', '颞部', '右侧', '位置', '部位', '哪里', '哪儿', '放射', '牵涉', '牵扯', '疼']),
 ('inter-008', 1): (['pain.quality', 'pain.frequency', 'pain.timing', 'pain.duration'], ['牵扯样', '怎么痛', '什么性质', '疼痛性质', '反复', '发作', '每次持续', '持续数日', '疼痛感觉', '性质']),
 ('inter-008', 2): ('neck.general', ['颈', '项', '僵硬', '脖子']),
 ('inter-008', 3): (['pain.presence', 'pain.general'], ['周身', '浑身', '全身', '周身疼痛', '全身疼痛', '酸痛']),
 ('inter-008', 4): ('thirst.general', ['口苦', '口干', '口渴', '口中']),
 ('inter-008', 5): ('emotion.general', ['情绪', '烦躁', '心情', '烦', '心烦']),
 ('inter-008', 6): ('diet.appetite', ['饮食', '食欲', '胃口', '纳食', '纳谷']),
 ('inter-008', 7): ('sleep.general', ['睡眠', '眠', '寐', '入睡', '睡觉']),
 ('inter-008', 8): ('stool.general', ['大便', '排便']),
 ('inter-008', 9): ('urine.general', ['小便', '排尿', '尿量', '尿色']),
 # ---------------- adv-001 胃脘痛/便秘案 ----------------
 ('adv-001', 0): (['abdomen.pain', 'abdomen.distension', 'pain.quality', 'pain.timing', 'pain.relief'], ['胃胀', '胃痛', '隐痛', '喜按', '夜间', '纳后', '饭后', '腹胀', '胃脘', '疼痛', '胀满']),
 ('adv-001', 1): ('thirst.general', ['口干', '口渴', '饮水', '渴', '喝水']),
 ('adv-001', 2): ('sleep.general', ['寐', '多梦', '睡眠', '入睡', '做梦']),
 ('adv-001', 3): ('stool.general', ['大便', '便秘', '排便', '通便', '大黄', '费力', '几天一行', '排便费力']),
 ('adv-001', 4): (['diet.appetite', 'diet.preference'], ['饮食', '生冷', '纳差', '嗜食', '辛辣', '饮食不节', '胃口', '食欲', '纳食']),
 ('adv-001', 5): ('emotion.general', ['情绪', '情志', '烦躁', '不畅', '心情']),
 ('adv-001', 6): (['energy.fatigue', 'energy.general', 'energy.strength'], ['乏力', '虚弱', '神疲', '精神', '累', '素体', '体质', '体力', '有力', '力气', '没劲', '疲倦']),
 ('adv-001', 7): ('face.general', ['面色', '萎黄', '黑斑', '脸色']),
 # ---------------- adv-002 真心痛案 ----------------
 ('adv-002', 0): (['chest.pain', 'chest.oppression', 'pain.location', 'pain.trigger'], ['胸痛', '胸闷', '胸口', '胸部', '心前区', '疼痛', '活动后', '加重']),
 ('adv-002', 1): ('sweat.general', ['汗出', '出汗', '无汗', '汗多']),
 ('adv-002', 2): ('emotion.general', ['烦躁', '不安', '烦', '心情', '情绪']),
 ('adv-002', 3): ('palpitation.general', ['心慌', '心悸', '心跳']),
 ('adv-002', 4): ('head.dizziness', ['头晕', '眩', '昏', '头昏', '眩晕']),
 ('adv-002', 5): ('breath.cough', ['咳嗽', '咳痰', '痰', '嗽']),
 ('adv-002', 6): ('breath.shortness', ['气短', '气促', '呼吸', '喘', '气不够', '气不足', '活动']),
 ('adv-002', 7): (['energy.fatigue', 'energy.general', 'energy.strength'], ['乏力', '神疲', '精神', '累', '疲倦', '有力', '力气', '没劲', '体力']),
 ('adv-002', 8): ('diet.appetite', ['食纳', '纳差', '食欲', '纳食', '胃口', '吃得下']),
 ('adv-002', 9): ('sleep.general', ['夜休', '睡眠', '失眠', '寐', '睡觉']),
 ('adv-002', 10): ('urine.general', ['小便', '量多', '排尿', '尿量', '尿多']),
 ('adv-002', 11): ('stool.general', ['大便', '干结', '便秘', '排便']),
 ('adv-002', 12): ('check.general', None),
 # ---------------- adv-003 胸痹案 ----------------
 ('adv-003', 0): (['chest.oppression', 'pain.timing', 'pain.frequency', 'pain.duration', 'pain.relief'], ['胸闷', '胸口', '胸部', '发作', '持续', '缓解', '憋闷']),
 ('adv-003', 1): ('breath.shortness', ['气短', '气促', '喘', '气不够', '气不足', '呼吸困难']),
 ('adv-003', 2): ('head.dizziness', ['头晕', '眩', '昏', '头昏', '眩晕']),
 ('adv-003', 3): ('palpitation.general', ['心慌', '心悸', '心跳']),
 ('adv-003', 4): (['chest.pain', 'pain.radiation'], ['胸痛', '放射', '放射痛', '心痛', '牵涉']),
 ('adv-003', 5): ('eye.general', ['黑矇', '视物', '旋转', '眼睛', '眼']),
 ('adv-003', 6): ('vomiting.vomiting', ['恶心', '呕吐', '反胃', '吐', '干呕']),
 ('adv-003', 7): ('abdomen.reflux', ['反酸', '烧心', '灼热', '泛酸']),
 ('adv-003', 8): ('chillHeat.general', ['畏寒', '怕冷', '四肢', '凉', '肢冷', '肢凉', '手脚凉']),
 ('adv-003', 9): ('diet.appetite', ['食纳', '食欲', '纳食', '胃口', '吃得下']),
 ('adv-003', 10): ('sleep.general', ['夜休', '睡眠', '失眠', '寐', '睡觉']),
 ('adv-003', 11): ('stool.general', ['大便', '排便']),
 ('adv-003', 12): ('urine.general', ['小便', '排尿', '尿量', '尿色']),
 ('adv-003', 13): ('check.general', None),
 # ---------------- adv-004 心悸案 ----------------
 ('adv-004', 0): (['palpitation.general', 'palpitation.timing'], ['心悸', '心慌', '心跳', '跳得快', '心脏不舒服', '夜间']),
 ('adv-004', 1): ('palpitation.timing', ['什么时候发作', '何时发作', '发作时间', '规律', '晨起', '早晨', '什么时候', '发作规律']),
 ('adv-004', 2): (['chest.oppression', 'chest.pain'], ['胸闷', '胸痛', '胸口', '胸部', '胸前']),
 ('adv-004', 3): ('emotion.general', ['焦虑', '烦躁', '烦', '心情', '情绪']),
 ('adv-004', 4): (['chillHeat.general', 'chillHeat.timing'], ['潮热', '五心烦热', '烦热', '午后', '发热', '怕热', '烘热']),
 ('adv-004', 5): ('sweat.general', ['汗出', '出汗', '无汗', '汗多']),
 ('adv-004', 6): ('thirst.general', ['口干', '口渴', '渴', '喝水']),
 ('adv-004', 7): (['energy.fatigue', 'energy.general', 'energy.strength'], ['乏力', '神疲', '精神', '累', '疲倦', '有力', '力气', '没劲', '体力']),
 ('adv-004', 8): ('diet.appetite', ['食欲', '胃口', '纳食', '食纳', '纳谷', '吃得下']),
 ('adv-004', 9): ('sleep.general', ['睡眠', '寐', '入睡', '易醒', '眠', '转醒', '睡觉']),
 ('adv-004', 10): ('stool.general', ['大便', '排便']),
 ('adv-004', 11): ('urine.general', ['小便', '排尿', '尿量', '尿色']),
 ('adv-004', 12): ('tongue.general', ['舌肿胀', '舌头', '舌苔', '自觉舌', '舌头发胀']),
 # ---------------- adv-005 黑毛舌案 ----------------
 ('adv-005', 0): ('thirst.general', ['口渴', '口干', '渴', '喝水']),
 ('adv-005', 1): ('stool.general', ['大便', '腹泻', '拉肚子', '溏', '排便']),
 ('adv-005', 2): ('oral.general', ['口腔', '刷牙', '卫生', '吸烟']),
 ('adv-005', 3): ('diet.preference', ['咖啡', '茶', '巧克力', '深色', '饮料', '饮食', '喝什么']),
 # ---------------- adv-006 顽固性嗳气案 ----------------
 ('adv-006', 0): ('diet.preference', ['饮食', '辛辣', '肥甘', '厚腻', '喜欢吃什么', '口味', '偏好', '嗜食', '喜食']),
 ('adv-006', 1): ('diet.appetite', ['食欲', '食纳', '胃口', '纳食', '想吃东西', '吃得下', '纳差']),
 ('adv-006', 2): ('sleep.general', ['睡眠', '失眠', '寐', '睡觉']),
 ('adv-006', 3): ('stool.general', ['大便', '黏', '马桶', '排便']),
 ('adv-006', 4): ('chest.oppression', ['胸闷', '胸口闷', '胸部憋闷', '胸口']),
 ('adv-006', 5): ('breath.phlegm', ['咳痰', '吐痰', '痰', '咯痰', '有痰']),
 ('adv-006', 6): ('throat.general', ['咽部异物感', '喉咙异物感', '咽中有物', '梅核气', '异物感', '梗喉', '咽部']),
 ('adv-006', 7): ('abdomen.distension', ['腹胀', '上腹胀', '胃胀', '胀满', '腹部胀', '肚子胀']),
 ('adv-006', 8): ('abdomen.reflux', ['反酸', '烧心', '呃逆', '泛酸']),
 ('adv-006', 9): ('onset.general', None),
 # ---------------- adv-007 绝经前后诸症案 ----------------
 ('adv-007', 0): ('chillHeat.general', ['烘热', '潮热', '一阵阵热', '发热', '怕热', '烘热汗出']),
 ('adv-007', 1): ('sweat.general', ['汗出', '出汗', '无汗', '汗多']),
 ('adv-007', 2): ('women.general', ['阴道', '干涩', '痒', '白带', '带下']),
 ('adv-007', 3): ('sexual.general', ['性欲', '性生活', '房事']),
 ('adv-007', 4): ('limb.general', ['下肢', '冷', '肢凉', '腿', '脚']),
 ('adv-007', 5): ('thirst.general', ['口淡', '口苦', '口干', '口中', '口渴']),
 ('adv-007', 6): ('sleep.general', ['失眠', '睡眠', '入睡', '寐', '睡觉']),
 ('adv-007', 7): ('stool.general', ['大便', '排便']),
 ('adv-007', 8): ('urine.general', ['小便', '排尿', '尿量', '尿色']),
 ('adv-007', 9): (['menstruation.cycle', 'menstruation.frequency'], ['月经周期', '周期', '多久一次', '几天一次', '几个月一次', '规律吗', '月经稀发', '月经']),
 ('adv-007', 10): ('menstruation.amount', ['月经量', '量多', '量少', '多少', '经量', '血量']),
 ('adv-007', 11): ('menstruation.lmp', ['末次月经', '上一次月经', '最后一次月经', '什么时候来的', '哪天来的', '上一次', '最后一次', '最近一次', '末次', '上一次来', '最后一次来']),
 ('adv-007', 12): (['menstruation.color', 'menstruation.clot'], ['经血颜色', '颜色', '血色', '血块', '有没有血块', '经色']),
}


def main():
    total_q = 0
    touched_intent = 0
    touched_kw = 0
    for fn in FILES:
        path = os.path.join(BASE, 'data', 'cases', fn)
        with io.open(path, encoding='utf-8') as f:
            data = json.load(f)
        for case in data['cases']:
            qs = case.get('clues', {}).get('inquiry', {}).get('questions', [])
            for i, q in enumerate(qs):
                total_q += 1
                key = (case['id'], i)
                if key not in M:
                    continue
                intent, kw = M[key]
                q['intent'] = intent
                touched_intent += 1
                if kw is not None:
                    q['keywords'] = kw
                    touched_kw += 1
        with io.open(path, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
    print('questions total : %d' % total_q)
    print('intent written  : %d' % touched_intent)
    print('keywords fixed  : %d' % touched_kw)
    missing = total_q - touched_intent
    print('intent missing  : %d' % missing)


if __name__ == '__main__':
    main()

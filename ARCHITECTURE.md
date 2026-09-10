# TCM 项目架构说明

> 本文件描述项目当前真实架构、模块职责、依赖方向与长期维护规则。
>
> 任何 AI 在修改代码前，必须先阅读本文件。
>
> 本文件优先描述“现在真实存在的架构”，不为了未来功能创建不存在的模块或虚假的接口。

---

# 1. 项目目标

本项目是一个基于浏览器的中医辨证互动学习网站。

核心玩法：

```text
病例主诉
  ↓
用户主动进行望 / 闻 / 问 / 切
  ↓
收集线索
  ↓
形成辨证依据
  ↓
提交病名 / 证型
  ↓
查看评价与完整医案解析
```

项目当前采用：

- 原生 HTML
- 原生 CSS
- 原生 ES Module
- 静态 JSON 病例数据
- 浏览器端运行
- Cloudflare Pages 部署

病例内容继续以静态 JSON 为主，病例图片继续存放于仓库。

---

# 2. 核心架构原则

项目必须长期保持：

```text
高内聚
低耦合
单一职责
明确边界
稳定接口
可预测调用
最小必要复杂度
```

核心目标不是“任何情况下都不报错”，而是：

> 当一个功能出现问题时，可以通过模块职责快速定位问题来源。

---

# 3. 分层模型

项目采用轻量级分层，不引入没有实际需求的复杂架构模式。

总体依赖方向：

```text
UI
 ↓
Application
 ↓
Domain

Application
 ↓
Infrastructure
```

禁止反向依赖。

即：

```text
Domain
× → UI
× → Storage
× → Browser API

UI
× → 直接修改 Domain 内部状态

Domain
× → 直接读写 localStorage / D1 / fetch
```

---

# 4. 当前模块职责

## 4.1 Application Entry

### `js/app.js`

职责：

- 应用初始化
- 页面装配
- 全局导航
- 模块之间的组装
- 全局事件入口
- 页面级 UI 结构

不负责：

- 病例规则
- 问诊匹配算法
- 具体存储实现
- 备份编码实现
- 业务数据的底层读写

`app.js` 是“装配层”，而不是万能业务模块。

原则：

> app.js 可以知道模块，但模块不应该依赖 app.js 的内部实现。

---

# 5. Domain / Core

Domain 层只包含与业务规则本身有关的逻辑。

Domain 必须尽量保持纯逻辑。

禁止：

```text
DOM
window
document
alert
localStorage
fetch
D1
页面跳转
```

---

## 5.1 病例数据规则

当前病例数据相关职责由 `data.js` 承担。

长期目标：

病例定义、病例校验、病例加载等职责应逐步清晰分离。

但禁止为了“结构好看”而机械拆文件。

只有职责真正不同且产生实际维护价值时才拆分。

---

## 5.2 问诊匹配

### `js/inquiry-matcher.js`

职责：

```text
用户自然语言
 ↓
意图识别
 ↓
维度识别
 ↓
匹配病例问诊问题
 ↓
返回匹配结果
```

必须保持：

```text
纯逻辑
无 DOM
无游戏状态
无 Storage
```

该模块不负责：

- 打开问诊弹窗
- 修改页面
- 保存学习记录
- 修改 localStorage

---

## 5.3 答案判定

答案判定逻辑应逐步从游戏流程中独立出来。

职责：

```text
病例正确答案
+
用户答案
 ↓
判定结果
```

返回明确结果。

不负责：

- 渲染结果
- 保存错题
- 弹窗
- 页面跳转

---

# 6. Application / Game

## `js/game.js`

当前负责：

- 当前游戏流程
- 当前病例
- 当前难度
- 当前游戏状态
- 用户探索流程
- 线索收集流程
- 游戏完成流程

长期维护方向：

应避免继续向 `game.js` 增加：

- 大量 UI HTML
- 存储底层实现
- 备份功能
- 问诊匹配算法
- 账号逻辑

如果某种职责明显独立，应优先提取到对应模块。

---

# 7. Inquiry / Inspection

## `js/inquiry.js`

职责：

```text
问诊 UI
+
问诊交互流程
+
调用 inquiry-matcher
+
将结果交给游戏会话
```

不负责定义匹配算法。

---

## `js/inspection.js`

职责：

```text
望诊 UI
+
舌象交互
+
图片展示
+
舌象判断流程
```

不负责整个游戏流程。

---

# 8. Case Bank

## `js/case-bank.js`

负责：

- 病例题库展示
- 分类筛选
- 难度筛选
- 搜索
- 病例列表交互
- 错题入口
- 病例详情展示入口

长期维护时应避免它直接承担：

- 游戏内部状态定义
- Storage 底层实现
- 问诊匹配
- 答案判定算法

Case Bank 可以调用 Application 层完成“挑战病例”之类操作，但不应直接修改其他模块内部状态。

---

# 9. Infrastructure

Infrastructure 负责“数据从哪里来、存到哪里去”。

这里允许使用：

```text
fetch
localStorage
File API
CompressionStream
DecompressionStream
crypto
D1 API
Cloudflare Worker
```

但业务模块不应依赖这些底层实现。

---

# 10. Progress Storage

未来学习进度建议遵循：

```text
Game
 ↓
Progress Service
 ↓
Progress Repository
 ↓
LocalStorage / D1
```

业务代码不应该直接：

```js
localStorage.setItem(...)
```

也不应该直接：

```js
fetch(...)
```

去处理用户学习数据。

---

# 11. Backup

备份功能属于 Infrastructure。

应与普通学习进度存储区分。

例如：

```text
Progress
 ↓
Progress Repository

Backup
 ↓
Backup Service
```

备份码、备份文件、压缩、编码、完整性校验等实现不得进入游戏核心逻辑。

---

# 12. Future Auth Architecture

账号系统目前不存在，因此不要为了未来创建空实现。

正式接入账号后，推荐结构：

```text
UI
 ↓
Auth Application
 ↓
Auth Service
 ↓
Auth Repository
 ↓
Cloudflare Worker / D1
```

账号系统职责至少区分：

```text
Authentication
身份验证

Session
登录会话

User
用户身份

Progress Sync
学习数据同步
```

不要让：

```text
Game
Storage
Case Bank
Inquiry
```

直接操作 D1。

---

# 13. Auth 与学习数据必须解耦

未来登录之后：

```text
Auth
```

只回答：

```text
“你是谁？”
“当前是否登录？”
“当前会话是否有效？”
```

学习进度服务回答：

```text
“你完成了什么？”
“你有哪些错题？”
```

禁止让：

```text
Auth 模块
```

直接负责：

```text
病例完成
错题
题库
游戏状态
```

---

# 14. 本地与云端同步

未来如果同时存在：

```text
LocalStorage
D1
```

必须建立明确的同步层。

推荐：

```text
Game
 ↓
Progress Service
 ↓
Sync Policy
 ↙       ↘
Local     Remote
```

Game 不需要知道：

```text
数据最终保存在哪
何时调用 D1
D1 返回什么字段
localStorage key 是什么
```

---

# 15. State 原则

同一个业务事实只能存在一个权威状态源。

禁止：

```text
页面状态一份
game 状态一份
storage 状态一份
window 全局状态一份
```

导致互相同步。

优先：

```text
Single Source of Truth
```

其他模块读取结果，而不是自行维护副本。

---

# 16. Module API 原则

模块之间只能通过明确导出的接口通信。

接口包括：

```text
函数
参数
返回值
数据结构
事件
```

接口一旦被多个模块使用，就视为正式契约。

修改前必须搜索全部调用方。

---

# 17. 禁止跨模块内部访问

禁止：

```js
otherModule.internalState.xxx
```

禁止：

```js
state.xxx = ...
```

除非该状态本身就是明确设计为公共状态，而且其写入权已经明确规定。

优先：

```js
gameSession.addClue(...)
gameSession.reset(...)
progressService.save(...)
```

---

# 18. 副作用边界

以下都属于副作用：

```text
DOM 修改
localStorage
fetch
D1
文件读写
页面导航
弹窗
alert
```

副作用必须尽量集中在：

```text
Application
Infrastructure
UI
```

Domain 保持纯净。

---

# 19. 错误处理原则

允许明确失败：

```js
throw new Error(...)
```

禁止静默吞掉真正的程序错误。

禁止为了“尽量运行”：

```text
猜测字段
猜测返回值
多个字段 fallback
多个接口 fallback
随便返回空数组
随便使用默认值
```

错误应该被发现，而不是被隐藏。

---

# 20. 不允许为了未来功能提前设计不存在的系统

例如账号系统尚未接入时：

禁止：

```text
mock auth
fake user
placeholder token
伪造 repository
未来兼容层
```

只需要：

> 现在的架构为未来 Auth 保留清晰边界。

未来真正接入时再实现。

---

# 21. 结构健康标准

一个功能出现问题时，应该能够快速回答：

```text
这是 UI 问题？
这是 Application 问题？
这是 Domain 问题？
这是 Storage 问题？
这是 Auth 问题？
这是数据问题？
```

如果一个问题需要同时检查大量无关模块，说明架构已经出现耦合。

---

# 22. 目录结构维护原则

目录结构反映真实职责。

建议长期向以下方向演进：

```text
js/
├── app/
│   └── app.js
│
├── core/
│   ├── inquiry-matcher.js
│   ├── answer-evaluator.js
│   └── ...
│
├── game/
│   ├── game-session.js
│   └── ...
│
├── case-bank/
│   └── ...
│
├── data/
│   ├── case-loader.js
│   └── ...
│
├── storage/
│   ├── progress-storage.js
│   ├── backup-service.js
│   └── ...
│
├── auth/
│   └── （未来正式接入账号后再创建）
│
└── ui/
    └── ...
```

以上结构是目标方向，不要求一次性机械迁移。

---

# 23. 重构原则

禁止：

> 为了让目录看起来漂亮而重构。

允许：

> 为了解决明确的职责冲突、耦合、重复或维护困难而重构。

重构必须：

1. 保持现有功能。
2. 明确修改范围。
3. 不顺便增加新功能。
4. 修改后检查所有调用方。
5. 删除已废弃代码。

---

# 24. 维护原则

每增加一个功能，都必须问：

```text
它属于哪个模块？
谁拥有这个状态？
谁负责这个规则？
谁负责这个副作用？
谁调用谁？
谁不应该调用谁？
```

这六个问题必须在代码修改前得到明确答案。

---

# 25. 最终目标

本项目最终应做到：

```text
一个模块 = 一类主要职责

一个业务事实 = 一个权威来源

一个接口 = 一个明确契约

一个问题 = 一个明确排查方向

一个功能 = 一个明确归属
```

最终目标不是“代码越先进越好”，而是：

> **代码简单、边界清晰、依赖可追踪、行为可预测，并且适合长期使用 AI 进行维护。**
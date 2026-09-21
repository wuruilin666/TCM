# AGENTS.md

> 本文件是给 AI Coding / Vibe Coding 代理的项目入口约定。
>
> 它不定义新的架构，不定义新的开发流程，也不创建任何新的工程体系。
> 它只声明两件事：**本项目的权威规则在哪里**，以及**工程方法类 skill 的边界在哪里**。

---

## 1. 修改前必读

任何代码修改开始之前，必须按顺序阅读：

1. `ARCHITECTURE.md` —— 当前架构、模块职责、依赖方向与边界的权威来源
2. `AI_DEVELOPMENT_RULES.md` —— 项目开发规则的权威来源
3. 与本次需求直接相关的代码

未完成以上阅读，不得开始写代码。

---

## 2. 规则优先级

出现冲突时，按以下顺序裁决：

1. `AI_DEVELOPMENT_RULES.md`
2. `ARCHITECTURE.md`
3. 现有项目行为与用户显式要求
4. 工程类 skill 的建议

**项目规则优先于工程 skill。**

工程 skill 只是工作方法（怎么查、怎么测、怎么审），不构成对项目规则的覆盖、替换或例外。

---

## 3. 允许使用的工程 skill

本项目只允许使用以下工程 skill 作为辅助工作方法：

```text
diagnosing-bugs
tdd
code-review
codebase-design
domain-modeling
implement
```

不得用其它工程 skill 的流程改造本项目，包括但不限于：

```text
setup-matt-pocock-skills
issue tracker 搭建
triage 流程
CONTEXT.md
docs/agents/
```

本项目不引入以上任何一项，也不需要为它们预留位置。

---

## 4. 不得因 skill 建议而擅自改动

不得因为某个 skill 的建议而擅自引入或实施：

```text
新框架 / 新技术栈
重构（尤其「顺手大重构」）
fallback / 兜底逻辑
兼容层 / 兼容参数 / wrapper
新依赖（含 devDependency）
```

如果 skill 的建议与项目规则冲突，以项目规则为准。

如果现有架构确实阻碍需求，必须按 `AI_DEVELOPMENT_RULES.md` 第 24 条处理：先明确指出问题模块、当前职责冲突、以及建议的调整方向，得到确认后再实施；不得用临时变量、兼容函数、全局变量或 fallback 绕开结构问题。

---

## 5. 修改后必须验证

```bash
npm test
node tools/arch-check.mjs
```

两项必须都通过，才算本次修改完成。

- 必须运行**完整**测试套件，只跑新增测试不算通过。
- 禁止「功能测试通过、架构检查失败」仍然提交。

新增 `js/**` 业务模块时，还必须同时满足：

1. 在 `ARCHITECTURE.md` 中记录其职责
2. 在 `tools/arch-check.mjs` 的 `LAYER` 中声明层级
3. 通过 arch-check

---

## 6. 修改范围

- 保持最小修改：只改与需求直接相关的模块，不顺便重构、不顺便换依赖、不顺便改数据结构。
- 不为「结构看起来更好」而重构。
- 不针对单个病例 ID 写业务特判；病例差异优先由数据表达。
- 删除废弃代码优先于长期保留兼容逻辑。

---

## 7. 交付报告要求

每次代码修改完成后，报告必须包含：

```text
npm test：通过 / 失败
node tools/arch-check.mjs：通过 / 失败
本次修改了哪些文件
每个文件为什么需要修改
是否修改了已有公共接口
是否新增依赖
是否新增 fallback / 兼容逻辑
是否删除了既有代码
以后出问题应首先检查哪个模块
```

---

## 8. 已知冲突与处置（实测）

第 3 节列出的 6 个技能已安装在本机：

```text
C:\Users\吴睿琳\.agents\skills\<skill-name>\
来源：mattpocock/skills（插件名 mattpocock-skills）
```

注意：该目录**不是** WorkBuddy 的技能目录，本会话的 Skill 加载器看不到它们。

这些技能的部分指令与本项目规则冲突。按第 2 节的优先级，一律以**项目规则**为准：

| 冲突点 | 出处 | 处置 |
| --- | --- | --- |
| 提示运行 `/setup-matt-pocock-skills`，并依赖 `docs/agents/issue-tracker.md` 获取 spec | `code-review/SKILL.md` | 不运行、不创建。没有 spec 来源时 Spec 轴直接跳过并说明 |
| 要求创建根目录 `CONTEXT.md` 与 `docs/adr/` | `domain-modeling/SKILL.md`、`tdd/SKILL.md` | 禁止。本项目术语与职责的权威来源是 `ARCHITECTURE.md`，不再建第二份同级权威 |
| 建议用 Playwright / Puppeteer 构造 UI 反馈回路 | `diagnosing-bugs/SKILL.md` | 不新增依赖。需要 DOM 时用现有 `jsdom`（本项目唯一 devDependency） |
| 建议并行子代理设计多个候选接口（Design It Twice） | `codebase-design/SKILL.md` | 不做。禁止为设计探索而重构 |
| 要求统一改用 depth / seam / adapter 等术语 | `codebase-design/SKILL.md` | 术语以 `ARCHITECTURE.md` 为准，不替换项目既有表述 |
| `Run typechecking regularly` | `implement/SKILL.md` | 本项目无 TypeScript，该步替换为 `npm test` + `node tools/arch-check.mjs` |
| `Commit your work to the current branch` | `implement/SKILL.md` | 不得自动提交，提交前须经用户确认 |
| 该技能不在第 3 节白名单内 | `find-skills`（来源 `vercel-labs/skills`） | 禁用。它的用途是安装新 skill，超出本次授权范围 |


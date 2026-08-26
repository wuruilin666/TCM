# 中医病例互动学习网站（海龟汤模式）

通过病例主诉（谜面）引导学习者自主选择「望、闻、问、切」获取线索，逐步完成辨证、病名和治法推演；提交后可查看完整医案解析。

> 本站内容仅供中医学习与病例推演，不构成诊断、处方或医疗建议；如有不适请及时就医。

## 本地运行

页面由内置 Node 服务提供病例 API、投稿审核入口和安全响应头；请不要直接双击打开 HTML 文件：

```bash
npm start
```

然后访问 <http://localhost:8000>。

## 病例数据维护

- 病例索引位于 `data/case-index.json`，详情按难度拆分在 `data/cases/`。前端先加载摘要，进入某一难度后才按需加载该难度详情。
- `GET /api/cases` 支持 `difficulty`、`category`、`q`、`offset` 和 `limit` 参数，单页最大 50 例；`GET /api/cases/:id` 返回单例完整内容。
- 每例必须使用唯一 ID，格式为 `basic-001`、`inter-001` 或 `adv-001` 等小写字母加三位数字。
- `category` 必须是页面定义的分类，`difficulty` 只能是 `basic`、`intermediate` 或 `advanced`。
- 每例必须包含完整的望、闻、问、切数据、正确答案及医案解析。
- 舌象图片放在 `public/tongue/`，病例配置的图片路径只允许指向该目录下的 `.jpg` 文件。

提交前可执行基础校验：

```bash
python3 -m json.tool data/case-index.json >/dev/null
for file in data/cases/*.json; do python3 -m json.tool "$file" >/dev/null; done
node --check server.js
node --check public/assets/app.js
```

## 隐私、安全与投稿

投稿通过 `POST /api/submissions` 进入本站待审核目录，不再直接转发至第三方表单服务。服务端限制请求大小、来源和速率，并校验图片文件签名；所有投稿状态默认为 `pending_review`。维护者仍必须在发布前人工核对病例来源、授权、脱敏、图片 EXIF/隐私风险和医学内容。客户端检查只能改善体验，不能作为安全边界。

- 服务端设置 CSP、`X-Content-Type-Options: nosniff`、Referrer-Policy 与 Permissions-Policy；脚本使用外部文件和事件委托，满足 `script-src 'self'`。
- 当前保留 `style-src 'unsafe-inline'` 作为历史内联样式的迁移例外。新增样式必须写入 `public/assets/app.css`，删除全部内联 `style` 后再移除此例外。
- 生产环境应把 `uploads/`、`submissions/` 放入私有持久化存储，增加认证、反病毒扫描、图片重编码/EXIF 清理与外部监控告警。

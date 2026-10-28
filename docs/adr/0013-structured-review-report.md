# 汇总报告按字段提交，由界面固定排版；不支持 Mermaid 和模型生成的 HTML

原来汇总报告是调度者自由写的 Markdown，要求逐张卡片列结果、Agent id、派单 id 和命令输出，用户反映太长、读完才知道能不能接受。调研（`.scratch/tasks/review-report-research/report.md`，仅本地）对照 Google 代码审查指南、GitHub / GitLab 和 Devin、Copilot、Codex、Cursor、Jules 的交付总结后，用户 2026-10-28 决定：`request-review` 按字段提交结论（建议接受 / 有保留 / 建议退回）、例外（未满足、未验证、覆盖截断）、逐条标准、卡片和建议，存在 `gates.report`。审核页首屏固定为结论、例外和标准表，全部通过时标准收成一行；卡片表和建议默认折叠；Agent id、派单 id 和命令原文只在详情或证据链接里。只有结论说明、例外原因和建议这类短文本按受限 Markdown 渲染。旧的纯文本报告照常显示。

## Considered Options

- **模型自由写 Markdown，只在规则里约束格式**：首屏内容和长度每次都不同，规则管不住。
- **报告里画 Mermaid**：语法错一个词整张图就失败；卡片依赖已有卡片图，不需要模型再画。
- **报告里放模型生成的 HTML**：排版交给模型后首屏不可控，还要为审核页另做 sandbox iframe 隔离 XSS。成果里的 `.html` 文件仍按原来的隔离 iframe 预览。

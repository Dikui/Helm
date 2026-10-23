# 04 — MCP 的非 POST 请求不记为"操作被拒绝"

**What to build:** MCP 客户端在会话里发出的 GET（SSE 探测）、DELETE 等非 POST 请求得到 405，但不记"操作被拒绝"事件，所以审核附件里的"被拒绝的操作数"只统计真实的业务拒绝。其他接口的非 POST 请求照旧拒绝并记事件。来源：第一版 2048 端到端中，"操作被拒绝"事件有 56 次是 METHOD_NOT_ALLOWED，每个 SDK 会话一次（见 [任务单 15](../../helm-v1-p1/issues/15-default-prompts-and-2048.md) Comments）。见 [spec](../../helm-v1-p1/spec.md)"对外接口只有 HTTP POST + SSE"和用户故事 45。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] `/mcp` 的非 POST 请求返回 405，响应符合 MCP Streamable HTTP 对"服务端不提供 GET 流"的约定，不追加事件
- [x] 其他路径的非 POST 请求仍返回结构化拒绝并记事件
- [x] 测试覆盖：用真实 MCP 客户端完成一次会话后，没有因此出现"操作被拒绝"事件

## Comments

- 为 `/mcp` 的非 POST 请求直接返回带 `Allow: POST` 的 JSON-RPC 405，不追加事件；补充真实 MCP 会话、其他 HTTP 方法与路径及业务拒绝仍记账的回归覆盖。

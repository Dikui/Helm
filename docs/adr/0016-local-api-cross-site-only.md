# 本机用户接口不加令牌，只拦网页跨站请求

helmd 只听 127.0.0.1，不带令牌的请求按用户处理。2026-10-22 设计时用户决定用户接口不认证，接受执行者可冒充用户（执行者沙箱能连本机端口），也不防网页跨站。之后加了登记 stdio MCP（ADR 0007）和改提示词（ADR 0008），冒充用户等于能在本机执行任意命令。用户 2026-10-29 决定：所有请求检查 Host 为 `127.0.0.1` / `localhost`、Origin 缺省或为本机地址、POST 必须是 `application/json`，挡住浏览器里任意网页的跨站请求和 DNS 重绑定；执行者冒充用户仍是已接受的风险。

只查请求头挡不住执行者：沙箱里的 curl 可以自己填 Host 和 Origin。要挡执行者得让界面和 CLI 也带令牌，令牌放 `~/.helm/` 并给 Claude、Codex、Grok 各配禁读（Claude 要沙箱 `denyRead` 加权限拒绝规则，Codex 要权限配置，Grok 要 sandbox profile），DeepSeek Harness 没有按路径禁读，仍会漏；这套成本用户不接受。以后要补认证，先读 `docs/research/local-daemon-auth.md`（仅本地）。

## Considered Options

- **令牌加三家禁读**：防得住除 DeepSeek 外的执行者，配置分散在各驱动且每家都有绕过条件。
- **只封 helmd 端口或按 TCP 对端进程识别**：四家沙箱都没有单端口粒度，进程树识别挡不住脱离进程树的进程。

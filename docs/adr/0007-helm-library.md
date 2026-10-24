# skill 和 MCP 统一装进库，Agent 按名字引用，运行时复制

Agent 原来只能在自己目录的 `skills/` 里放 skill，同一个 skill 给几个 Agent 用就得复制几份；MCP 则没有按 Agent 配置的入口，API Agent 拿不到用户的 MCP。用户 2026-10-24 决定加一个**库**：skill 和 MCP 统一装在 `<dataDir>/library/`（与 `agents/` 并列，同样不受 Helm 更新影响），Agent 在 `config.json` 用 `skills`、`mcp` 名字列表引用，与 ADR 0005 一致，仍只在全局配置之上叠加。派单或调度轮次真正启动时，Helm 把 Agent 自带 skill 和选中的库 skill **复制**到这次运行的目录，再按原有方式交给驱动；选中的 MCP 与 Helm 自己的 `helm` MCP 合并传入。

复制而不用软链接：各家 CLI 发现 skill 时是否跟随软链接没有验证，且复制让每次运行固定在启动那一刻的版本，库里改动或删除不影响正在跑的 Agent。代价是每次启动多一次小目录复制。

两处有意不做全：ACP 驱动（Grok、DeepSeek）第一版只传 HTTP MCP，引用 stdio MCP 的 Agent 直接标为不可用，而不是运行中失败；订阅 Agent 选中的库 skill 与本机 CLI 全局 skill 同名时只给警告，不自动改名或屏蔽，因为各家 CLI 的同名优先级不同，Helm 不去猜。

## Considered Options

- **每个 Agent 各放一份 `skills/`**（原状）：无共享，改一处要改多处，也解决不了 MCP。
- **Agent 的 `skills/` 用软链接指向共享目录**：不改代码，但依赖未验证的 CLI 行为，且运行中会读到库的实时改动。
- **启动时只传库目录，让 CLI 自己按名字过滤**：各家 CLI 没有统一的按名字启用 skill 的参数。

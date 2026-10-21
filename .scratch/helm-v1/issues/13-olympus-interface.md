# Olympus 接入面

Type: grilling
Status: open
Labels: wayfinder:grilling
Blocked by: 07
Map: [Helm v1 设计](../map.md)

## Question

Helm 对外提供哪些 HTTP 和 MCP 接口，怎样和 Olympus 的统一接入接口、卡片和决策关卡对齐，才能以后迁移时不重写？先读 Olympus 仓库里已有的接口定义。

## Comments

- 2026-10-21 来自 [04](04-tech-stack.md)：Olympus 也只是用户自用。Claude Agent SDK 和 `codex app-server` 能用订阅，前提就是自用；如果以后要给别人用，Codex 要改走 Sign in with ChatGPT 或 API key，Claude 要改走 API key。

# 隔离与合并

Type: grilling
Status: open
Labels: wayfinder:grilling
Blocked by: 01, 02
Map: [Helm v1 设计](../map.md)

## Question

每张卡片的 worktree 从哪个 ref 开出来，什么时候清理？完成的分支怎么合并（谁来合、什么时候合、冲突怎么处理）？依赖前一张卡片的卡片，是在前一张单合并后的基础上开始，还是基于它的分支？A4 已被推翻（见 02）：要不要加一层外部边界（容器、VM，或按进程拆开家目录和凭证），加到什么程度？

## Comments

- 2026-10-21 来自 [04](04-tech-stack.md)：隔离方案要和订阅登录一起考虑。Claude 在 macOS 上把登录存在钥匙串里，Codex 存在 `~/.codex`，Grok 存在 `~/.grok`；按进程拆开家目录或放进容器，可能导致读不到登录。Claude Agent SDK 运行在 `helmd` 进程里，执行者如果放进容器，`pathToClaudeCodeExecutable` 要指向一个包装脚本（例如 `docker exec`）。多个 Codex 执行者共用 `~/.codex` 时的 SQLite 锁争用见 04 的 Q15。

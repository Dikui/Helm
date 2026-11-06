# 项目推送规则

- 仓库公开性：公开（GitHub PUBLIC）。
- 受保护分支：main 是默认分支，服务器未设保护规则。
- 允许推送的 remote 与目标分支：origin（git@github.com:Dikui/Helm.git）的 main。
- 提交约定：中文一句话说明改动，升版本写“版本升到 X”。
- 测试假数据目录及来源：没有专门目录，假值写在 tests/ 下，下面逐项豁免。
- 内部代号、内网或工单链接、未公开计划的资料入口：无。

## 版本文件

- package.json 的 version。
- package-lock.json 的顶层 version 和 packages[""] 中的 version。

## 追加与调整

```safe-push-deny
```

## 限定豁免

```safe-push-allow
tests/dispatch.test.ts diagnostic-user:
tests/dispatch.test.ts copy-artifact-secret
tests/alignment.test.ts diagnostic-user:
tests/agents.test.ts private-tool-token
tests/browser.test.ts (startup|browser)-secret
```

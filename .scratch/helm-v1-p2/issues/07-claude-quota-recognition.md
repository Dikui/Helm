# 07 — Claude 额度用完识别

**What to build:** Claude 驱动按真实错误消息识别"额度用完"，调度者据此改派，不把撞限额当普通出错。API 模板余额不足或 key 失效也记"额度用完"。见 [spec](../spec.md) 的"主目录与凭据"最后两条、Testing Decisions 副边界。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 收集 Claude 订阅撞上限额、API 余额不足、key 失效、429 限流的真实错误消息样本（来自 Claude Code 源码、文档或 issue），作为测试固定输入，注明来源
- [x] 前三种记结束方式"额度用完"；429 由 CLI 自己重试，仍失败记"出错退出"
- [x] 驱动单元测试覆盖每个样本；不要求真实触发
- [x] 真撞上时把原始消息存为新的固定输入（写进测试说明）

## Comments

已收集九个带官方 issue 来源的错误消息样本，Claude 两种角色按诊断区分额度用完和临时 429，并覆盖结果包装、恢复成功与普通回答误判防护；真实撞限额时保存原始消息并补固定输入的流程写在测试样本说明中。

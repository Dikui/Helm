已完成 T01–T13 的执行尝试，内层共 **30 次 exec/resume**，创建 **23 个 thread_id**。使用 `gpt-6-astra/low`，没有降级。

交付：[实测报告](/Users/dikui/Project/Helm/research/codex-cli-verification.md)、[原始证据](/Users/dikui/Project/Helm/evidence/004/)、[任务报告](/Users/dikui/Project/Helm/tasks/004-report.md)。

- T01：JSON 合法、符合 schema，与最后消息逐字一致。
- T02：三次均合规，条目完整且无重复。
- T03：strict 错误为 API 400/exit 1；语法错误在本地失败。
- T04：实际发出写文件调用；创建被嵌套沙箱阻止。
- T05：全试验观察到 7 类顶层事件，用量有 5 个字段。
- T06：暗号保留，新 schema 生效，thread_id 不变。
- T07：只读写保护未能确认，shell 启动被嵌套沙箱阻止。
- T08：恢复配置记录为 read-only；权限效果未确认，resume 后的 `-s` 被拒绝。
- T09：默认和禁用组都真实创建子代理。
- T10：三并发全部成功，线程不同，未观察到串扰。
- T11：零步骤时 SIGTERM 成功、exit 143；SIGKILL 被拒，指定阶段中断及去重未确认。
- T12：ephemeral 会话恢复失败，exit 1。
- T13：无效模型和不存在 UUID 均 exit 1；UUID 错误只出现在 stderr。

对 Helm 影响最大的三点：

1. `--disable multi_agent` 在本环境未阻止子代理，不能作为调用上限。
2. JSONL 遗漏部分工具动作和子线程身份，不能单独承担完整审计。
3. 工具失败仍可 exit 0；中断也可没有终态事件和 `-o`，必须联合校验进程、结果与产物。

scratch 已删除，已有仓库文件未改，本任务记录的 PID/PGID 均不存在。全局 `ps` 检查被外层沙箱拒绝；T04、T07、T08、T11 的相关行为仍未确认，拒绝/截断及子代理树恢复未覆盖。
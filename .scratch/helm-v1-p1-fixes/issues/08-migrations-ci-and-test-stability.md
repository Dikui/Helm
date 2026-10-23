# 08 — 迁移顺序化、CI 与 pre-commit、看门狗测试稳定

**What to build:** 第二阶段多张单并行加表时，迁移不再撞版本号；每次提交和推送都有自动检查；看门狗测试在机器负载高时不再偶发失败。来源：第一阶段并行合并时迁移版本号多次冲突，一次漏改手写的版本白名单导致 4 个重启测试失败；仓库没有 CI 和 pre-commit；看门狗测试在负载高时失败过一次。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 迁移改为有序列表，版本号由列表位置决定；删掉手写的版本白名单，库版本高于最新迁移时拒绝启动；已有数据库（版本 1–10）照常升级，有测试覆盖
- [ ] pre-commit 运行 `npm run check`，`npm install` 后自动启用（例如 `core.hooksPath` 指向仓库内的 hook 目录）
- [ ] GitHub Actions 在 push 和 PR 上运行 `npm ci`、`npm run check`、`npm test`（Node 版本满足 package.json 的 engines），不运行真实冒烟
- [ ] 看门狗测试放大时间余量或改为可控时钟，连续运行全量测试 5 次不失败

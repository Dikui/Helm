# Helm 设计文档（Demo 版）

## 第一性原理

任何工作都能拆成 **需求 + 边界 + 开发 + 测试**。

- **人**：定义、理解、签收 需求 / 边界 / 测试
- **代理**：负责 开发；只能通过「变更请求」修改契约

不区分 coding 还是项目管理——两者都是契约树。

```
Task = 契约（需求 + 边界 + 测试）  ← 人
     + 执行（开发）                ← 代理
```

## 三条修正

1. **递归**：上层的开发产出 = 下层的需求 + 边界（层层对齐 = 契约树，每个负责人只看自己节点）。
2. **回流**：执行中发现契约问题，代理提交变更请求，人批准后生效。
3. **测试分级**：
   | kind | 验证方式 |
   |---|---|
   | `deterministic` | 自动执行（单测、CI、格式检查） |
   | `evidence` | 每条结论附可追溯来源，由 verifier 逐条核对 |
   | `adversarial` | redteam 挑错，所有质疑须有回应 |
   | `judgment` | 人基于摘要 + 证据签字 |

   硬规则：提交证据的角色 ≠ 核对证据的角色。

## Demo 范围

- **需求**：用两个串联案例完整跑通——
  1. 市场调研 + 客户需求 → 层层对齐能否承接（非编码）
  2. 承接后的产品开发（编码），上一阶段的结论自动成为边界
- **边界**：单用户、纯本地；执行端用 Claude Code；不做登录、通知、远程、企业系统接入；经验库 = 本地文件夹
- **测试**：
  - 契约树 ≥ 2 层
  - 代理无法直接修改契约 / 签收
  - 每条结论有可追溯证据
  - verifier 与 worker 上下文独立，redteam 质疑全部回应
  - 人只需要一个页面（三栏视图 + 收件箱）

## 架构

```
Claude Code
  ├─ Skill: chief       拆解、派单、汇总
  ├─ Subagent: worker   执行
  ├─ Subagent: verifier 核对证据
  └─ Subagent: redteam  挑错
        │ MCP (stdio)
 Contract Hub（Node + TS，无构建步骤）──HTTP──▶ 本地 Web 页（人的唯一入口）
        │
 SQLite (data/helm.db) + evidence/ + experience/
```

所有写入都经过 Hub。`actor` 区分 `human` 与 `agent:<role>`：

| 操作 | agent | human |
|---|:-:|:-:|
| 起草契约（draft）、子契约 | ✅ | ✅ |
| 批准契约 draft → ready | | ✅ |
| 认领、汇报进度、提交证据 | ✅ | |
| 记录检查结果 | ✅（verifier/redteam） | ✅（judgment） |
| 提出变更请求 | ✅ | |
| 批准/驳回变更请求 | | ✅ |
| 签收 / 打回 | | ✅ |

## 状态机

```
draft → ready → running ⇄ blocked → verifying → in_review → accepted
                   ▲                                 │
                   └──────── changes_requested ◀─────┘
```

规则：
- 存在 `pending` 变更请求时不得进入 `verifying`
- 进入 `in_review` 前，所有非 judgment 测试必须有通过的检查
- `accepted` 只能由人设置

## 向多人版本演进（不在 Demo 中实现）

SQLite → Postgres；Web 页加登录；MCP 接口不变。各成员可用不同 ADE 经 MCP 接入同一 Hub。

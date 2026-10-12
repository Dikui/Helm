// v7 Demo 数据；真实证据与示例配置分别标注。
const db = {
  "projects": [
    {
      "id": "project-a",
      "name": "客户 A · 智能排产承接",
      "type": "客户交付",
      "goal": "评估智能排产需求能否承接",
      "site": "交付目录/客户A/",
      "leaderId": "agent-pm-client",
      "instructions": "示例 · 界面文字使用中文；不调用真实执行端。",
      "requirements": "示例 · 承接结论须附四个维度的依据。",
      "authorization": "示例 · 新范围先问我；其他组织工作由项目负责人决定。",
      "budget": 120,
      "spent": 18.599999999999998,
      "budgetNote": "示例 · 元；非真实账单",
      "cardIds": [
        "a-clarify",
        "a-tech",
        "a-capacity",
        "a-cost",
        "a-market",
        "a-summary",
        "a-delivery",
        "a-decline"
      ],
      "memory": {
        "decisions": [],
        "cautions": [
          "示例 · 引用卡片的已验收版本，核对上游变化。"
        ],
        "glossary": []
      },
      "example": true,
      "executor": "Codex CLI"
    },
    {
      "id": "project-b",
      "name": "Helm 开发",
      "type": "产品开发",
      "goal": "以真实开发记录展示原型交付与返工",
      "site": "/Users/dikui/Project/Helm",
      "leaderId": "agent-pm-dev",
      "instructions": "示例 · 界面文字使用中文；不调用真实执行端。",
      "requirements": "示例 · 改动界面的交付需附浏览器检查截图。",
      "authorization": "示例 · 新范围先问我；其他组织工作由项目负责人决定。",
      "budget": 80,
      "spent": 10.8,
      "budgetNote": "示例 · 元；非真实账单",
      "cardIds": [
        "b-spec",
        "b-implement",
        "b-browser",
        "b-prototype-a",
        "b-prototype-b",
        "b-sandbox",
        "b-sandbox-recheck",
        "b-collaboration",
        "b-agent-team",
        "b-ade",
        "b-defect-diagnose",
        "b-defect-fix",
        "b-defect-regression"
      ],
      "memory": {
        "decisions": [],
        "cautions": [
          "示例 · 引用卡片的已验收版本，核对上游变化。"
        ],
        "glossary": []
      },
      "example": false,
      "executor": "Codex CLI"
    }
  ],
  "cards": {
    "a-clarify": {
      "id": "a-clarify",
      "projectId": "project-a",
      "title": "需求澄清",
      "requirements": [
        {
          "text": "客户 A（离散制造，年产值约 8 亿）提出智能排产需求：根据订单、设备、人员自动生成周排产计划，并与其现有 ERP 同步。\n\n判断我们能否承接，给出结论：可行 / 有条件可行 / 不可行。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "只使用公开数据与内部资料",
          "source": "你"
        },
        {
          "text": "不直接联系客户",
          "source": "你"
        },
        {
          "text": "3 个工作日内给出结论（截止 10/10）",
          "source": "你"
        },
        {
          "text": "不承诺超出当前交付产能的上线时间",
          "source": "你"
        },
        {
          "text": "示例 · 客户资料与对外文案使用中文",
          "source": "项目指令"
        }
      ],
      "tests": [
        {
          "id": "t1",
          "text": "订单、设备、人员及 ERP 同步目标已写明",
          "type": "evidence",
          "result": "pass",
          "source": "你"
        },
        {
          "id": "t2",
          "text": "你确认承接判断的目标与范围",
          "type": "judgment",
          "result": "pass",
          "source": "你"
        }
      ],
      "deliverables": [
        "Markdown 需求澄清：交付目录/客户A/需求澄清.md"
      ],
      "sources": [
        {
          "path": "客户 A 已提供需求材料",
          "note": "示例资料"
        },
        {
          "path": "内部历史项目资料",
          "note": "示例资料"
        },
        {
          "path": "git:5b76bcd:prototype/index.html#a-clarify",
          "note": "v4 原型快照，状态、预算与成员安排为示例"
        }
      ],
      "dependencies": [],
      "groups": [
        "承接评估"
      ],
      "parentId": null,
      "memberId": "member-a-clarify",
      "budget": 20,
      "spent": 1.2,
      "budgetNote": "示例 · 非真实账单",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "客户 A（离散制造，年产值约 8 亿）提出智能排产需求：根据订单、设备、人员自动生成周排产计划，并与其现有 ERP 同步。\n\n判断我们能否承接，给出结论：可行 / 有条件可行 / 不可行。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "只使用公开数据与内部资料",
              "source": "你"
            },
            {
              "text": "不直接联系客户",
              "source": "你"
            },
            {
              "text": "3 个工作日内给出结论（截止 10/10）",
              "source": "你"
            },
            {
              "text": "不承诺超出当前交付产能的上线时间",
              "source": "你"
            },
            {
              "text": "示例 · 客户资料与对外文案使用中文",
              "source": "项目指令"
            }
          ],
          "tests": [
            {
              "id": "t1",
              "text": "订单、设备、人员及 ERP 同步目标已写明",
              "type": "evidence",
              "result": "pass",
              "source": "你"
            },
            {
              "id": "t2",
              "text": "你确认承接判断的目标与范围",
              "type": "judgment",
              "result": "pass",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 1,
      "outputHistory": [
        {
          "version": 1,
          "summary": "示例 · 保留交付产出",
          "sources": [
            "客户 A 已提供需求材料",
            "内部历史项目资料",
            "git:5b76bcd:prototype/index.html#a-clarify"
          ],
          "example": true
        }
      ],
      "upstreamChanged": false,
      "usedUpstreamVersions": {},
      "statusLine": "示例 · 产出已验收",
      "status": "integrated",
      "attempts": [
        {
          "number": 1,
          "actor": "客户交付项目经理",
          "model": "gpt-6.1-sol · ultra",
          "method": "整理客户目标与当前业务边界",
          "result": "success",
          "failure": "",
          "tokens": 3000,
          "duration": "30 分钟",
          "sessionId": "未记录",
          "sourceFiles": null,
          "passed": null,
          "total": null,
          "score": null,
          "endReason": "完成",
          "continuation": "续接原会话",
          "cost": 1.2,
          "metadataNote": "快照分支、计划版本、步骤汇总与花费为示例；真实来源记录未记载的模型、token、会话不补造。",
          "steps": []
        }
      ],
      "example": true,
      "recordNote": "示例 · 全卡为模拟数据",
      "independentVerification": null
    },
    "a-tech": {
      "id": "a-tech",
      "projectId": "project-a",
      "title": "技术可行性",
      "requirements": [
        {
          "text": "评估现有平台能否支撑客户 A 的排产需求：约束求解规模、ERP 对接方式、数据前置条件。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "以现有「调度引擎 v3」为基础，不评估自研新引擎",
          "source": "你"
        },
        {
          "text": "客户 ERP 型号未知时，按主流两种（SAP / 用友）分别评估",
          "source": "你"
        },
        {
          "text": "示例 · 客户资料与对外文案使用中文",
          "source": "项目指令"
        }
      ],
      "tests": [
        {
          "id": "t1",
          "text": "求解规模结论有基准测试或过往项目数据支撑",
          "type": "evidence",
          "result": "pass",
          "source": "你"
        },
        {
          "id": "t2",
          "text": "ERP 对接方式有接口文档或过往实施记录支撑",
          "type": "evidence",
          "result": "unverifiable",
          "source": "你"
        },
        {
          "id": "t3",
          "text": "独立审查质疑全部得到回应",
          "type": "adversarial",
          "result": "pass",
          "source": "你"
        },
        {
          "id": "t4",
          "text": "技术负责人认可结论",
          "type": "judgment",
          "result": "unprocessed",
          "source": "你"
        }
      ],
      "deliverables": [
        "Markdown 技术可行性报告：evidence/c1a/技术可行性.md（附基准、ERP 文档引用与风险回应）"
      ],
      "sources": [
        {
          "path": "experience/specs/engine-v3.md 调度引擎 v3 官方规格",
          "note": "示例资料"
        },
        {
          "path": "experience/benchmarks/engine-v3-2025Q2.md",
          "note": "示例资料"
        },
        {
          "path": "experience/projects/ 既有实施与复盘记录",
          "note": "示例资料"
        },
        {
          "path": "SAP / 用友公开接口文档",
          "note": "示例资料"
        },
        {
          "path": "git:5b76bcd:prototype/index.html#a-tech",
          "note": "v4 原型快照，状态、预算与成员安排为示例"
        }
      ],
      "dependencies": [
        "a-clarify"
      ],
      "groups": [
        "承接评估"
      ],
      "parentId": null,
      "memberId": "member-a-tech",
      "budget": 20,
      "spent": 2.8,
      "budgetNote": "示例 · 非真实账单",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "评估现有平台能否支撑客户 A 的排产需求：约束求解规模、ERP 对接方式、数据前置条件。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "以现有「调度引擎 v3」为基础，不评估自研新引擎",
              "source": "你"
            },
            {
              "text": "客户 ERP 型号未知时，按主流两种（SAP / 用友）分别评估",
              "source": "你"
            },
            {
              "text": "示例 · 客户资料与对外文案使用中文",
              "source": "项目指令"
            }
          ],
          "tests": [
            {
              "id": "t1",
              "text": "求解规模结论有基准测试或过往项目数据支撑",
              "type": "evidence",
              "result": "pass",
              "source": "你"
            },
            {
              "id": "t2",
              "text": "ERP 对接方式有接口文档或过往实施记录支撑",
              "type": "evidence",
              "result": "unverifiable",
              "source": "你"
            },
            {
              "id": "t3",
              "text": "独立审查质疑全部得到回应",
              "type": "adversarial",
              "result": "pass",
              "source": "你"
            },
            {
              "id": "t4",
              "text": "技术负责人认可结论",
              "type": "judgment",
              "result": "unprocessed",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 0,
      "outputHistory": [],
      "upstreamChanged": false,
      "usedUpstreamVersions": {
        "a-clarify": 1
      },
      "statusLine": "示例 · 等待你验收",
      "status": "review",
      "attempts": [
        {
          "number": 1,
          "actor": "agent-tech",
          "model": "opus-5.5 · high",
          "method": "仅按理想化排产基准评估求解规模，再检索 ERP 实施记录",
          "result": "failed",
          "failure": "风险审查员：基准未覆盖插单场景",
          "tokens": 4800,
          "duration": "49 分钟",
          "sessionId": "未记录",
          "sourceFiles": null,
          "passed": null,
          "total": null,
          "score": null,
          "endReason": "验证失败",
          "continuation": "新会话带失败摘要",
          "cost": 1.2,
          "metadataNote": "快照分支、计划版本、步骤汇总与花费为示例；真实来源记录未记载的模型、token、会话不补造。",
          "steps": []
        },
        {
          "number": 2,
          "actor": "agent-tech",
          "model": "opus-5.5 · high",
          "method": "补充 P-2024-07 插单率 18% 场景，明确首期单向导入与数据前置条件",
          "result": "success",
          "failure": "",
          "tokens": 3600,
          "duration": "27 分钟",
          "sessionId": "未记录",
          "sourceFiles": null,
          "passed": null,
          "total": null,
          "score": null,
          "endReason": "完成",
          "continuation": "续接原会话",
          "cost": 1.6,
          "metadataNote": "快照分支、计划版本、步骤汇总与花费为示例；真实来源记录未记载的模型、token、会话不补造。",
          "steps": []
        }
      ],
      "example": true,
      "recordNote": "示例 · 全卡为模拟数据",
      "independentVerification": null
    },
    "a-capacity": {
      "id": "a-capacity",
      "projectId": "project-a",
      "title": "交付产能",
      "requirements": [
        {
          "text": "评估 Q4–Q1 交付团队能否承接一个排产实施项目（预计 3 人 × 4 个月）。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "以现有人员为准，不假设新招聘",
          "source": "你"
        },
        {
          "text": "示例 · 客户资料与对外文案使用中文",
          "source": "项目指令"
        }
      ],
      "tests": [
        {
          "id": "t1",
          "text": "产能结论基于排期表或资源台账",
          "type": "evidence",
          "result": "unprocessed",
          "source": "你"
        },
        {
          "id": "t2",
          "text": "交付经理认可",
          "type": "judgment",
          "result": "unprocessed",
          "source": "你"
        }
      ],
      "deliverables": [
        "Markdown 产能评估与 CSV 人员占用表：evidence/c1b/交付产能.md、evidence/c1b/人员占用.csv"
      ],
      "sources": [
        {
          "path": "experience/resources/2026-09-台账.xlsx",
          "note": "示例资料"
        },
        {
          "path": "人确认的 Q4 项目排期与人员占用",
          "note": "示例资料"
        },
        {
          "path": "git:5b76bcd:prototype/index.html#a-capacity",
          "note": "v4 原型快照，状态、预算与成员安排为示例"
        }
      ],
      "dependencies": [
        "a-clarify"
      ],
      "groups": [
        "承接评估"
      ],
      "parentId": null,
      "memberId": "member-a-capacity",
      "budget": 20,
      "spent": 1.2,
      "budgetNote": "示例 · 非真实账单",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "评估 Q4–Q1 交付团队能否承接一个排产实施项目（预计 3 人 × 4 个月）。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "以现有人员为准，不假设新招聘",
              "source": "你"
            },
            {
              "text": "示例 · 客户资料与对外文案使用中文",
              "source": "项目指令"
            }
          ],
          "tests": [
            {
              "id": "t1",
              "text": "产能结论基于排期表或资源台账",
              "type": "evidence",
              "result": "unprocessed",
              "source": "你"
            },
            {
              "id": "t2",
              "text": "交付经理认可",
              "type": "judgment",
              "result": "unprocessed",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 0,
      "outputHistory": [],
      "upstreamChanged": false,
      "usedUpstreamVersions": {
        "a-clarify": 1
      },
      "statusLine": "示例 · 等待项目负责人处理",
      "status": "running",
      "attempts": [
        {
          "number": 1,
          "actor": "agent-capacity",
          "model": "opus-5.5 · high",
          "method": "核对资源台账并与 Q4 项目排期对照；缺失信息提交问题",
          "result": "running",
          "failure": "",
          "tokens": 2400,
          "duration": "31 分钟（等待回答）",
          "sessionId": "未记录",
          "sourceFiles": null,
          "passed": null,
          "total": null,
          "score": null,
          "endReason": null,
          "continuation": "续接原会话",
          "cost": 1.2,
          "metadataNote": "快照分支、计划版本、步骤汇总与花费为示例；真实来源记录未记载的模型、token、会话不补造。",
          "steps": []
        }
      ],
      "example": true,
      "recordNote": "示例 · 全卡为模拟数据",
      "independentVerification": null
    },
    "a-cost": {
      "id": "a-cost",
      "projectId": "project-a",
      "title": "成本报价",
      "requirements": [
        {
          "text": "估算实施成本，给出报价区间。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "报价区间参考近 2 年同类项目",
          "source": "你"
        },
        {
          "text": "示例 · 客户资料与对外文案使用中文",
          "source": "项目指令"
        }
      ],
      "tests": [
        {
          "id": "t1",
          "text": "成本每一项有工时或采购依据",
          "type": "evidence",
          "result": "unprocessed",
          "source": "你"
        },
        {
          "id": "t2",
          "text": "财务认可报价区间",
          "type": "judgment",
          "result": "unprocessed",
          "source": "你"
        }
      ],
      "deliverables": [
        "Markdown 报价说明与 CSV 成本明细：evidence/c1c/成本与报价.md、evidence/c1c/成本明细.csv"
      ],
      "sources": [
        {
          "path": "experience/projects/P-2024-07/ 报价、工时与采购记录",
          "note": "示例资料"
        },
        {
          "path": "experience/projects/P-2025-01/ 报价、工时与采购记录",
          "note": "示例资料"
        },
        {
          "path": "内部人力成本与采购价目表",
          "note": "示例资料"
        },
        {
          "path": "git:5b76bcd:prototype/index.html#a-cost",
          "note": "v4 原型快照，状态、预算与成员安排为示例"
        }
      ],
      "dependencies": [
        "a-clarify"
      ],
      "groups": [
        "承接评估"
      ],
      "parentId": null,
      "memberId": "member-a-cost",
      "budget": 20,
      "spent": 1.2,
      "budgetNote": "示例 · 非真实账单",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "估算实施成本，给出报价区间。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "报价区间参考近 2 年同类项目",
              "source": "你"
            },
            {
              "text": "示例 · 客户资料与对外文案使用中文",
              "source": "项目指令"
            }
          ],
          "tests": [
            {
              "id": "t1",
              "text": "成本每一项有工时或采购依据",
              "type": "evidence",
              "result": "unprocessed",
              "source": "你"
            },
            {
              "id": "t2",
              "text": "财务认可报价区间",
              "type": "judgment",
              "result": "unprocessed",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 0,
      "outputHistory": [],
      "upstreamChanged": false,
      "usedUpstreamVersions": {
        "a-clarify": 1
      },
      "statusLine": "示例 · 成员正在处理",
      "status": "running",
      "attempts": [
        {
          "number": 1,
          "actor": "agent-finance",
          "model": "opus-5.5 · high",
          "method": "参考近两年同类项目，逐项汇总工时、采购与毛利区间",
          "result": "running",
          "failure": "",
          "tokens": 12300,
          "duration": "53 分钟",
          "sessionId": "未记录",
          "sourceFiles": null,
          "passed": null,
          "total": null,
          "score": null,
          "endReason": null,
          "continuation": "续接原会话",
          "cost": 1.2,
          "metadataNote": "快照分支、计划版本、步骤汇总与花费为示例；真实来源记录未记载的模型、token、会话不补造。",
          "steps": [
            {
              "id": "cost-prepare",
              "title": "整理报价草稿",
              "status": "pass",
              "reason": "示例 · 内部草稿完成，未对外发送",
              "input": "资源台账与批准的毛利边界",
              "output": {
                "summary": "内部报价草稿 v1"
              },
              "cost": 1.2
            },
            {
              "id": "cost-approval",
              "title": "报价对外发送前人工关卡",
              "status": "unprocessed",
              "reason": "示例 · 已到人工关卡，等待你批准指定内容",
              "input": "内部报价草稿 v1",
              "output": {
                "summary": "尚未批准；不会实际发送"
              },
              "cost": 0
            }
          ]
        }
      ],
      "example": true,
      "recordNote": "示例 · 全卡为模拟数据",
      "independentVerification": null
    },
    "a-market": {
      "id": "a-market",
      "projectId": "project-a",
      "title": "市场调研",
      "requirements": [
        {
          "text": "调研离散制造智能排产的主要竞品与市场规模，区分已确认数据、估算口径及资料时效，给承接判断提供市场依据。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "只引用公开资料与内部已有报告，不采购付费报告",
          "source": "你"
        },
        {
          "text": "市场规模必须注明年份、地区与统计口径；过期资料标明风险",
          "source": "你"
        },
        {
          "text": "示例 · 客户资料与对外文案使用中文",
          "source": "项目指令"
        }
      ],
      "tests": [
        {
          "id": "t1",
          "text": "主要竞品的能力、定位与公开报价都有可追溯来源",
          "type": "evidence",
          "result": "unprocessed",
          "source": "你"
        },
        {
          "id": "t2",
          "text": "市场规模注明年份、地区、统计口径及资料时效",
          "type": "evidence",
          "result": "unprocessed",
          "source": "你"
        },
        {
          "id": "t3",
          "text": "你确认市场依据足以用于承接判断",
          "type": "judgment",
          "result": "unprocessed",
          "source": "你"
        }
      ],
      "deliverables": [
        "Markdown 市场调研报告与 CSV 竞品对照表：evidence/c1d/市场调研.md、evidence/c1d/竞品对照.csv"
      ],
      "sources": [
        {
          "path": "experience/market/2025-智能排产行业报告.md（可能过期）",
          "note": "示例资料"
        },
        {
          "path": "竞品官网公开产品资料",
          "note": "示例资料"
        },
        {
          "path": "公开行业协会统计与研究报告",
          "note": "示例资料"
        },
        {
          "path": "git:5b76bcd:prototype/index.html#a-market",
          "note": "v4 原型快照，状态、预算与成员安排为示例"
        }
      ],
      "dependencies": [
        "a-clarify"
      ],
      "groups": [
        "承接评估"
      ],
      "parentId": null,
      "memberId": "member-a-market",
      "budget": 20,
      "spent": 12.2,
      "budgetNote": "示例 · 非真实账单",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "调研离散制造智能排产的主要竞品与市场规模，区分已确认数据、估算口径及资料时效，给承接判断提供市场依据。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "只引用公开资料与内部已有报告，不采购付费报告",
              "source": "你"
            },
            {
              "text": "市场规模必须注明年份、地区与统计口径；过期资料标明风险",
              "source": "你"
            },
            {
              "text": "示例 · 客户资料与对外文案使用中文",
              "source": "项目指令"
            }
          ],
          "tests": [
            {
              "id": "t1",
              "text": "主要竞品的能力、定位与公开报价都有可追溯来源",
              "type": "evidence",
              "result": "unprocessed",
              "source": "你"
            },
            {
              "id": "t2",
              "text": "市场规模注明年份、地区、统计口径及资料时效",
              "type": "evidence",
              "result": "unprocessed",
              "source": "你"
            },
            {
              "id": "t3",
              "text": "你确认市场依据足以用于承接判断",
              "type": "judgment",
              "result": "unprocessed",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 0,
      "outputHistory": [],
      "upstreamChanged": false,
      "usedUpstreamVersions": {
        "a-clarify": 1
      },
      "statusLine": "示例 · 等待项目负责人处理",
      "status": "paused",
      "attempts": [
        {
          "number": 1,
          "actor": "agent-market",
          "model": "opus-5.5 · high",
          "method": "从 2025 年行业报告建立基线，检索竞品官网并交叉核对最新统计",
          "result": "limit",
          "failure": "token 已用 12000 / 12000，最新市场规模与报价核对未完成",
          "tokens": 12000,
          "duration": "1 小时 40 分钟",
          "sessionId": "未记录",
          "sourceFiles": null,
          "passed": null,
          "total": null,
          "score": null,
          "endReason": "达到上限",
          "continuation": "续接原会话",
          "cost": 12.2,
          "metadataNote": "快照分支、计划版本、步骤汇总与花费为示例；真实来源记录未记载的模型、token、会话不补造。",
          "steps": [
            {
              "id": "market-enumerate",
              "title": "枚举检索来源",
              "status": "pass",
              "reason": "示例 · 三个来源分支已固定",
              "input": "2025 年行业报告与竞品资料索引",
              "output": {
                "sources": [
                  "行业报告",
                  "竞品官网",
                  "报价与统计"
                ],
                "frozenBranches": 3
              },
              "cost": 0.8
            },
            {
              "id": "market-industry",
              "title": "行业报告检索",
              "status": "pass",
              "reason": "示例 · 允许资料已核对",
              "input": "2025 年行业报告",
              "output": {
                "summary": "已有市场基线；保留报告出处"
              },
              "cost": 3.2
            },
            {
              "id": "market-competitors",
              "title": "竞品官网检索",
              "status": "pass",
              "reason": "示例 · 三家竞品资料已保存",
              "input": "三家竞品官网",
              "output": {
                "summary": "三家竞品对照与来源索引"
              },
              "cost": 4.1
            },
            {
              "id": "market-pricing",
              "title": "最新统计与报价检索",
              "status": "unverifiable",
              "reason": "示例 · 已检索，但最新市场规模与报价缺少可交叉核对的证据",
              "input": "最新统计与报价页面",
              "output": {
                "summary": "证据不足，无法验证；不计入通过"
              },
              "cost": 4.1
            },
            {
              "id": "market-join",
              "title": "并行结果汇总",
              "status": "unprocessed",
              "reason": "示例 · token 12000/12000 与重新规划 2/2 已达上限，汇总未开始",
              "input": "三个分支的结构化结果",
              "output": {
                "summary": "尚未汇总；保留全部分支结果与异常"
              },
              "cost": 0
            }
          ]
        }
      ],
      "example": true,
      "recordNote": "示例 · 全卡为模拟数据",
      "independentVerification": null
    },
    "a-summary": {
      "id": "a-summary",
      "projectId": "project-a",
      "title": "汇总结论",
      "requirements": [
        {
          "text": "客户 A（离散制造，年产值约 8 亿）提出智能排产需求：根据订单、设备、人员自动生成周排产计划，并与其现有 ERP 同步。\n\n判断我们能否承接，给出结论：可行 / 有条件可行 / 不可行。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "只使用公开数据与内部资料",
          "source": "你"
        },
        {
          "text": "不直接联系客户",
          "source": "你"
        },
        {
          "text": "3 个工作日内给出结论（截止 10/10）",
          "source": "你"
        },
        {
          "text": "不承诺超出当前交付产能的上线时间",
          "source": "你"
        },
        {
          "text": "示例 · 客户资料与对外文案使用中文",
          "source": "项目指令"
        }
      ],
      "tests": [
        {
          "id": "t1",
          "text": "结论包含：结论、依据、风险、条件 四部分",
          "type": "deterministic",
          "result": "unprocessed",
          "source": "你"
        },
        {
          "id": "t2",
          "text": "每条依据可追溯至市场数据或过往项目编号",
          "type": "evidence",
          "result": "unprocessed",
          "source": "你"
        },
        {
          "id": "t3",
          "text": "独立审查质疑全部得到回应",
          "type": "adversarial",
          "result": "unprocessed",
          "source": "你"
        },
        {
          "id": "t4",
          "text": "技术 / 产能 / 成本 四个卡片均已验收，结论可对外沟通",
          "type": "judgment",
          "result": "unprocessed",
          "source": "你"
        }
      ],
      "deliverables": [
        "Markdown 承接评估报告：evidence/c1/承接评估.md（含结论、依据、风险、条件及卡片证据索引）"
      ],
      "sources": [
        {
          "path": "公开行业数据与企业官网",
          "note": "示例资料"
        },
        {
          "path": "experience/ 内部项目、基准与资源资料",
          "note": "示例资料"
        },
        {
          "path": "已批准的节点结论与证据",
          "note": "示例资料"
        },
        {
          "path": "git:5b76bcd:prototype/index.html#a-summary",
          "note": "v4 原型快照，状态、预算与成员安排为示例"
        }
      ],
      "dependencies": [
        "a-tech",
        "a-capacity",
        "a-cost",
        "a-market"
      ],
      "groups": [
        "承接评估"
      ],
      "parentId": null,
      "memberId": "member-a-summary",
      "budget": 20,
      "spent": 0,
      "budgetNote": "示例 · 非真实账单",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "客户 A（离散制造，年产值约 8 亿）提出智能排产需求：根据订单、设备、人员自动生成周排产计划，并与其现有 ERP 同步。\n\n判断我们能否承接，给出结论：可行 / 有条件可行 / 不可行。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "只使用公开数据与内部资料",
              "source": "你"
            },
            {
              "text": "不直接联系客户",
              "source": "你"
            },
            {
              "text": "3 个工作日内给出结论（截止 10/10）",
              "source": "你"
            },
            {
              "text": "不承诺超出当前交付产能的上线时间",
              "source": "你"
            },
            {
              "text": "示例 · 客户资料与对外文案使用中文",
              "source": "项目指令"
            }
          ],
          "tests": [
            {
              "id": "t1",
              "text": "结论包含：结论、依据、风险、条件 四部分",
              "type": "deterministic",
              "result": "unprocessed",
              "source": "你"
            },
            {
              "id": "t2",
              "text": "每条依据可追溯至市场数据或过往项目编号",
              "type": "evidence",
              "result": "unprocessed",
              "source": "你"
            },
            {
              "id": "t3",
              "text": "独立审查质疑全部得到回应",
              "type": "adversarial",
              "result": "unprocessed",
              "source": "你"
            },
            {
              "id": "t4",
              "text": "技术 / 产能 / 成本 四个卡片均已验收，结论可对外沟通",
              "type": "judgment",
              "result": "unprocessed",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 0,
      "outputHistory": [],
      "upstreamChanged": false,
      "usedUpstreamVersions": {
        "a-tech": 1,
        "a-capacity": 1,
        "a-cost": 1,
        "a-market": 1
      },
      "statusLine": "示例 · 等待后续安排",
      "status": "ready",
      "attempts": [],
      "example": true,
      "recordNote": "示例 · 全卡为模拟数据",
      "independentVerification": null
    },
    "a-delivery": {
      "id": "a-delivery",
      "projectId": "project-a",
      "title": "交付",
      "requirements": [
        {
          "text": "在现有产品中新增「排产看板」：展示周排产计划（设备 × 时间甘特图），支持手动拖拽调整，并从 ERP 单向导入工单。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "首期不含 ERP 双向同步",
          "source": "你"
        },
        {
          "text": "复用调度引擎 v3，不修改 engine/ 目录",
          "source": "你"
        },
        {
          "text": "不新增第三方依赖（甘特图用现有图表库）",
          "source": "你"
        },
        {
          "text": "页面首屏加载 < 2s（200 台设备）",
          "source": "你"
        },
        {
          "text": "示例 · 客户资料与对外文案使用中文",
          "source": "项目指令"
        }
      ],
      "tests": [
        {
          "id": "t1",
          "text": "单元测试与 CI 全部通过",
          "type": "deterministic",
          "result": "unprocessed",
          "source": "你"
        },
        {
          "id": "t2",
          "text": "diff 未触及 engine/ 目录，package.json 无新增依赖",
          "type": "deterministic",
          "result": "unprocessed",
          "source": "你"
        },
        {
          "id": "t3",
          "text": "200 台设备场景首屏 < 2s，附性能测试截图",
          "type": "evidence",
          "result": "unprocessed",
          "source": "你"
        },
        {
          "id": "t4",
          "text": "独立审查针对拖拽冲突、空数据、超大数据给出用例并全部通过",
          "type": "adversarial",
          "result": "unprocessed",
          "source": "你"
        },
        {
          "id": "t5",
          "text": "你在预览环境中验收交互",
          "type": "judgment",
          "result": "unprocessed",
          "source": "你"
        }
      ],
      "deliverables": [
        "代码补丁与 Markdown 交付说明：evidence/c2/排产看板.patch、evidence/c2/交付说明.md；验证证据：evidence/c2/测试证据/"
      ],
      "sources": [
        {
          "path": "现有产品仓库与 CONTRIBUTING.md",
          "note": "示例资料"
        },
        {
          "path": "调度引擎 v3 接口文档",
          "note": "示例资料"
        },
        {
          "path": "c1 / c1a 已验收结论与边界",
          "note": "示例资料"
        },
        {
          "path": "现有图表库官方文档",
          "note": "示例资料"
        },
        {
          "path": "git:5b76bcd:prototype/index.html#a-delivery",
          "note": "v4 原型快照，状态、预算与成员安排为示例"
        }
      ],
      "dependencies": [
        "a-summary"
      ],
      "groups": [
        "承接评估"
      ],
      "parentId": null,
      "memberId": "member-a-delivery",
      "budget": 20,
      "spent": 0,
      "budgetNote": "示例 · 非真实账单",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "在现有产品中新增「排产看板」：展示周排产计划（设备 × 时间甘特图），支持手动拖拽调整，并从 ERP 单向导入工单。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "首期不含 ERP 双向同步",
              "source": "你"
            },
            {
              "text": "复用调度引擎 v3，不修改 engine/ 目录",
              "source": "你"
            },
            {
              "text": "不新增第三方依赖（甘特图用现有图表库）",
              "source": "你"
            },
            {
              "text": "页面首屏加载 < 2s（200 台设备）",
              "source": "你"
            },
            {
              "text": "示例 · 客户资料与对外文案使用中文",
              "source": "项目指令"
            }
          ],
          "tests": [
            {
              "id": "t1",
              "text": "单元测试与 CI 全部通过",
              "type": "deterministic",
              "result": "unprocessed",
              "source": "你"
            },
            {
              "id": "t2",
              "text": "diff 未触及 engine/ 目录，package.json 无新增依赖",
              "type": "deterministic",
              "result": "unprocessed",
              "source": "你"
            },
            {
              "id": "t3",
              "text": "200 台设备场景首屏 < 2s，附性能测试截图",
              "type": "evidence",
              "result": "unprocessed",
              "source": "你"
            },
            {
              "id": "t4",
              "text": "独立审查针对拖拽冲突、空数据、超大数据给出用例并全部通过",
              "type": "adversarial",
              "result": "unprocessed",
              "source": "你"
            },
            {
              "id": "t5",
              "text": "你在预览环境中验收交互",
              "type": "judgment",
              "result": "unprocessed",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 0,
      "outputHistory": [],
      "upstreamChanged": false,
      "usedUpstreamVersions": {
        "a-summary": 1
      },
      "statusLine": "示例 · 等待后续安排",
      "status": "draft",
      "attempts": [],
      "example": true,
      "recordNote": "示例 · 全卡为模拟数据",
      "independentVerification": null
    },
    "a-decline": {
      "id": "a-decline",
      "projectId": "project-a",
      "title": "不承接",
      "requirements": [
        {
          "text": "若评估不可行，形成说明原因和证据的婉拒说明草稿；由你决定是否对外发送。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "只形成草稿，不对外发送",
          "source": "你"
        },
        {
          "text": "示例 · 客户资料与对外文案使用中文",
          "source": "项目指令"
        }
      ],
      "tests": [
        {
          "id": "t1",
          "text": "每项原因引用已验收的评估证据",
          "type": "evidence",
          "result": "unprocessed",
          "source": "你"
        },
        {
          "id": "t2",
          "text": "你确认说明的语气和结论",
          "type": "judgment",
          "result": "unprocessed",
          "source": "你"
        }
      ],
      "deliverables": [
        "Markdown 婉拒说明草稿：交付目录/客户A/婉拒说明.md"
      ],
      "sources": [
        {
          "path": "已验收的承接结论和依据",
          "note": "示例资料"
        },
        {
          "path": "git:5b76bcd:prototype/index.html#a-decline",
          "note": "v4 原型快照，状态、预算与成员安排为示例"
        }
      ],
      "dependencies": [
        "a-summary"
      ],
      "groups": [
        "承接评估"
      ],
      "parentId": null,
      "memberId": "member-a-decline",
      "budget": 20,
      "spent": 0,
      "budgetNote": "示例 · 非真实账单",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "若评估不可行，形成说明原因和证据的婉拒说明草稿；由你决定是否对外发送。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "只形成草稿，不对外发送",
              "source": "你"
            },
            {
              "text": "示例 · 客户资料与对外文案使用中文",
              "source": "项目指令"
            }
          ],
          "tests": [
            {
              "id": "t1",
              "text": "每项原因引用已验收的评估证据",
              "type": "evidence",
              "result": "unprocessed",
              "source": "你"
            },
            {
              "id": "t2",
              "text": "你确认说明的语气和结论",
              "type": "judgment",
              "result": "unprocessed",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 0,
      "outputHistory": [],
      "upstreamChanged": false,
      "usedUpstreamVersions": {
        "a-summary": 1
      },
      "statusLine": "示例 · 等待后续安排",
      "status": "cancelled",
      "attempts": [],
      "example": true,
      "recordNote": "示例 · 全卡为模拟数据",
      "independentVerification": null
    },
    "b-spec": {
      "id": "b-spec",
      "projectId": "project-b",
      "title": "v2 功能规格",
      "requirements": [
        {
          "text": "在 Helm 单文件原型中实现强制/建议边界、交付物/资料来源/上限、达到上限、交接记录、执行记录、无法判定与人工判定、验收后保存模板、执行代理启动 prompt。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "只改原型、任务证据与报告；零外部依赖，无构建步骤",
          "source": "你"
        },
        {
          "text": "示例 · 界面文字使用中文；保持单文件、零外部依赖",
          "source": "项目指令"
        }
      ],
      "tests": [
        {
          "id": "t1",
          "text": "任务 001 的 8 项改进与验收条件完整",
          "type": "evidence",
          "result": "pass",
          "source": "你"
        }
      ],
      "deliverables": [
        "任务说明：tasks/001-prototype-v2.md"
      ],
      "sources": [
        {
          "path": "tasks/001-prototype-v2.md",
          "note": "真实任务记录"
        },
        {
          "path": "evidence/001/report.md",
          "note": "真实任务记录"
        },
        {
          "path": "tasks/001-rework-1.md",
          "note": "真实任务记录"
        },
        {
          "path": "tasks/002-prototype-v2-browser-check.md",
          "note": "真实任务记录"
        },
        {
          "path": "tasks/002-recheck-1.md",
          "note": "真实任务记录"
        },
        {
          "path": "git:5b76bcd:prototype/index.html#b-spec",
          "note": "v4 原型快照，状态、预算与成员安排为示例"
        },
        {
          "path": "tasks/001-report.md",
          "note": "真实首次实现记录"
        },
        {
          "path": "tasks/001-rework-1-report.md",
          "note": "真实颜色返工记录"
        },
        {
          "path": "git:661c858",
          "note": "真实产出 v1 对应提交"
        },
        {
          "path": "git:eeac9ad",
          "note": "真实产出 v2 对应提交"
        }
      ],
      "dependencies": [],
      "groups": [
        "设计"
      ],
      "parentId": null,
      "memberId": "member-b-spec",
      "budget": 20,
      "spent": 2,
      "budgetNote": "示例 · 非真实账单",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "在 Helm 单文件原型中实现强制/建议边界、交付物/资料来源/上限、达到上限、交接记录、执行记录、无法判定与人工判定、验收后保存模板、执行代理启动 prompt。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "只改原型、任务证据与报告；零外部依赖，无构建步骤",
              "source": "你"
            },
            {
              "text": "示例 · 界面文字使用中文；保持单文件、零外部依赖",
              "source": "项目指令"
            }
          ],
          "tests": [
            {
              "id": "t1",
              "text": "任务 001 的 8 项改进与验收条件完整",
              "type": "evidence",
              "result": "pass",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 2,
      "outputHistory": [
        {
          "version": 1,
          "summary": "--ok 为 #1f8a4c",
          "sources": [
            "tasks/001-prototype-v2.md",
            "git:661c858"
          ],
          "example": false
        },
        {
          "version": 2,
          "summary": "--ok 改为 #1f874c，白字不变",
          "sources": [
            "tasks/001-rework-1.md",
            "tasks/001-rework-1-report.md",
            "git:eeac9ad"
          ],
          "example": false
        }
      ],
      "upstreamChanged": false,
      "usedUpstreamVersions": {},
      "statusLine": "示例 · 产出已验收",
      "status": "accepted",
      "attempts": [
        {
          "number": 1,
          "actor": "研发项目经理",
          "model": "未记录",
          "method": "读取任务 001 功能规格与验收条件",
          "result": "success",
          "failure": "",
          "tokens": null,
          "duration": "未记录",
          "sessionId": "未记录",
          "sourceFiles": [
            "tasks/001-prototype-v2.md"
          ],
          "passed": null,
          "total": null,
          "score": null,
          "endReason": "完成",
          "continuation": "续接原会话",
          "cost": 2,
          "metadataNote": "快照分支、计划版本、步骤汇总与花费为示例；真实来源记录未记载的模型、token、会话不补造。",
          "steps": []
        }
      ],
      "example": false,
      "recordNote": "颜色变更与产出 v1 → v2 来自真实任务 001 及返工记录；当前状态、责任配置、预算与规格快照为示例。",
      "independentVerification": null
    },
    "b-implement": {
      "id": "b-implement",
      "projectId": "project-b",
      "title": "实现",
      "requirements": [
        {
          "text": "按任务 001 实现原型 v2，再修复浏览器初检暴露的窄屏挤压与深色实色按钮文字对比度不足。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "单文件、内联 CSS 与 JS、零外部依赖",
          "source": "你"
        },
        {
          "text": "沿用现有视觉风格与变量",
          "source": "你"
        },
        {
          "text": "示例 · 界面文字使用中文；保持单文件、零外部依赖",
          "source": "项目指令"
        }
      ],
      "tests": [
        {
          "id": "t1",
          "text": "任务 001 的 T1–T7 全部通过",
          "type": "deterministic",
          "result": "pass",
          "source": "你"
        },
        {
          "id": "t2",
          "text": "深浅两模式六种实色组合对比度均 ≥ 4.5:1",
          "type": "evidence",
          "result": "pass",
          "source": "你"
        }
      ],
      "deliverables": [
        "prototype/index.html；实现报告 evidence/001/report.md"
      ],
      "sources": [
        {
          "path": "tasks/001-prototype-v2.md",
          "note": "真实任务记录"
        },
        {
          "path": "evidence/001/report.md",
          "note": "真实任务记录"
        },
        {
          "path": "tasks/001-rework-1.md",
          "note": "真实任务记录"
        },
        {
          "path": "tasks/002-prototype-v2-browser-check.md",
          "note": "真实任务记录"
        },
        {
          "path": "tasks/002-recheck-1.md",
          "note": "真实任务记录"
        },
        {
          "path": "git:5b76bcd:prototype/index.html#b-implement",
          "note": "v4 原型快照，状态、预算与成员安排为示例"
        },
        {
          "path": "git:661c858",
          "note": "首次实现"
        },
        {
          "path": "git:eeac9ad",
          "note": "返工修复"
        }
      ],
      "dependencies": [
        "b-spec"
      ],
      "groups": [
        "开发"
      ],
      "parentId": null,
      "memberId": "member-b-implement",
      "budget": 20,
      "spent": 4.4,
      "budgetNote": "示例 · 非真实账单",
      "specVersion": 2,
      "specHistory": [
        {
          "version": 2,
          "requirements": [
            {
              "text": "按任务 001 实现原型 v2，再修复浏览器初检暴露的窄屏挤压与深色实色按钮文字对比度不足。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "单文件、内联 CSS 与 JS、零外部依赖",
              "source": "你"
            },
            {
              "text": "沿用现有视觉风格与变量",
              "source": "你"
            },
            {
              "text": "示例 · 界面文字使用中文；保持单文件、零外部依赖",
              "source": "项目指令"
            }
          ],
          "tests": [
            {
              "id": "t1",
              "text": "任务 001 的 T1–T7 全部通过",
              "type": "deterministic",
              "result": "pass",
              "source": "你"
            },
            {
              "id": "t2",
              "text": "深浅两模式六种实色组合对比度均 ≥ 4.5:1",
              "type": "evidence",
              "result": "pass",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 1,
      "outputHistory": [
        {
          "version": 1,
          "summary": "示例 · 保留交付产出",
          "sources": [
            "tasks/001-prototype-v2.md",
            "evidence/001/report.md",
            "tasks/001-rework-1.md",
            "tasks/002-prototype-v2-browser-check.md",
            "tasks/002-recheck-1.md",
            "git:5b76bcd:prototype/index.html#b-implement",
            "git:661c858",
            "git:eeac9ad"
          ],
          "example": true
        }
      ],
      "upstreamChanged": true,
      "usedUpstreamVersions": {
        "b-spec": 1
      },
      "statusLine": "示例 · 产出已验收",
      "status": "accepted",
      "attempts": [
        {
          "number": 1,
          "actor": "前端工程师 · Codex CLI",
          "model": "未记录",
          "method": "实现任务 001 的 8 项改进，并执行 Node 断言与脚本语法检查",
          "result": "failed",
          "failure": "浏览器初检发现窄屏正文挤压、深色实心按钮文字对比度不足",
          "tokens": null,
          "duration": "未记录",
          "sessionId": "未记录",
          "sourceFiles": [
            "tasks/001-report.md",
            "evidence/001/report.md",
            "tasks/002-report.md"
          ],
          "passed": null,
          "total": null,
          "score": null,
          "endReason": "验证失败",
          "continuation": "新会话带失败摘要",
          "cost": 2,
          "metadataNote": "快照分支、计划版本、步骤汇总与花费为示例；真实来源记录未记载的模型、token、会话不补造。",
          "steps": []
        },
        {
          "number": 2,
          "actor": "前端工程师 · Codex CLI",
          "model": "未记录",
          "method": "窄屏正文占满整行；新增实色按钮前景变量；经批准将浅色 --ok 从 #1f8a4c 调整为 #1f874c",
          "result": "success",
          "failure": "",
          "tokens": null,
          "duration": "未记录",
          "sessionId": "未记录",
          "sourceFiles": [
            "tasks/001-rework-1.md",
            "tasks/001-rework-1-report.md",
            "evidence/001/report.md"
          ],
          "passed": null,
          "total": null,
          "score": null,
          "endReason": "完成",
          "continuation": "续接原会话",
          "cost": 2.4,
          "metadataNote": "快照分支、计划版本、步骤汇总与花费为示例；真实来源记录未记载的模型、token、会话不补造。",
          "steps": []
        }
      ],
      "example": false,
      "recordNote": "示例 · 当前状态、责任配置、预算与初始规格/产出版本为演示映射；内容与资料来自真实记录。",
      "independentVerification": null,
      "upstreamChangeNote": "v2 功能规格产出 v1 → v2；示例 · 项目负责人判断不受影响，保留已验收产出。"
    },
    "b-browser": {
      "id": "b-browser",
      "projectId": "project-b",
      "title": "浏览器检查",
      "requirements": [
        {
          "text": "按 S01–S11 检查原型，保存场景截图、逐条断言和控制台结果；初检缺陷退回实现，纠正写错的 S03 检查要求后复检。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "浏览器检查不修改原型代码，不覆盖初检证据",
          "source": "你"
        },
        {
          "text": "示例 · 界面文字使用中文；保持单文件、零外部依赖",
          "source": "项目指令"
        }
      ],
      "tests": [
        {
          "id": "t1",
          "text": "复检 38 条断言全部通过",
          "type": "deterministic",
          "result": "pass",
          "source": "你"
        },
        {
          "id": "t2",
          "text": "S01–S11 的检查结论都有对应截图与报告",
          "type": "evidence",
          "result": "pass",
          "source": "你"
        },
        {
          "id": "t3",
          "text": "你确认可以进入最终审核",
          "type": "judgment",
          "result": "unprocessed",
          "source": "你"
        }
      ],
      "deliverables": [
        "evidence/002/assertions.txt；evidence/002/recheck-1/assertions.txt；对应场景截图与报告"
      ],
      "sources": [
        {
          "path": "tasks/001-prototype-v2.md",
          "note": "真实任务记录"
        },
        {
          "path": "evidence/001/report.md",
          "note": "真实任务记录"
        },
        {
          "path": "tasks/001-rework-1.md",
          "note": "真实任务记录"
        },
        {
          "path": "tasks/002-prototype-v2-browser-check.md",
          "note": "真实任务记录"
        },
        {
          "path": "tasks/002-recheck-1.md",
          "note": "真实任务记录"
        },
        {
          "path": "git:5b76bcd:prototype/index.html#b-browser",
          "note": "v4 原型快照，状态、预算与成员安排为示例"
        },
        {
          "path": "tasks/002-report.md",
          "note": "初检 31/34"
        },
        {
          "path": "tasks/002-recheck-1-report.md",
          "note": "复检 38/38；S03 断言纠正"
        },
        {
          "path": "git:34fb658",
          "note": "复检证据提交"
        }
      ],
      "dependencies": [
        "b-implement"
      ],
      "groups": [
        "开发"
      ],
      "parentId": null,
      "memberId": "member-b-browser",
      "budget": 20,
      "spent": 4.4,
      "budgetNote": "示例 · 非真实账单",
      "specVersion": 2,
      "specHistory": [
        {
          "version": 2,
          "requirements": [
            {
              "text": "按 S01–S11 检查原型，保存场景截图、逐条断言和控制台结果；初检缺陷退回实现，纠正写错的 S03 检查要求后复检。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "浏览器检查不修改原型代码，不覆盖初检证据",
              "source": "你"
            },
            {
              "text": "示例 · 界面文字使用中文；保持单文件、零外部依赖",
              "source": "项目指令"
            }
          ],
          "tests": [
            {
              "id": "t1",
              "text": "复检 38 条断言全部通过",
              "type": "deterministic",
              "result": "pass",
              "source": "你"
            },
            {
              "id": "t2",
              "text": "S01–S11 的检查结论都有对应截图与报告",
              "type": "evidence",
              "result": "pass",
              "source": "你"
            },
            {
              "id": "t3",
              "text": "你确认可以进入最终审核",
              "type": "judgment",
              "result": "unprocessed",
              "source": "你"
            }
          ],
          "note": "S03 断言纠正：t2 只检查 method，t3 检查修正链；出处 tasks/002-recheck-1.md、evidence/002/recheck-1/report.md。版本号为示例映射。"
        }
      ],
      "outputVersion": 0,
      "outputHistory": [],
      "upstreamChanged": false,
      "usedUpstreamVersions": {
        "b-implement": 1
      },
      "statusLine": "示例 · 等待你验收",
      "status": "review",
      "attempts": [
        {
          "number": 1,
          "actor": "浏览器检查员",
          "model": "未记录",
          "method": "浏览器初检 S01–S11，按原任务要求核验",
          "result": "failed",
          "failure": "31/34：S10 深色按钮文字对比度 2.16:1；S11 正文列 59.3px、标题 3 行；S03 检查要求本身写错",
          "tokens": null,
          "duration": "未记录",
          "sessionId": "未记录",
          "sourceFiles": [
            "evidence/002/assertions.txt",
            "evidence/002/final-verification.txt",
            "tasks/002-report.md"
          ],
          "passed": 31,
          "total": 34,
          "score": "31/34",
          "endReason": "验证失败",
          "continuation": "只重做失败与未处理项",
          "cost": 2,
          "metadataNote": "检查条目及四态结果来自真实历史文件；快照、编排计划版本、步骤与花费为示例；未记录的模型、token、会话 ID 不补造。",
          "steps": [
            {
              "id": "browser-1-enumerate",
              "title": "枚举并冻结检查清单",
              "status": "pass",
              "reason": "真实来源：34 条历史断言已映射",
              "input": "evidence/002/assertions.txt",
              "output": {
                "itemCount": 34,
                "sourceFile": "evidence/002/assertions.txt",
                "frozen": true
              },
              "cost": 0.2
            },
            {
              "id": "browser-1-process",
              "title": "逐项处理检查",
              "status": "pass",
              "reason": "真实历史记录：所有检查项均已处理；处理完成不表示验证通过",
              "input": "冻结的 34 条检查清单",
              "output": {
                "processed": 34,
                "itemsHaveVerdict": true
              },
              "cost": 1.1
            },
            {
              "id": "browser-1-verify",
              "title": "逐项验证并汇总报告",
              "status": "fail",
              "reason": "真实历史检查结果：31/34；3 项失败分别保留",
              "input": "历史断言记录逐项结果",
              "output": {
                "pass": 31,
                "total": 34,
                "fail": 3,
                "evidenceFile": "evidence/002/assertions.txt"
              },
              "cost": 0.7
            }
          ]
        },
        {
          "number": 2,
          "actor": "浏览器检查员",
          "model": "未记录",
          "method": "纠正 S03：t2 只检查 method，t3 检查修正链；深浅模式六组对比度与窄屏原阈值复检",
          "result": "success",
          "failure": "",
          "tokens": null,
          "duration": "未记录",
          "sessionId": "未记录",
          "sourceFiles": [
            "tasks/002-recheck-1.md",
            "evidence/002/recheck-1/assertions.txt",
            "evidence/002/recheck-1/report.md"
          ],
          "passed": 38,
          "total": 38,
          "score": "38/38",
          "endReason": "完成",
          "continuation": "只重做失败与未处理项",
          "cost": 2.4,
          "metadataNote": "检查条目及四态结果来自真实历史文件；快照、编排计划版本、步骤与花费为示例；未记录的模型、token、会话 ID 不补造。",
          "steps": [
            {
              "id": "browser-2-enumerate",
              "title": "枚举并冻结检查清单",
              "status": "pass",
              "reason": "真实来源：38 条历史断言已映射",
              "input": "evidence/002/recheck-1/assertions.txt",
              "output": {
                "itemCount": 38,
                "sourceFile": "evidence/002/recheck-1/assertions.txt",
                "frozen": true
              },
              "cost": 0.2
            },
            {
              "id": "browser-2-process",
              "title": "逐项处理检查",
              "status": "pass",
              "reason": "真实历史记录：所有检查项均已处理；处理完成不表示验证通过",
              "input": "冻结的 38 条检查清单",
              "output": {
                "processed": 38,
                "itemsHaveVerdict": true
              },
              "cost": 1.3
            },
            {
              "id": "browser-2-verify",
              "title": "逐项验证并汇总报告",
              "status": "pass",
              "reason": "真实历史检查结果：38/38 全部通过",
              "input": "历史断言记录逐项结果",
              "output": {
                "pass": 38,
                "total": 38,
                "fail": 0,
                "evidenceFile": "evidence/002/recheck-1/assertions.txt"
              },
              "cost": 0.9
            }
          ]
        }
      ],
      "example": false,
      "recordNote": "示例 · 当前状态、责任配置、预算与初始规格/产出版本为演示映射；内容与资料来自真实记录。",
      "independentVerification": null
    },
    "b-prototype-a": {
      "id": "b-prototype-a",
      "projectId": "project-b",
      "title": "原型结构与术语迁移",
      "requirements": [
        {
          "text": "从原型 v2 迁移项目结构与术语；修改 prototype/index.html。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
          "source": "你"
        }
      ],
      "tests": [
        {
          "id": "b-prototype-a-proof",
          "text": "示例 · 交付物与任务要求逐项一致",
          "type": "evidence",
          "result": "pass",
          "source": "你"
        }
      ],
      "deliverables": [
        "prototype/index.html",
        "tasks/005-report.md"
      ],
      "sources": [
        {
          "path": "tasks/005-prototype-v4-a.md",
          "note": "真实记录"
        },
        {
          "path": "tasks/005-report.md",
          "note": "真实记录"
        },
        {
          "path": "tasks/006-report.md",
          "note": "真实记录"
        },
        {
          "path": "git:c19c484",
          "note": "真实记录"
        }
      ],
      "dependencies": [
        "b-implement"
      ],
      "groups": [
        "开发"
      ],
      "parentId": null,
      "memberId": "member-b-prototype-a",
      "budget": 15,
      "spent": 0,
      "budgetNote": "示例 · 未记录真实花费",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "从原型 v2 迁移项目结构与术语；修改 prototype/index.html。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
              "source": "你"
            }
          ],
          "tests": [
            {
              "id": "b-prototype-a-proof",
              "text": "示例 · 交付物与任务要求逐项一致",
              "type": "evidence",
              "result": "pass",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 1,
      "outputHistory": [
        {
          "version": 1,
          "summary": "示例 · 保留交付产出",
          "sources": [
            "tasks/005-prototype-v4-a.md",
            "tasks/005-report.md",
            "tasks/006-report.md",
            "git:c19c484"
          ],
          "example": true
        }
      ],
      "upstreamChanged": false,
      "usedUpstreamVersions": {
        "b-implement": 1
      },
      "statusLine": "示例 · 按历史记录展示当前阶段",
      "status": "integrated",
      "example": false,
      "recordNote": "示例 · 当前状态、责任配置、预算与初始规格/产出版本为演示映射；内容与资料来自真实记录。",
      "independentVerification": null,
      "attempts": []
    },
    "b-prototype-b": {
      "id": "b-prototype-b",
      "projectId": "project-b",
      "title": "原型执行记录与项目记忆",
      "requirements": [
        {
          "text": "加入执行编排、四态结果、尝试与项目记忆；同样修改 prototype/index.html。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
          "source": "你"
        }
      ],
      "tests": [
        {
          "id": "b-prototype-b-proof",
          "text": "示例 · 交付物与任务要求逐项一致",
          "type": "evidence",
          "result": "pass",
          "source": "你"
        }
      ],
      "deliverables": [
        "prototype/index.html",
        "tasks/007-report.md"
      ],
      "sources": [
        {
          "path": "tasks/007-prototype-v4-b.md",
          "note": "真实记录"
        },
        {
          "path": "tasks/007-report.md",
          "note": "真实记录"
        },
        {
          "path": "tasks/008-report.md",
          "note": "真实记录"
        },
        {
          "path": "git:04b8693",
          "note": "真实记录"
        },
        {
          "path": "tasks/009-prototype-v4-c.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/009-report.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/010-prototype-v4-c-browser-check.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/010-report.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/011-prototype-flow-graph.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/011-report.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/012-flow-graph-browser-check.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/012-report.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/013-node-detail-tabs.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/013-report.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/014-node-tabs-browser-check.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/014-report.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/015-report.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/015-sidebar-cleanup.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/016-report.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/016-sidebar-browser-check.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/017-report.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/017-visual-flow-editing.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/018-report.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        },
        {
          "path": "tasks/018-visual-editing-browser-check.md",
          "note": "后续原型任务档案；非本卡单次执行的产出"
        }
      ],
      "dependencies": [
        "b-prototype-a"
      ],
      "groups": [
        "开发"
      ],
      "parentId": null,
      "memberId": "member-b-prototype-b",
      "budget": 15,
      "spent": 0,
      "budgetNote": "示例 · 未记录真实花费",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "加入执行编排、四态结果、尝试与项目记忆；同样修改 prototype/index.html。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
              "source": "你"
            }
          ],
          "tests": [
            {
              "id": "b-prototype-b-proof",
              "text": "示例 · 交付物与任务要求逐项一致",
              "type": "evidence",
              "result": "pass",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 1,
      "outputHistory": [
        {
          "version": 1,
          "summary": "示例 · 保留交付产出",
          "sources": [
            "tasks/007-prototype-v4-b.md",
            "tasks/007-report.md",
            "tasks/008-report.md",
            "git:04b8693",
            "tasks/009-prototype-v4-c.md",
            "tasks/009-report.md",
            "tasks/010-prototype-v4-c-browser-check.md",
            "tasks/010-report.md",
            "tasks/011-prototype-flow-graph.md",
            "tasks/011-report.md",
            "tasks/012-flow-graph-browser-check.md",
            "tasks/012-report.md",
            "tasks/013-node-detail-tabs.md",
            "tasks/013-report.md",
            "tasks/014-node-tabs-browser-check.md",
            "tasks/014-report.md",
            "tasks/015-report.md",
            "tasks/015-sidebar-cleanup.md",
            "tasks/016-report.md",
            "tasks/016-sidebar-browser-check.md",
            "tasks/017-report.md",
            "tasks/017-visual-flow-editing.md",
            "tasks/018-report.md",
            "tasks/018-visual-editing-browser-check.md"
          ],
          "example": true
        }
      ],
      "upstreamChanged": false,
      "usedUpstreamVersions": {
        "b-prototype-a": 1
      },
      "statusLine": "示例 · 按历史记录展示当前阶段",
      "status": "integrated",
      "example": false,
      "recordNote": "示例 · 当前状态、责任配置、预算与初始规格/产出版本为演示映射；内容与资料来自真实记录。",
      "independentVerification": null,
      "attempts": []
    },
    "b-sandbox": {
      "id": "b-sandbox",
      "projectId": "project-b",
      "title": "Codex 沙箱设计",
      "requirements": [
        {
          "text": "按任务 004 实测记录设计目录约束；嵌套沙箱使数项结论未能确认，需要补测。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
          "source": "你"
        }
      ],
      "tests": [
        {
          "id": "b-sandbox-proof",
          "text": "示例 · 交付物与任务要求逐项一致",
          "type": "evidence",
          "result": "pass",
          "source": "你"
        }
      ],
      "deliverables": [
        "research/codex-cli-verification.md"
      ],
      "sources": [
        {
          "path": "tasks/004-verify-codex-cli.md",
          "note": "真实记录"
        },
        {
          "path": "tasks/004-report.md",
          "note": "真实记录"
        },
        {
          "path": "research/codex-cli-verification.md",
          "note": "真实记录"
        },
        {
          "path": "git:f097007",
          "note": "真实记录"
        }
      ],
      "dependencies": [],
      "groups": [
        "运行时设计"
      ],
      "parentId": null,
      "memberId": "member-b-sandbox",
      "budget": 15,
      "spent": 0,
      "budgetNote": "示例 · 未记录真实花费",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "按任务 004 实测记录设计目录约束；嵌套沙箱使数项结论未能确认，需要补测。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
              "source": "你"
            }
          ],
          "tests": [
            {
              "id": "b-sandbox-proof",
              "text": "示例 · 交付物与任务要求逐项一致",
              "type": "evidence",
              "result": "pass",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 1,
      "outputHistory": [
        {
          "version": 1,
          "summary": "示例 · 保留交付产出",
          "sources": [
            "tasks/004-verify-codex-cli.md",
            "tasks/004-report.md",
            "research/codex-cli-verification.md",
            "git:f097007"
          ],
          "example": true
        }
      ],
      "upstreamChanged": false,
      "usedUpstreamVersions": {},
      "statusLine": "示例 · 按历史记录展示当前阶段",
      "status": "accepted",
      "example": false,
      "recordNote": "示例 · 当前状态、责任配置、预算与初始规格/产出版本为演示映射；内容与资料来自真实记录。",
      "independentVerification": null,
      "attempts": []
    },
    "b-sandbox-recheck": {
      "id": "b-sandbox-recheck",
      "projectId": "project-b",
      "title": "Codex 沙箱补测",
      "requirements": [
        {
          "text": "在沙箱外补测只读、禁读、越界写入、钩子与缓存；保留未能确认项。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
          "source": "你"
        }
      ],
      "tests": [
        {
          "id": "b-sandbox-recheck-proof",
          "text": "示例 · 交付物与任务要求逐项一致",
          "type": "evidence",
          "result": "pass",
          "source": "出题的会话"
        }
      ],
      "deliverables": [
        "research/codex-sandbox-recheck.md"
      ],
      "sources": [
        {
          "path": "tasks/019-codex-sandbox-recheck.md",
          "note": "真实记录"
        },
        {
          "path": "tasks/019-report.md",
          "note": "真实记录"
        },
        {
          "path": "research/codex-sandbox-recheck.md",
          "note": "真实记录"
        },
        {
          "path": "git:6531332",
          "note": "真实记录"
        }
      ],
      "dependencies": [],
      "groups": [
        "运行时设计"
      ],
      "parentId": "b-sandbox",
      "memberId": "member-b-sandbox-recheck",
      "budget": 15,
      "spent": 0,
      "budgetNote": "示例 · 未记录真实花费",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "在沙箱外补测只读、禁读、越界写入、钩子与缓存；保留未能确认项。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
              "source": "你"
            }
          ],
          "tests": [
            {
              "id": "b-sandbox-recheck-proof",
              "text": "示例 · 交付物与任务要求逐项一致",
              "type": "evidence",
              "result": "pass",
              "source": "出题的会话"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 1,
      "outputHistory": [
        {
          "version": 1,
          "summary": "示例 · 保留交付产出",
          "sources": [
            "tasks/019-codex-sandbox-recheck.md",
            "tasks/019-report.md",
            "research/codex-sandbox-recheck.md",
            "git:6531332"
          ],
          "example": true
        }
      ],
      "upstreamChanged": false,
      "usedUpstreamVersions": {},
      "statusLine": "示例 · 按历史记录展示当前阶段",
      "status": "integrated",
      "example": false,
      "recordNote": "示例 · 当前状态、责任配置、预算与初始规格/产出版本为演示映射；内容与资料来自真实记录。",
      "independentVerification": null,
      "attempts": [
        {
          "number": 1,
          "actor": "Codex CLI",
          "model": "未记录",
          "method": "在沙箱外补测只读、禁读、越界写入、钩子与缓存；保留未能确认项。",
          "result": "success",
          "failure": "",
          "tokens": null,
          "duration": "未记录",
          "sessionId": "01a12b84-b3fc-7451-83df-bd60e4dfb1ef",
          "sourceFiles": [
            "tasks/019-codex-sandbox-recheck.md",
            "tasks/019-report.md",
            "research/codex-sandbox-recheck.md",
            "git:6531332"
          ],
          "cost": null,
          "steps": []
        }
      ]
    },
    "b-collaboration": {
      "id": "b-collaboration",
      "projectId": "project-b",
      "title": "v6 协作设计",
      "requirements": [
        {
          "text": "围绕共享看板与协作原语形成 v6 设计，调研结论回到父卡。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
          "source": "你"
        }
      ],
      "tests": [
        {
          "id": "b-collaboration-proof",
          "text": "示例 · 交付物与任务要求逐项一致",
          "type": "evidence",
          "result": "pass",
          "source": "你"
        }
      ],
      "deliverables": [
        "research/v6-design-draft.md",
        "git:756c7f7:FEATURES.md"
      ],
      "sources": [
        {
          "path": "research/v6-design-draft.md",
          "note": "真实记录"
        },
        {
          "path": "git:169ad12",
          "note": "真实记录"
        },
        {
          "path": "git:756c7f7",
          "note": "真实记录"
        }
      ],
      "dependencies": [],
      "groups": [
        "运行时设计",
        "设计"
      ],
      "parentId": null,
      "memberId": "member-b-collaboration",
      "budget": 15,
      "spent": 0,
      "budgetNote": "示例 · 未记录真实花费",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "围绕共享看板与协作原语形成 v6 设计，调研结论回到父卡。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
              "source": "你"
            }
          ],
          "tests": [
            {
              "id": "b-collaboration-proof",
              "text": "示例 · 交付物与任务要求逐项一致",
              "type": "evidence",
              "result": "pass",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 1,
      "outputHistory": [
        {
          "version": 1,
          "summary": "示例 · 保留交付产出",
          "sources": [
            "research/v6-design-draft.md",
            "git:169ad12",
            "git:756c7f7"
          ],
          "example": true
        }
      ],
      "upstreamChanged": false,
      "usedUpstreamVersions": {},
      "statusLine": "示例 · 按历史记录展示当前阶段",
      "status": "accepted",
      "example": false,
      "recordNote": "示例 · 当前状态、责任配置、预算与初始规格/产出版本为演示映射；内容与资料来自真实记录。",
      "independentVerification": null,
      "attempts": []
    },
    "b-agent-team": {
      "id": "b-agent-team",
      "projectId": "project-b",
      "title": "agent team 开源调研",
      "requirements": [
        {
          "text": "只调研开源协作方案、信箱、看板与信息流标签，不做 Codex 实测。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
          "source": "你"
        }
      ],
      "tests": [
        {
          "id": "b-agent-team-proof",
          "text": "示例 · 交付物与任务要求逐项一致",
          "type": "evidence",
          "result": "pass",
          "source": "出题的会话"
        }
      ],
      "deliverables": [
        "research/agent-team-oss.md"
      ],
      "sources": [
        {
          "path": "tasks/020-agent-team-oss-research.md",
          "note": "真实记录"
        },
        {
          "path": "tasks/020-report.md",
          "note": "真实记录"
        },
        {
          "path": "research/agent-team-oss.md",
          "note": "真实记录"
        },
        {
          "path": "git:7e84953",
          "note": "真实记录"
        }
      ],
      "dependencies": [],
      "groups": [
        "运行时设计",
        "调研"
      ],
      "parentId": "b-collaboration",
      "memberId": "member-b-agent-team",
      "budget": 15,
      "spent": 0,
      "budgetNote": "示例 · 未记录真实花费",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "只调研开源协作方案、信箱、看板与信息流标签，不做 Codex 实测。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
              "source": "你"
            }
          ],
          "tests": [
            {
              "id": "b-agent-team-proof",
              "text": "示例 · 交付物与任务要求逐项一致",
              "type": "evidence",
              "result": "pass",
              "source": "出题的会话"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 1,
      "outputHistory": [
        {
          "version": 1,
          "summary": "示例 · 保留交付产出",
          "sources": [
            "tasks/020-agent-team-oss-research.md",
            "tasks/020-report.md",
            "research/agent-team-oss.md",
            "git:7e84953"
          ],
          "example": true
        }
      ],
      "upstreamChanged": false,
      "usedUpstreamVersions": {},
      "statusLine": "示例 · 按历史记录展示当前阶段",
      "status": "integrated",
      "example": false,
      "recordNote": "示例 · 当前状态、责任配置、预算与初始规格/产出版本为演示映射；内容与资料来自真实记录。",
      "independentVerification": null,
      "attempts": [
        {
          "number": 1,
          "actor": "Codex CLI",
          "model": "未记录",
          "method": "只调研开源协作方案、信箱、看板与信息流标签，不做 Codex 实测。",
          "result": "success",
          "failure": "",
          "tokens": null,
          "duration": "未记录",
          "sessionId": "01a13029-7a46-7ad2-b77a-8f5b3018d583",
          "sourceFiles": [
            "tasks/020-agent-team-oss-research.md",
            "tasks/020-report.md",
            "research/agent-team-oss.md",
            "git:7e84953"
          ],
          "cost": null,
          "steps": []
        }
      ]
    },
    "b-ade": {
      "id": "b-ade",
      "projectId": "project-b",
      "title": "ADE 底层功能调研",
      "requirements": [
        {
          "text": "调研执行编排的十五种模式、受约束 JSON、恢复与幂等、Codex 映射。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
          "source": "你"
        }
      ],
      "tests": [
        {
          "id": "b-ade-proof",
          "text": "示例 · 交付物与任务要求逐项一致",
          "type": "evidence",
          "result": "pass",
          "source": "你"
        }
      ],
      "deliverables": [
        "research/workflow-templates.md"
      ],
      "sources": [
        {
          "path": "tasks/003-research-workflow-templates.md",
          "note": "真实记录"
        },
        {
          "path": "tasks/003-report.md",
          "note": "真实记录"
        },
        {
          "path": "research/workflow-templates.md",
          "note": "真实记录"
        },
        {
          "path": "git:7206fe4",
          "note": "真实记录"
        }
      ],
      "dependencies": [],
      "groups": [
        "调研"
      ],
      "parentId": null,
      "memberId": "member-b-ade",
      "budget": 15,
      "spent": 0,
      "budgetNote": "示例 · 未记录真实花费",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "调研执行编排的十五种模式、受约束 JSON、恢复与幂等、Codex 映射。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
              "source": "你"
            }
          ],
          "tests": [
            {
              "id": "b-ade-proof",
              "text": "示例 · 交付物与任务要求逐项一致",
              "type": "evidence",
              "result": "pass",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 1,
      "outputHistory": [
        {
          "version": 1,
          "summary": "示例 · 保留交付产出",
          "sources": [
            "tasks/003-research-workflow-templates.md",
            "tasks/003-report.md",
            "research/workflow-templates.md",
            "git:7206fe4"
          ],
          "example": true
        }
      ],
      "upstreamChanged": false,
      "usedUpstreamVersions": {},
      "statusLine": "示例 · 按历史记录展示当前阶段",
      "status": "integrated",
      "example": false,
      "recordNote": "示例 · 当前状态、责任配置、预算与初始规格/产出版本为演示映射；内容与资料来自真实记录。",
      "independentVerification": null,
      "attempts": []
    },
    "b-defect-diagnose": {
      "id": "b-defect-diagnose",
      "projectId": "project-b",
      "title": "窄屏溢出诊断",
      "requirements": [
        {
          "text": "示例 · 复现窄屏看板溢出并定位原因。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
          "source": "你"
        }
      ],
      "tests": [
        {
          "id": "b-defect-diagnose-proof",
          "text": "示例 · 交付物与任务要求逐项一致",
          "type": "evidence",
          "result": "unprocessed",
          "source": "你"
        }
      ],
      "deliverables": [
        "示例 · 窄屏诊断报告"
      ],
      "sources": [
        {
          "path": "示例 · 窄屏诊断报告",
          "note": "真实记录"
        }
      ],
      "dependencies": [],
      "groups": [
        "缺陷"
      ],
      "parentId": null,
      "memberId": "member-b-defect-diagnose",
      "budget": 15,
      "spent": 0,
      "budgetNote": "示例 · 未记录真实花费",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "示例 · 复现窄屏看板溢出并定位原因。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
              "source": "你"
            }
          ],
          "tests": [
            {
              "id": "b-defect-diagnose-proof",
              "text": "示例 · 交付物与任务要求逐项一致",
              "type": "evidence",
              "result": "unprocessed",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 0,
      "outputHistory": [],
      "upstreamChanged": false,
      "usedUpstreamVersions": {},
      "statusLine": "示例 · 按历史记录展示当前阶段",
      "status": "running",
      "example": true,
      "recordNote": "示例 · 全卡模拟",
      "independentVerification": null,
      "attempts": []
    },
    "b-defect-fix": {
      "id": "b-defect-fix",
      "projectId": "project-b",
      "title": "窄屏溢出修复",
      "requirements": [
        {
          "text": "示例 · 修复诊断指出的布局问题。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
          "source": "你"
        }
      ],
      "tests": [
        {
          "id": "b-defect-fix-proof",
          "text": "示例 · 交付物与任务要求逐项一致",
          "type": "evidence",
          "result": "unprocessed",
          "source": "你"
        }
      ],
      "deliverables": [
        "示例 · 布局差异"
      ],
      "sources": [
        {
          "path": "示例 · 布局差异",
          "note": "真实记录"
        }
      ],
      "dependencies": [
        "b-defect-diagnose"
      ],
      "groups": [
        "缺陷"
      ],
      "parentId": null,
      "memberId": "member-b-defect-fix",
      "budget": 15,
      "spent": 0,
      "budgetNote": "示例 · 未记录真实花费",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "示例 · 修复诊断指出的布局问题。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
              "source": "你"
            }
          ],
          "tests": [
            {
              "id": "b-defect-fix-proof",
              "text": "示例 · 交付物与任务要求逐项一致",
              "type": "evidence",
              "result": "unprocessed",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 0,
      "outputHistory": [],
      "upstreamChanged": false,
      "usedUpstreamVersions": {
        "b-defect-diagnose": 1
      },
      "statusLine": "示例 · 按历史记录展示当前阶段",
      "status": "ready",
      "example": true,
      "recordNote": "示例 · 全卡模拟",
      "independentVerification": null,
      "attempts": []
    },
    "b-defect-regression": {
      "id": "b-defect-regression",
      "projectId": "project-b",
      "title": "窄屏回归测试",
      "requirements": [
        {
          "text": "示例 · 验证修复后各宽度的布局。",
          "source": "你"
        }
      ],
      "boundaries": [
        {
          "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
          "source": "你"
        }
      ],
      "tests": [
        {
          "id": "b-defect-regression-proof",
          "text": "示例 · 交付物与任务要求逐项一致",
          "type": "evidence",
          "result": "unprocessed",
          "source": "你"
        }
      ],
      "deliverables": [
        "示例 · 回归证据"
      ],
      "sources": [
        {
          "path": "示例 · 回归证据",
          "note": "真实记录"
        }
      ],
      "dependencies": [
        "b-defect-fix"
      ],
      "groups": [
        "缺陷"
      ],
      "parentId": null,
      "memberId": "member-b-defect-regression",
      "budget": 15,
      "spent": 0,
      "budgetNote": "示例 · 未记录真实花费",
      "specVersion": 1,
      "specHistory": [
        {
          "version": 1,
          "requirements": [
            {
              "text": "示例 · 验证修复后各宽度的布局。",
              "source": "你"
            }
          ],
          "boundaries": [
            {
              "text": "示例 · 仅处理卡片所列范围；引用来源，不补造结论。",
              "source": "你"
            }
          ],
          "tests": [
            {
              "id": "b-defect-regression-proof",
              "text": "示例 · 交付物与任务要求逐项一致",
              "type": "evidence",
              "result": "unprocessed",
              "source": "你"
            }
          ],
          "note": "示例 · 初始迁移快照；原记录未保存更早规格逐条内容"
        }
      ],
      "outputVersion": 0,
      "outputHistory": [],
      "upstreamChanged": false,
      "usedUpstreamVersions": {
        "b-defect-fix": 1
      },
      "statusLine": "示例 · 按历史记录展示当前阶段",
      "status": "draft",
      "example": true,
      "recordNote": "示例 · 全卡模拟",
      "independentVerification": null,
      "attempts": []
    }
  },
  "members": {
    "member-a-clarify": {
      "id": "member-a-clarify",
      "agentId": "agent-pm-client",
      "cardId": "a-clarify",
      "name": "客户交付项目经理",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-a-tech": {
      "id": "member-a-tech",
      "agentId": "agent-tech",
      "cardId": "a-tech",
      "name": "技术评估员",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-a-capacity": {
      "id": "member-a-capacity",
      "agentId": "agent-capacity",
      "cardId": "a-capacity",
      "name": "交付规划员",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-a-cost": {
      "id": "member-a-cost",
      "agentId": "agent-finance",
      "cardId": "a-cost",
      "name": "财务测算员",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-a-market": {
      "id": "member-a-market",
      "agentId": "agent-market",
      "cardId": "a-market",
      "name": "市场调研员",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-a-summary": {
      "id": "member-a-summary",
      "agentId": "agent-pm-client",
      "cardId": "a-summary",
      "name": "客户交付项目经理",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-a-delivery": {
      "id": "member-a-delivery",
      "agentId": "agent-pm-client",
      "cardId": "a-delivery",
      "name": "客户交付项目经理",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-a-decline": {
      "id": "member-a-decline",
      "agentId": "agent-pm-client",
      "cardId": "a-decline",
      "name": "客户交付项目经理",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-b-spec": {
      "id": "member-b-spec",
      "agentId": "agent-pm-dev",
      "cardId": "b-spec",
      "name": "研发项目经理",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-b-implement": {
      "id": "member-b-implement",
      "agentId": "agent-frontend",
      "cardId": "b-implement",
      "name": "前端工程师",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-b-browser": {
      "id": "member-b-browser",
      "agentId": "agent-browser",
      "cardId": "b-browser",
      "name": "浏览器检查员",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-b-prototype-a": {
      "id": "member-b-prototype-a",
      "agentId": "agent-frontend",
      "cardId": "b-prototype-a",
      "name": "前端工程师",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-b-prototype-b": {
      "id": "member-b-prototype-b",
      "agentId": "agent-frontend",
      "cardId": "b-prototype-b",
      "name": "前端工程师",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-b-sandbox": {
      "id": "member-b-sandbox",
      "agentId": "agent-check",
      "cardId": "b-sandbox",
      "name": "通用核对员",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-b-sandbox-recheck": {
      "id": "member-b-sandbox-recheck",
      "agentId": "agent-check",
      "cardId": "b-sandbox-recheck",
      "name": "通用核对员",
      "sessionId": "01a12b84-b3fc-7451-83df-bd60e4dfb1ef",
      "note": "示例 · 责任配置"
    },
    "member-b-collaboration": {
      "id": "member-b-collaboration",
      "agentId": "agent-check",
      "cardId": "b-collaboration",
      "name": "通用核对员",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-b-agent-team": {
      "id": "member-b-agent-team",
      "agentId": "agent-check",
      "cardId": "b-agent-team",
      "name": "通用核对员",
      "sessionId": "01a13029-7a46-7ad2-b77a-8f5b3018d583",
      "note": "示例 · 责任配置"
    },
    "member-b-ade": {
      "id": "member-b-ade",
      "agentId": "agent-check",
      "cardId": "b-ade",
      "name": "通用核对员",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-b-defect-diagnose": {
      "id": "member-b-defect-diagnose",
      "agentId": "agent-frontend",
      "cardId": "b-defect-diagnose",
      "name": "前端工程师",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-b-defect-fix": {
      "id": "member-b-defect-fix",
      "agentId": "agent-frontend",
      "cardId": "b-defect-fix",
      "name": "前端工程师",
      "sessionId": null,
      "note": "示例 · 责任配置"
    },
    "member-b-defect-regression": {
      "id": "member-b-defect-regression",
      "agentId": "agent-frontend",
      "cardId": "b-defect-regression",
      "name": "前端工程师",
      "sessionId": null,
      "note": "示例 · 责任配置"
    }
  },
  "agents": [
    {
      "id": "agent-pm-client",
      "name": "客户交付项目经理",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6.1-sol",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "按节点授权",
      "strength": "ultra",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "承接评估、派单与交付协调",
      "mainModel": "gpt-6.1-sol",
      "mainStrength": "ultra",
      "stepModel": "gpt-6.1-sol",
      "stepStrength": "high",
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    },
    {
      "id": "agent-pm-dev",
      "name": "研发项目经理",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6.1-sol",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "按节点授权",
      "strength": "ultra",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "需求澄清、研发派单与交付协调",
      "mainModel": "gpt-6.1-sol",
      "mainStrength": "ultra",
      "stepModel": "gpt-6.1-sol",
      "stepStrength": "high",
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    },
    {
      "id": "agent-tech",
      "name": "技术评估员",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6.1-sol",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "按节点授权",
      "strength": "ultra",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "平台能力与 ERP 接口评估",
      "mainModel": "gpt-6.1-sol",
      "mainStrength": "ultra",
      "stepModel": "gpt-6.1-sol",
      "stepStrength": "high",
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    },
    {
      "id": "agent-capacity",
      "name": "交付规划员",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6.1-sol",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "按节点授权",
      "strength": "ultra",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "排期与人员占用测算",
      "mainModel": "gpt-6.1-sol",
      "mainStrength": "ultra",
      "stepModel": "gpt-6.1-sol",
      "stepStrength": "high",
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    },
    {
      "id": "agent-finance",
      "name": "财务测算员",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6.1-sol",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "按节点授权",
      "strength": "ultra",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "成本、报价与毛利测算",
      "mainModel": "gpt-6.1-sol",
      "mainStrength": "ultra",
      "stepModel": "gpt-6.1-sol",
      "stepStrength": "high",
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    },
    {
      "id": "agent-market",
      "name": "市场调研员",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6.1-sol",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "按节点授权",
      "strength": "ultra",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "公开市场资料检索与交叉核对",
      "mainModel": "gpt-6.1-sol",
      "mainStrength": "ultra",
      "stepModel": "gpt-6.1-sol",
      "stepStrength": "high",
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    },
    {
      "id": "agent-frontend",
      "name": "前端工程师",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6.1-sol",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "按节点授权",
      "strength": "ultra",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "单文件交互原型与布局修复",
      "mainModel": "gpt-6.1-sol",
      "mainStrength": "ultra",
      "stepModel": "gpt-6.1-sol",
      "stepStrength": "high",
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    },
    {
      "id": "agent-browser",
      "name": "浏览器检查员",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6.1-sol",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "按节点授权",
      "strength": "ultra",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "独立场景检查与证据整理",
      "mainModel": "gpt-6.1-sol",
      "mainStrength": "ultra",
      "stepModel": "gpt-6.1-sol",
      "stepStrength": "high",
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    },
    {
      "id": "agent-check",
      "name": "通用核对员",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6-astra",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "只读",
      "strength": "high",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "独立证据复核",
      "mainModel": "gpt-6-astra",
      "mainStrength": "high",
      "stepModel": null,
      "stepStrength": null,
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    },
    {
      "id": "agent-critic",
      "name": "风险审查员",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6-sol",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "只读",
      "strength": "high",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "对抗用例与风险挑错",
      "mainModel": "gpt-6-sol",
      "mainStrength": "high",
      "stepModel": null,
      "stepStrength": null,
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    }
  ],
  "experience": [
    {
      "id": "experience-1",
      "title": "示例 · 资料为空时保留无法验证",
      "content": "示例 · 检索为空不能证明事实不存在，应保留出处与不确定性。",
      "tags": [
        "证据",
        "调研"
      ],
      "cardId": "a-tech",
      "status": "已入库",
      "example": true
    },
    {
      "id": "exp-engine",
      "title": "示例 · 调度引擎 v3 的规模与基准",
      "content": "示例 · 官方规格 ≤ 200 台；250 台 × 4000 工单基准为 3.2 分钟。适用范围需分别核对。",
      "tags": [
        "技术",
        "基准"
      ],
      "sources": [
        "experience/specs/engine-v3.md",
        "experience/benchmarks/engine-v3-2025Q2.md#L40"
      ],
      "cardId": "a-tech",
      "projectIds": [
        "project-a"
      ],
      "status": "已入库",
      "example": true,
      "note": "来自 v4 示例资料"
    },
    {
      "id": "exp-order",
      "title": "示例 · P-2024-07 插单场景",
      "content": "示例 · 插单率 18% 场景下求解仍 < 6 分钟；技术评估须覆盖非理想化排产。",
      "tags": [
        "教训",
        "技术"
      ],
      "sources": [
        "experience/projects/P-2024-07/复盘.md"
      ],
      "cardId": "a-tech",
      "projectIds": [
        "project-a"
      ],
      "status": "已入库",
      "example": true,
      "note": "来自 v4 示例资料"
    },
    {
      "id": "exp-margin",
      "title": "示例 · 历史毛利与报价风险",
      "content": "示例 · P-2024-07、P-2025-01 历史毛利分别为 22%、19%；财务否决续签。毛利下限应先请求批准。",
      "tags": [
        "财务",
        "教训"
      ],
      "sources": [
        "experience/projects/P-2024-07/",
        "experience/projects/P-2025-01/"
      ],
      "cardId": "a-tech",
      "projectIds": [
        "project-a"
      ],
      "status": "已入库",
      "example": true,
      "note": "来自 v4 示例资料"
    },
    {
      "id": "exp-delay",
      "title": "示例 · P-2024-11 工期过度承诺",
      "content": "示例 · 过度承诺工期导致违约；承诺时间前先核对产能。",
      "tags": [
        "交付",
        "风险"
      ],
      "sources": [
        "experience/projects/P-2024-11/复盘.md"
      ],
      "cardId": "a-tech",
      "projectIds": [
        "project-a"
      ],
      "status": "已入库",
      "example": true,
      "note": "来自 v4 示例资料"
    },
    {
      "id": "exp-pending-browser",
      "title": "浏览器断言需对准测试对象",
      "content": "S03 的修正记录实际在 t3；测试要求错误纠正检查说明，避免错误退回实现。",
      "tags": [
        "检查",
        "教训"
      ],
      "sources": [
        "tasks/002-recheck-1.md"
      ],
      "cardId": "b-browser",
      "projectIds": [
        "project-b"
      ],
      "status": "待审核",
      "example": false,
      "note": "出处 tasks/002-recheck-1.md；审核状态为示例"
    }
  ],
  "decisions": [
    {
      "id": "seed-serial",
      "projectId": "project-b",
      "cardId": "b-prototype-b",
      "title": "示例 · 两张原型卡顺序执行",
      "reason": "两张卡都修改 prototype/index.html，后一张依赖前一张，避免文件冲突。任务说明与提交次序为真实资料；组织理由为示例。",
      "decisionMaker": "项目负责人",
      "time": "示例 · 初始记录",
      "outcome": "已记录"
    },
    {
      "id": "seed-upstream",
      "projectId": "project-b",
      "cardId": "b-implement",
      "title": "示例 · 上游更新后保留当前产出",
      "reason": "v2 功能规格产出 v1 → v2；示例 · 项目负责人判断不受影响，保留已验收产出。",
      "decisionMaker": "项目负责人",
      "time": "示例 · 初始记录",
      "outcome": "已记录"
    }
  ],
  "serial": 100,
  "agentTemplates": [
    {
      "id": "template-agent-pm-client",
      "name": "客户交付项目经理",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6.1-sol",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "按节点授权",
      "strength": "ultra",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "承接评估、派单与交付协调",
      "mainModel": "gpt-6.1-sol",
      "mainStrength": "ultra",
      "stepModel": "gpt-6.1-sol",
      "stepStrength": "high",
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    },
    {
      "id": "template-agent-pm-dev",
      "name": "研发项目经理",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6.1-sol",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "按节点授权",
      "strength": "ultra",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "需求澄清、研发派单与交付协调",
      "mainModel": "gpt-6.1-sol",
      "mainStrength": "ultra",
      "stepModel": "gpt-6.1-sol",
      "stepStrength": "high",
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    },
    {
      "id": "template-agent-tech",
      "name": "技术评估员",
      "instructions": "遵守节点批准的需求、边界与测试",
      "model": "gpt-6.1-sol",
      "tools": [
        "允许的资料读取"
      ],
      "permissions": "按节点授权",
      "strength": "ultra",
      "executor": "Codex CLI",
      "example": true,
      "tasks": "平台能力与 ERP 接口评估",
      "mainModel": "gpt-6.1-sol",
      "mainStrength": "ultra",
      "stepModel": "gpt-6.1-sol",
      "stepStrength": "high",
      "sources": [
        "相关经验库"
      ],
      "stat": {
        "firstPass": 0,
        "total": 0,
        "failures": []
      },
      "defaultBoundaries": [],
      "defaultTests": []
    }
  ],
  "agentProposals": [
    {
      "id": "proposal-erp",
      "cardId": "a-tech",
      "status": "pending",
      "example": true,
      "agent": {
        "name": "示例 · ERP 对接专家",
        "tasks": "示例 · 接口风险评估",
        "instructions": "示例 · 引用接口文档与实施证据",
        "model": "gpt-6.1-sol",
        "strength": "high",
        "tools": [
          "资料检索"
        ],
        "executor": "Codex CLI"
      },
      "reason": "示例 · 现有代理缺少 ERP 专项经验"
    }
  ],
  "lessonProposals": [
    {
      "id": "lesson-insertion",
      "cardId": "a-tech",
      "agentId": "agent-tech",
      "status": "pending",
      "example": true,
      "text": "示例 · 评估求解规模时覆盖非理想化插单场景"
    }
  ]
};

// 第 2 批：以下对话、时间、访谈、授权与调度决定均为示例，不冒充真实历史。
const DEFAULT_REQUIREMENTS={产品开发:'合并前有不同模型的代码审查；改动界面的有浏览器检查截图',客户交付:'发布前有对抗型审查',调研:'结论附一手来源',空白:''};
for(const p of db.projects){
 p.authorization='示例 · 新范围的卡先问我；缺陷分组的子卡你自己批；上游新版本的影响判断由你决定。';
 p.requirementEdits=Object.fromEntries(['instructions','requirements','authorization'].map(k=>[k,{time:'示例 · 2026-10-09 09:00',actor:'你'}]));
 p.autoAcceptance='示例 · 未设置，由你验收';p.assignmentRules=p.id==='project-a'?'示例 · 市场调研指派市场调研员':'示例 · 未设置';
 p.playbooks=p.type==='产品开发'?['设计','开发','缺陷','调研']:['承接评估','交付'];
 p.resourceTemplate='示例 · 本地沙箱';p.forbiddenActions='示例 · 未经你批准不得推送、发布或联系客户';
 p.conversation=[];
}
const demoQuestion=(id,type,text,recommended,answer=null)=>({id,type,text,recommended,answer,adopted:answer===recommended});
db.interviews=[{id:'a-interview-1',projectId:'project-a',round:1,time:'2026-10-09 09:10',questions:[
 demoQuestion('q1','需求','这次承接评估要回答什么？','判断技术、产能、成本与市场四个维度是否支持承接。','判断技术、产能、成本与市场四个维度是否支持承接。'),
 demoQuestion('q2','边界','本轮可以直接联系客户吗？','不联系客户，只使用公开数据与内部资料。','不联系客户，只使用公开数据与内部资料。')
]},{id:'a-interview-2',projectId:'project-a',round:2,time:'2026-10-09 09:20',questions:[
 demoQuestion('q1','需求','结论中的风险需要怎样说明？','逐项给出风险、依据与成立条件。','逐项给出风险、依据与成立条件。'),
 demoQuestion('q2','验收标准','怎样判断承接结论可以验收？','四维证据齐全，给出可行、有条件可行或不可行，并列出无法验证项。','四维证据齐全，给出可行、有条件可行或不可行，并列出无法验证项。')
]}];
db.proposals=[{id:'a-assessment',projectId:'project-a',status:'confirmed',time:'2026-10-09 09:30',reason:'四个维度互不依赖，并行最快',cards:['a-tech','a-capacity','a-cost','a-market','a-summary'].map(id=>({id,title:db.cards[id].title,requirements:db.cards[id].requirements.map(r=>r.text).join('\n'),groups:['承接评估'],dependencies:db.cards[id].dependencies.slice()})),decisionId:'a-assessment-confirm'},
{id:'a-delivery-proposal',projectId:'project-a',status:'pending',time:'2026-10-10 11:00',newScope:true,reason:'示例 · 交付准备与实施分别验收，实施依赖准备；这属于新范围，按授权说明先问你。',cards:[
 {id:'a-delivery-plan',title:'交付准备',requirements:'示例 · 核对范围、里程碑和人天，形成交付计划。',groups:['交付'],dependencies:['a-summary']},
 {id:'a-delivery-build',title:'交付实施',requirements:'示例 · 按确认的计划实施并提交交付证据，不执行对外发布。',groups:['交付'],dependencies:['a-delivery-plan']}
]}];
db.questions=[{id:'b-member-question',projectId:'project-b',cardId:'b-defect-diagnose',kind:'member',time:'2026-10-10 12:00',text:'示例 · 窄屏溢出诊断是否需要覆盖 320px？',recommended:'覆盖 320px、375px、760px，并保留截图。',answer:null},
{id:'a-gate',projectId:'project-a',cardId:'a-summary',kind:'gate',time:'2026-10-10 10:00',text:'示例 · 决策关卡：资料不齐时，是否先提交有条件可行的结论？',recommended:'先提交，并明确列出缺失证据，不承诺上线时间。',answer:null}];
db.hardItems=[{id:'a-budget',projectId:'project-a',cardId:'a-market',kind:'budget',title:'示例 · 市场调研达到预算上限',reason:'示例 · 预算已用尽，runtime 已暂停卡片。',status:'pending'},
{id:'b-external',projectId:'project-b',cardId:'b-implement',kind:'external',title:'示例 · 把 main 推送到远程仓库',reason:'示例 · 对外动作必须由你决定；本原型仅记录，不执行命令。',status:'pending'},
{id:'b-unknown',projectId:'project-b',cardId:'b-defect-fix',kind:'unknown',title:'示例 · 副作用状态不明',reason:'示例 · 上一次发布请求的回执丢失，需要你核对结果后决定，不自动重试。',status:'pending'}];
for(const d of db.decisions){d.example=true;d.adoptedAsIs=null;d.delegated=d.id==='seed-upstream';d.affectedCardIds=d.delegated?['b-implement']:[];if(d.id==='seed-serial')d.organizationReason=d.reason;}
db.decisions.push({id:'a-assessment-confirm',projectId:'project-a',cardId:'a-summary',title:'示例 · 确认承接评估五张卡',reason:'按访谈确认四维评估后汇总。',organizationReason:'四个维度互不依赖，并行最快',decisionMaker:'你',time:'示例 · 2026-10-09 09:31',outcome:'已确认',adoptedAsIs:true,example:true},
{id:'a-budget-auto',projectId:'project-a',cardId:'a-market',title:'示例 · 预算到达上限，自动暂停',reason:'硬约束：不能超出预算。',decisionMaker:'runtime 自动',time:'示例 · 2026-10-10 10:30',outcome:'已暂停',adoptedAsIs:null,example:true});
for(const p of db.projects){
 p.conversation.push({id:p.id+'-intro',kind:'message',speaker:'你',text:'示例 · '+p.goal,time:'2026-10-09 09:00',example:true});
 for(const i of db.interviews.filter(i=>i.projectId===p.id))p.conversation.push({id:i.id,kind:'interview',ref:i.id,time:i.time,example:true});
 for(const r of db.proposals.filter(r=>r.projectId===p.id))p.conversation.push({id:r.id,kind:'proposal',ref:r.id,time:r.time,example:true});
 for(const q of db.questions.filter(q=>q.projectId===p.id))p.conversation.push({id:q.id,kind:'question',ref:q.id,time:q.time,example:true});
 for(const d of db.decisions.filter(d=>d.projectId===p.id&&d.delegated))p.conversation.push({id:d.id,kind:'delegated',ref:d.id,time:'2026-10-10 11:30',example:true});
}
for(const i of db.interviews)for(const q of i.questions)db.decisions.push({id:i.id+'-'+q.id,projectId:i.projectId,title:'示例 · 访谈第 '+i.round+' 轮 '+q.id.toUpperCase(),reason:q.text+' 回答：'+q.answer,decisionMaker:'你',time:'示例 · '+i.time,outcome:'已回答',adoptedAsIs:q.adopted,example:true});

// 市场调研已暂停的原因是预算到达上限；与数值保持一致，花费历史不改。
db.cards['a-market'].budget=db.cards['a-market'].spent;
db.cards['a-market'].budgetNote='示例 · 上限 ¥12.20，已用 ¥12.20';
db.projects[0].conversation.push({id:'a-understanding-confirmed',kind:'message',speaker:'你',text:'示例 · 确认两轮访谈达成共同理解，所有分支已处理，无未说明的假设；请按四维评估组织卡片。',time:'2026-10-09 09:25',example:true});

// 授权内批准缺陷子卡，独立于真实规格版本的影响判断。
const defectDecision={id:'seed-defect-ready',projectId:'project-b',cardId:'b-defect-fix',title:'示例 · 代你确认缺陷子卡的规格',reason:'示例 · 授权说明允许缺陷分组子卡自行批准；保持诊断 → 修复 → 回归的依赖，修复规格已确认。',decisionMaker:'项目负责人',time:'示例 · 2026-10-10 11:40',outcome:'待开工',adoptedAsIs:null,delegated:true,affectedCardIds:['b-defect-fix'],example:true};
db.decisions.push(defectDecision);
db.projects[1].conversation.push({id:defectDecision.id,kind:'delegated',ref:defectDecision.id,time:'2026-10-10 11:40',example:true});

// 第 3 批：派单是尝试的唯一数据源；attempts 是同一数组的兼容名字。
// 未记录的真实会话 ID 保持 null / 未记录；session-* 仅是本地展示键（示例）。
db.dispatches=[];db.sessions={};db.messages=[];db.gates=[];db.notifications=[];
const demoTime='2026-10-13 09:00:00';
function seedSession(c,attempt=null,role='member') {
 const member=db.members[c.memberId],key=`session-${c.id}-${attempt?.number||'idle'}`;
 const result=attempt?.result,completed=['success','failed'].includes(result);
 const s={id:key,projectId:c.projectId,memberId:c.memberId,agentId:member?.agentId||getProjectAgent(c.projectId),externalId:attempt?.sessionId&&attempt.sessionId!=='未记录'?attempt.sessionId:null,cardIds:[c.id],currentCardId:c.id,currentDispatchId:attempt?.id||null,role,roundState:result==='unknown'?'needs-you':result==='running'||result==='limit'?'running':'idle',completed,spent:attempt?.cost||0,budget:c.budget,pendingCount:0,unread:false,hasMailbox:true,round:0,pauseReasons:[],output:[{time:demoTime,text:attempt?'示例 · 输出摘录：'+attempt.method:'示例 · 尚未派单，等待项目负责人安排'}],example:true};
 db.sessions[key]=s;return s;
}
function getProjectAgent(projectId){return db.projects.find(p=>p.id===projectId).leaderId;}
for(const p of db.projects){p.paused=false;p.demoRound=0;p.leaderSessionId='session-leader-'+p.id;db.sessions[p.leaderSessionId]={id:p.leaderSessionId,projectId:p.id,agentId:p.leaderId,externalId:null,role:'coordinator',cardIds:[],currentCardId:null,currentDispatchId:null,roundState:'idle',completed:false,spent:0,budget:p.budget,pendingCount:0,unread:false,hasMailbox:true,round:0,pauseReasons:[],output:[],example:true};}
for(const c of Object.values(db.cards)) {
 c.dispatches=c.attempts;c.dispatchIds=[];c.unread=false;c.pauseReasons=c.status==='paused'?['budget:a-budget']:[];c.beforePauseStatus=c.status==='paused'?'running':null;
 c.statusLineHistory=[{time:demoTime,actor:'示例 · 项目负责人',text:c.statusLine,example:true}];
 c.contextPackages=[];c.handoffs=[];c.findings=[];c.fileChanges=[];c.mergeRecords=[];c.fileBaseline='未记录';
 for(const a of c.dispatches){
  if(a.result==='limit'){a.originalResult=a.result;a.result='running';}
  Object.assign(a,{id:`dispatch-${c.id}-${a.number}`,projectId:c.projectId,cardId:c.id,agentId:db.members[c.memberId]?.agentId,workspace:{description:'示例 · '+db.projects.find(p=>p.id===c.projectId).site,baseline:'未记录',example:true},startedAt:c.example?demoTime:null,endedAt:['success','failed'].includes(a.result)?(c.example?demoTime:null):null,heartbeatAt:null,completionReport:null,reportNote:c.example?'示例 · 完成报告':'真实历史结果摘要；runtime 报告格式为示例',example:c.example});
  const s=seedSession(c,a);a.sessionKey=s.id;c.dispatchIds.push(a.id);db.dispatches.push(a);
  if(['success','failed'].includes(a.result))a.completionReport={id:'report-'+a.id,result:a.result,summary:a.method+(a.failure?'；'+a.failure:''),changedFiles:c.id==='b-implement'?['prototype/index.html']:[],time:a.endedAt,example:true,sourceFiles:a.sourceFiles||[],note:'示例 · 根据原尝试记录整理；未记录的文件列表不补造'};
  c.contextPackages.push({dispatchId:a.id,sent:['示例 · 本卡规格','示例 · 项目指令','HANDBOOK.md 第 7、10 节'],omitted:[{item:'其他卡的全部原始输出',reason:'示例 · 与本轮目标无关，提供摘要即可'}],example:true});
 }
 if(!c.dispatches.length)seedSession(c);
 if(c.dispatches.length)c.handoffs.push({time:demoTime,text:'示例 · 项目负责人整理上一次派单结果与下一步目标',example:true});
 c.findings.push({time:demoTime,text:c.id==='b-browser'?'真实记录 · S03 原检查要求写错；复检修正，不能归为实现缺陷':'示例 · 当前没有新增发现；资料缺口交给项目负责人',example:c.id!=='b-browser'});
}
function seedDispatch(cardId,result,summary,number=1) {
 const c=db.cards[cardId],a={id:`dispatch-${cardId}-${number}`,number,projectId:c.projectId,cardId,agentId:db.members[c.memberId].agentId,sessionId:'未记录',model:'示例 · gpt-6.1-sol · high',actor:db.members[c.memberId].name,workspace:{description:'示例 · 当前工作区的隔离副本',baseline:'示例 · 本轮开始快照',example:true},startedAt:demoTime,endedAt:result==='unknown'?demoTime:null,result,method:summary,sourceFiles:[],cost:0,heartbeatAt:null,completionReport:null,reportNote:result==='unknown'?'示例 · 会话退出，未收到完成报告；交项目负责人处理':'示例 · 派单进行中，尚未发完成报告',steps:[],example:true};
 c.dispatches.push(a);c.dispatchIds.push(a.id);db.dispatches.push(a);const s=seedSession(c,a);a.sessionKey=s.id;
 // 没有尝试的责任占位会话替换为本次派单会话。
 delete db.sessions[`session-${cardId}-idle`];
 c.contextPackages.push({dispatchId:a.id,sent:['示例 · 本卡规格','示例 · 项目指令','HANDBOOK.md 第 7、10 节'],omitted:[{item:'客户原始数据',reason:'示例 · 本轮仅使用模拟资料'}],example:true});return a;
}
seedDispatch('b-defect-diagnose','running','示例 · 已定位 320px 布局溢出，正在核对复现条件');
seedDispatch('b-defect-fix','unknown','示例 · 会话退出前输出停在工作区检查，未收到完成报告');
for(const [id,line] of Object.entries({'a-capacity':'示例 · 已核对资源台账，正在估算交付人天；目标：保留排期缓冲','a-cost':'示例 · 已整理成本项，等待交付产能的人天估算；约束：不承诺上线日期','b-defect-diagnose':'示例 · 已复现 320px 横向溢出，正在确认检查范围'})){const c=db.cards[id];c.statusLine=line;c.statusLineHistory.push({time:demoTime,actor:'示例 · 成员',text:line,example:true});}
const costSession=db.sessions['session-a-cost-1'];costSession.roundState='waiting-workflow';
// 从第 2 批的提问对象建立关卡，不新增重复收件箱事项。
for(const q of db.questions){db.gates.push({id:'gate-'+q.id,projectId:q.projectId,cardId:q.cardId,questionId:q.id,question:q.text,options:[q.recommended,'补齐证据后再继续'],answerBy:'你',answeredBy:null,answer:null,status:'waiting',resumeStatus:q.cardId==='a-summary'?'running':db.cards[q.cardId].status,example:true});}
// 验证辅助会话没有信箱：不能直接接受成员来信（示例）。
db.sessions['session-validation-example']={id:'session-validation-example',projectId:'project-b',agentId:'agent-check',externalId:null,role:'auxiliary',cardIds:['b-browser'],currentCardId:'b-browser',currentDispatchId:null,roundState:'idle',completed:false,spent:0,budget:0,pendingCount:0,unread:false,hasMailbox:false,round:0,pauseReasons:[],output:[],example:true};
function seedMail(id,projectId,type,fromSession,recipient,cardIds,content,status='pending',reason='') {
 const m={id,projectId,type,fromSession,recipient,cardIds,groupNames:[...new Set(cardIds.flatMap(id=>db.cards[id]?.groups||[]))],status,time:demoTime,content,agentOrigin:true,example:true,reason,deliveries:[],dispatchId:null,deliveredAt:null,confirmedAt:null};db.messages.push(m);return m;
}
seedMail('a-person-days','project-a','question','session-a-cost-1',{kind:'card-owner',id:'a-capacity'},['a-cost','a-capacity'],'示例 · 请给出交付所需人天估算及缓冲依据，成本报价需要引用。');
seedMail('b-undeliverable','project-b','question','session-b-implement-2',{kind:'session',id:'session-validation-example'},['b-implement','b-browser'],'示例 · 想请验证会话直接确认这次实现的结论。','undeliverable','示例 · 验证辅助会话没有信箱；请通过项目负责人安排验证。');
for(const [id,type,recipient,content] of [['b-team-status','status',{kind:'group',id:'all'},'示例 · 两次实现与两次浏览器检查已保留，请引用各次证据。'],['b-idle-dispatch','dispatch',{kind:'group',id:'idle'},'示例 · 空闲成员请准备下轮资料，实际派单由项目负责人决定。'],['b-group-escalation','escalation',{kind:'group',id:'缺陷'},'示例 · 状态不明派单已升级给项目负责人，不自动重派。']])seedMail(id,'project-b',type,'session-leader-project-b',recipient,['b-defect-fix'],content);
for(const a of db.dispatches.filter(a=>a.completionReport)){const m=seedMail('message-'+a.completionReport.id,a.projectId,'completion',a.sessionKey,{kind:'session',id:db.projects.find(p=>p.id===a.projectId).leaderSessionId},[a.cardId],a.completionReport.summary,'confirmed');m.dispatchId=a.id;m.reportId=a.completionReport.id;m.deliveredAt=demoTime;m.confirmedAt=demoTime;}
const unknownNotice={id:'notice-unknown-seed',projectId:'project-b',sessionId:'session-b-defect-fix-1',cardId:'b-defect-fix',text:'示例 · 窄屏溢出修复的派单状态不明，等待项目负责人处理',time:demoTime,unread:true,example:true};
db.notifications.push(unknownNotice);db.sessions[unknownNotice.sessionId].unread=true;db.cards[unknownNotice.cardId].unread=true;
// 文件列表和 diff 片段沿用真实返工的颜色变更；并行合回另列示例。
const implementation=db.cards['b-implement'];implementation.fileBaseline='真实记录 · 661c858 → eeac9ad（返工基线）';implementation.fileChanges=[{path:'prototype/index.html',preview:'prototype/index.html',note:'真实记录 · 相对首轮实现的返工 diff 片段；不是完整提交差异',example:false}];implementation.mergeRecords=[{time:demoTime,steps:['示例 · 窄屏布局','示例 · 按钮文字'],result:'示例 · 两个隔离副本合回，无冲突',example:true}];
for(const p of db.projects)for(const c of p.cardIds.map(id=>db.cards[id]))if(c.memberId){const member=db.members[c.memberId];member.sessionKeys=Object.values(db.sessions).filter(s=>s.role==='member'&&s.memberId===member.id).map(s=>s.id);}

// 第 5 批：提交内容真实；回放卡片状态、组织理由、统计和配置均为示例推断。
db.replayEvents={
  "project-a": [
    {
      "id": "replay-a-1",
      "time": "示例 · 2026-10-09 09:10",
      "title": "两轮访谈达成共同理解",
      "changes": [
        {
          "cardId": "a-clarify",
          "status": "integrated",
          "kind": "add",
          "outputVersion": 1
        }
      ],
      "reason": "示例 · 先确认需求、边界与验收标准，再组织评估。",
      "message": "示例 · 每题有推荐答案；第 2 轮含验收标准。",
      "example": true
    },
    {
      "id": "replay-a-2",
      "time": "示例 · 2026-10-09 09:15",
      "title": "你确认四维并行评估",
      "changes": [
        {
          "cardId": "a-tech",
          "status": "ready",
          "kind": "add"
        },
        {
          "cardId": "a-capacity",
          "status": "ready",
          "kind": "add"
        },
        {
          "cardId": "a-cost",
          "status": "ready",
          "kind": "add"
        },
        {
          "cardId": "a-market",
          "status": "ready",
          "kind": "add"
        },
        {
          "cardId": "a-summary",
          "status": "ready",
          "kind": "add"
        }
      ],
      "reason": "示例 · 四个维度互不依赖，并行最快。",
      "message": "示例 · 技术可行性 ∥ 交付产能 ∥ 成本报价 ∥ 市场调研 → 汇总结论。",
      "example": true
    },
    {
      "id": "replay-a-3",
      "time": "示例 · 2026-10-09 09:20",
      "title": "runtime 命中市场调研预设规则",
      "changes": [
        {
          "cardId": "a-tech",
          "status": "running",
          "kind": "state"
        },
        {
          "cardId": "a-capacity",
          "status": "running",
          "kind": "state"
        },
        {
          "cardId": "a-cost",
          "status": "running",
          "kind": "state"
        },
        {
          "cardId": "a-market",
          "status": "running",
          "kind": "state"
        }
      ],
      "reason": "示例 · 市场调研按你的预设指派规则直接拉起；其余三张由项目负责人挑代理。",
      "message": "示例 · runtime 指派市场调研员，不经过项目负责人。",
      "example": true
    },
    {
      "id": "replay-a-4",
      "time": "示例 · 2026-10-09 09:25",
      "title": "成员询问人天估算",
      "changes": [
        {
          "cardId": "a-capacity",
          "status": "running",
          "kind": "state"
        },
        {
          "cardId": "a-cost",
          "status": "running",
          "kind": "state"
        }
      ],
      "reason": "示例 · 报价引用产能人天，按轮投递避免打断当前轮。",
      "message": "示例 · 成本报价提问 → 交付产能本轮结束收到 → 下一轮回复 28 人天与 20% 缓冲。",
      "example": true
    },
    {
      "id": "replay-a-5",
      "time": "示例 · 2026-10-09 09:30",
      "title": "市场调研一支无法验证，预算暂停",
      "changes": [
        {
          "cardId": "a-market",
          "status": "paused",
          "kind": "state"
        }
      ],
      "reason": "示例 · 并行检索保留全部来源结果；最新统计与报价证据不足单独列出，不当作通过。",
      "message": "示例 · 行业报告 ∥ 竞品官网 ∥ 最新统计 → 汇总（单次模型调用）；汇总尚未开始，预算到上限。",
      "example": true
    },
    {
      "id": "replay-a-6",
      "time": "示例 · 2026-10-09 09:35",
      "title": "技术可行性交你验收",
      "changes": [
        {
          "cardId": "a-tech",
          "status": "review",
          "kind": "state"
        }
      ],
      "reason": "示例 · 技术证据存在无法验证项，交给你判断，不把进程成功当作验证通过。",
      "message": "示例 · 技术可行性验收报告单独列出缺失证据。",
      "example": true
    },
    {
      "id": "replay-a-7",
      "time": "示例 · 2026-10-09 09:40",
      "title": "可行情景下交付新范围先问你",
      "changes": [
        {
          "cardId": "a-delivery",
          "status": "draft",
          "kind": "add"
        },
        {
          "cardId": "a-decline",
          "status": "cancelled",
          "kind": "add"
        }
      ],
      "reason": "示例 · 授权说明写了新范围先问我；交付准备与实施提议进入收件箱。",
      "message": "示例 · 汇总结论仍待开工；可行后的交付提议是独立情景示例，不表示当前已经汇总完成。",
      "example": true
    }
  ],
  "project-b": [
    {
      "id": "replay-b-1",
      "commit": "661c858c100226d5671e48d850c0a836f9feb62c",
      "time": "2026-10-08T09:09:59+08:00",
      "subject": "原型 v2：强制/建议边界、上限、交接记录、执行记录、无法判定、模板、worker 启动 prompt",
      "title": "任务 001：规格、实现与审查卡出现",
      "changes": [
        {
          "cardId": "b-spec",
          "status": "accepted",
          "kind": "add",
          "outputVersion": 1
        },
        {
          "cardId": "b-implement",
          "status": "review",
          "kind": "add",
          "outputVersion": 1
        },
        {
          "cardId": "b-browser",
          "status": "running",
          "kind": "add"
        }
      ],
      "reason": "示例 · 推断：界面改动要有浏览器检查截图，所以在合并前单开审查卡。",
      "message": "真实任务 001 的首轮产出；Helm 开卡、申请时序没有真实记录。",
      "inferred": true
    },
    {
      "id": "replay-b-2",
      "commit": "eeac9ad2a364203f1f888b168a4c75777fa9bdeb",
      "time": "2026-10-08T09:27:57+08:00",
      "subject": "原型 v2 返工：窄屏收件箱布局、实色按钮前景色对比度；附浏览器检查证据",
      "title": "初检 31/34，退回实现",
      "changes": [
        {
          "cardId": "b-browser",
          "status": "running",
          "kind": "state"
        },
        {
          "cardId": "b-implement",
          "status": "running",
          "kind": "state"
        }
      ],
      "reason": "示例 · 推断：S10 对比度与 S11 窄屏可读性是实现问题；S03 是测试要求写错，分别处理。",
      "message": "真实检查：S10 2.16:1，S11 正文列 59.3px；检查记录随返工提交保存，映射到返工前阶段为推断。",
      "inferred": true
    },
    {
      "id": "replay-b-3",
      "commit": "eeac9ad2a364203f1f888b168a4c75777fa9bdeb",
      "time": "2026-10-08T09:27:57+08:00",
      "subject": "原型 v2 返工：窄屏收件箱布局、实色按钮前景色对比度；附浏览器检查证据",
      "title": "任务 001 返工：产出 v2",
      "changes": [
        {
          "cardId": "b-spec",
          "status": "accepted",
          "kind": "state",
          "outputVersion": 2
        },
        {
          "cardId": "b-implement",
          "status": "review",
          "kind": "state",
          "outputVersion": 2
        },
        {
          "cardId": "b-browser",
          "status": "running",
          "kind": "state"
        }
      ],
      "reason": "示例 · 推断：修复两项界面缺陷后复检；纠正 S03 对象，保留修正链要求。",
      "message": "真实颜色变更 --ok #1f8a4c → #1f874c；同一提交内部先后为推断。",
      "inferred": true
    },
    {
      "id": "replay-b-4",
      "commit": "34fb6583f2f57007e618e441e0a6442a548f35ec",
      "time": "2026-10-08T09:33:40+08:00",
      "subject": "原型 v2 浏览器复检证据（38/38 通过）",
      "title": "浏览器复检 38/38",
      "changes": [
        {
          "cardId": "b-browser",
          "status": "review",
          "kind": "state"
        },
        {
          "cardId": "b-implement",
          "status": "accepted",
          "kind": "state"
        }
      ],
      "reason": "示例 · 推断：复检全部通过后，把审查结果交给你验收。",
      "message": "真实任务 002 复检 38/38；验收状态为示例映射。",
      "inferred": true
    },
    {
      "id": "replay-b-5",
      "commit": "7206fe491f2d92296c69ab5e90854d75a2189fc7",
      "time": "2026-10-11T03:50:50+08:00",
      "subject": "调研：执行编排的通用模板与动态生成（15 个模式、生成方式、沙箱、恢复与幂等、Codex 映射）",
      "title": "ADE 底层功能调研登记",
      "changes": [
        {
          "cardId": "b-ade",
          "status": "integrated",
          "kind": "add",
          "outputVersion": 1
        }
      ],
      "reason": "示例 · 推断：一手来源调研适合一张独立卡，结论写入项目记忆。",
      "message": "真实任务 003：通用编排模式与动态生成。",
      "inferred": true
    },
    {
      "id": "replay-b-6",
      "commit": "f097007e47c6bdfb173a1af2509d905456b29156",
      "time": "2026-10-11T04:11:44+08:00",
      "subject": "实测：Codex CLI 作为编排步骤执行器（13 个用例，30 次内层运行）",
      "title": "Codex 沙箱设计发现未能确认项",
      "changes": [
        {
          "cardId": "b-sandbox",
          "status": "running",
          "kind": "add"
        }
      ],
      "reason": "示例 · 推断：嵌套沙箱无法确认几项能力，需要在外层环境补测，不把未能确认当作通过。",
      "message": "真实任务 004 的限制与发现；拆卡时机尚未记录。",
      "inferred": true
    },
    {
      "id": "replay-b-7",
      "commit": "c19c48442301de1c33bbed492d1a1ee09baed629",
      "time": "2026-10-11T05:28:14+08:00",
      "subject": "原型更新 A：迁移到项目 / 项目流程 / 节点模型（v3 基础），术语更新，两个 Demo 项目；14 项检查通过",
      "title": "原型结构与术语迁移",
      "changes": [
        {
          "cardId": "b-prototype-a",
          "status": "review",
          "kind": "add",
          "outputVersion": 1
        }
      ],
      "reason": "示例 · 推断：两张原型卡都修改 prototype/index.html，让后一张等待前一张合并，避开文件冲突。",
      "message": "真实任务 005 的产出；组织理由为示例推断。",
      "inferred": true
    },
    {
      "id": "replay-b-8",
      "commit": "c3cf88836515d2bdacc50a3775afe3fedf6fb89e",
      "time": "2026-10-11T05:48:57+08:00",
      "subject": "原型更新 A 返工：补 Claude Code 选项、状态标签与流程文字对比度、流程边箭头；附浏览器检查与复检证据（168/168 通过）",
      "title": "第一张原型卡合并，影响判断",
      "changes": [
        {
          "cardId": "b-prototype-a",
          "status": "integrated",
          "kind": "state",
          "upstreamChanged": true
        }
      ],
      "reason": "示例 · 推断：颜色差异只涉及 --ok，术语迁移的结构结论不受影响；保留结果。",
      "message": "示例 · 使用过的上游版本变化：不受影响；真实变更依据为 eeac9ad。",
      "inferred": true
    },
    {
      "id": "replay-b-9",
      "commit": "04b8693625f4e3fdc04f52426c7ae83212275d79",
      "time": "2026-10-11T06:04:50+08:00",
      "subject": "原型更新 B：v4 新增内容（执行编排与四态结果、尝试记录、发现转新节点、项目指令与记忆、人工关卡、副作用状态、预算）；15 项检查通过",
      "title": "第二张原型卡错开开工并完成",
      "changes": [
        {
          "cardId": "b-prototype-b",
          "status": "review",
          "kind": "add",
          "outputVersion": 1
        }
      ],
      "reason": "示例 · 推断：前一张已合并，后一张才修改同一文件；记录与记忆作为第二个增量。",
      "message": "真实任务 007；提交只有完成时间，开工与合并状态为推断。",
      "inferred": true
    },
    {
      "id": "replay-b-10",
      "commit": "f4e6b8a8beb7980d304339fddbad33010081bcdc",
      "time": "2026-10-11T06:26:25+08:00",
      "subject": "原型更新 B 返工：全站链接颜色；附浏览器检查、任务 A 回归与复检证据（307/307 通过）",
      "title": "第二张原型卡返工与合并",
      "changes": [
        {
          "cardId": "b-prototype-b",
          "status": "integrated",
          "kind": "state"
        }
      ],
      "reason": "示例 · 推断：修复链接颜色后复检通过，再合并。",
      "message": "真实检查 307/307；Helm 验收状态为示例。",
      "inferred": true
    },
    {
      "id": "replay-b-11",
      "commit": "6531332706ae6ab947e914a6dfc4a4e94681232e",
      "time": "2026-10-11T23:56:52+08:00",
      "subject": "沙箱外补测 Codex 沙箱：只读与续接收紧有效、显式权限配置可系统级禁读、工作区外写入被拦、.vscode 与 package.json scripts 可改、禁用钩子有效、跨会话缓存不可依赖（含返工 1）",
      "title": "发现拆为 Codex 沙箱补测子卡",
      "changes": [
        {
          "cardId": "b-sandbox",
          "status": "accepted",
          "kind": "state"
        },
        {
          "cardId": "b-sandbox-recheck",
          "status": "integrated",
          "kind": "split",
          "outputVersion": 1,
          "parentId": "b-sandbox"
        }
      ],
      "reason": "示例 · 推断：把未能确认项独立补测，保留自己的证据与验收。",
      "message": "真实任务 019，会话 01a12b84-b3fc-7451-83df-bd60e4dfb1ef；提交只保存完成结果，拆卡与完成在同一步展示。",
      "inferred": true
    },
    {
      "id": "replay-b-12",
      "commit": "7e84953bb38543d8d8a3b2aaa1703e7b4e27511f",
      "time": "2026-10-12T21:11:56+08:00",
      "subject": "调研 agent team 开源方案：信箱、看板认领、运行中投递、文件冲突与信息流标签",
      "title": "v6 协作设计需要了解现有方案",
      "changes": [
        {
          "cardId": "b-collaboration",
          "status": "running",
          "kind": "add"
        }
      ],
      "reason": "示例 · 推断：先了解信箱、看板认领与信息流标签，再确定协作设计。",
      "message": "父设计首次提交晚于调研提交；在此时间点出现父卡只是因任务 020 起因而推断，不能当作真实开工时间。",
      "inferred": true
    },
    {
      "id": "replay-b-13",
      "commit": "7e84953bb38543d8d8a3b2aaa1703e7b4e27511f",
      "time": "2026-10-12T21:11:56+08:00",
      "subject": "调研 agent team 开源方案：信箱、看板认领、运行中投递、文件冲突与信息流标签",
      "title": "拆子卡 agent team 开源调研",
      "changes": [
        {
          "cardId": "b-agent-team",
          "status": "integrated",
          "kind": "split",
          "outputVersion": 1,
          "parentId": "b-collaboration"
        }
      ],
      "reason": "示例 · 推断：开一张独立调研子卡，验收后把结论交回父卡。",
      "message": "真实任务 020，会话 01a13029-7a46-7ad2-b77a-8f5b3018d583。拆卡、验收先后为推断。",
      "inferred": true
    },
    {
      "id": "replay-b-14",
      "commit": "169ad12e9179b378e2aa08ccaa206ed56da47c11",
      "time": "2026-10-12T21:25:53+08:00",
      "subject": "设计草稿 v6：共享看板、协作原语与硬关口，协作约定降为默认打法，信箱按轮投递",
      "title": "调研结论回到父卡",
      "changes": [
        {
          "cardId": "b-collaboration",
          "status": "running",
          "kind": "state",
          "outputVersion": 1
        }
      ],
      "reason": "示例 · 推断：把共享看板、按轮信箱和协作原语纳入父卡，父卡仍须验证自己的设计。",
      "message": "真实 v6 设计草稿；结论回流路径为示例推断。",
      "inferred": true
    },
    {
      "id": "replay-b-15",
      "commit": "756c7f78477bbfaa6919edc7b49ae7af947e62d4",
      "time": "2026-10-12T23:57:20+08:00",
      "subject": "功能规格 v6：按设计草稿改写 FEATURES.md",
      "title": "v6 功能规格成稿",
      "changes": [
        {
          "cardId": "b-collaboration",
          "status": "accepted",
          "kind": "state"
        }
      ],
      "reason": "示例 · 推断：整理设计为功能规格，把后续能力测试留给首个真实执行任务。",
      "message": "Codex 0.160.1 的读取、网络与凭据测试仍待测。",
      "inferred": true
    }
  ]
};
db.playbookLibrary=[
  {
    "id": "play-1",
    "kind": "卡片组合",
    "title": "产品开发 · 新需求",
    "content": "方案设计 → 方案对抗审查 → Spec 定稿；审查不通过退回设计。",
    "source": "HANDBOOK.md 2.3",
    "stats": {
      "references": 8,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-2",
    "kind": "卡片组合",
    "title": "产品开发 · 小增量",
    "content": "实现 → 独立验证 → 合并前交叉代码审查 / 浏览器检查 → 你验收 → 合并；跨增量回归在合并后。",
    "source": "HANDBOOK.md 2.3",
    "stats": {
      "references": 9,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-3",
    "kind": "卡片组合",
    "title": "缺陷常驻分组",
    "content": "问题分诊 → 缺陷诊断 → 修复 → 回归测试 / 开新卡 / 忽略；解决后整理教训。",
    "source": "HANDBOOK.md 2.3",
    "stats": {
      "references": 10,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-4",
    "kind": "卡片组合",
    "title": "客户交付 · 承接评估",
    "content": "技术可行性 ∥ 交付产能 ∥ 成本报价 ∥ 市场调研 → 汇总结论；可行后的新范围按授权先问用户。",
    "source": "HANDBOOK.md 2.3",
    "stats": {
      "references": 11,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-5",
    "kind": "卡片组合",
    "title": "调研",
    "content": "单张调研卡，基于一手来源，结论附引用；可并列审查或卡内分轮对抗。",
    "source": "HANDBOOK.md 2.3",
    "stats": {
      "references": 12,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-6",
    "kind": "卡片模板",
    "title": "方案设计",
    "content": "产出方案与取舍 · wayfinder、first-principles",
    "source": "HANDBOOK.md 2.4",
    "stats": {
      "references": 13,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-7",
    "kind": "卡片模板",
    "title": "方案对抗审查",
    "content": "审查上游方案，找反例 · adversarial-review、occams-razor",
    "source": "HANDBOOK.md 2.4",
    "stats": {
      "references": 14,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-8",
    "kind": "卡片模板",
    "title": "Spec 定稿",
    "content": "产出需求文档与验收标准 · to-spec",
    "source": "HANDBOOK.md 2.4",
    "stats": {
      "references": 15,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-9",
    "kind": "卡片模板",
    "title": "任务拆分",
    "content": "把 Spec 拆成可独立验证的增量 · to-tickets",
    "source": "HANDBOOK.md 2.4",
    "stats": {
      "references": 16,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-10",
    "kind": "卡片模板",
    "title": "实现",
    "content": "实现一个增量并自测 · implement、tdd",
    "source": "HANDBOOK.md 2.4",
    "stats": {
      "references": 17,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-11",
    "kind": "卡片模板",
    "title": "交叉代码审查",
    "content": "审查上游 diff，使用与实现卡不同的模型 · code-review、adversarial-review",
    "source": "HANDBOOK.md 2.4",
    "stats": {
      "references": 18,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-12",
    "kind": "卡片模板",
    "title": "浏览器检查 / 端到端测试",
    "content": "在测试环境执行真实业务、取证、对照预期 · 端到端检查（浏览器 / API）",
    "source": "HANDBOOK.md 2.4",
    "stats": {
      "references": 19,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-13",
    "kind": "卡片模板",
    "title": "问题分诊",
    "content": "常驻分组：分类并分流 · triage",
    "source": "HANDBOOK.md 2.4",
    "stats": {
      "references": 20,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-14",
    "kind": "卡片模板",
    "title": "缺陷诊断",
    "content": "复现、缩小、验证假设、回归测试 · diagnosing-bugs",
    "source": "HANDBOOK.md 2.4",
    "stats": {
      "references": 21,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-15",
    "kind": "卡片模板",
    "title": "调研",
    "content": "基于一手来源调研，结论附引用 · research",
    "source": "HANDBOOK.md 2.4",
    "stats": {
      "references": 22,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-16",
    "kind": "卡片模板",
    "title": "原型验证",
    "content": "用临时原型回答一个设计问题；边界写明\"不合并\" · prototype",
    "source": "HANDBOOK.md 2.4",
    "stats": {
      "references": 23,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-17",
    "kind": "卡片模板",
    "title": "整理教训",
    "content": "把异常整理成教训草稿与验证方法更新 · —",
    "source": "HANDBOOK.md 2.4",
    "stats": {
      "references": 24,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-18",
    "kind": "workflow 模式",
    "title": "单步",
    "content": "一个代理调用 · 小改动",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 25,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-19",
    "kind": "workflow 模式",
    "title": "顺序",
    "content": "A → B → C · 先分析再修改",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 26,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-20",
    "kind": "workflow 模式",
    "title": "并行汇总",
    "content": "拆开 → 并行 → 汇总（单次模型调用） · 多维度调研",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 27,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-21",
    "kind": "workflow 模式",
    "title": "批量清单",
    "content": "枚举 → 逐项处理 → 逐项验证 · 迁移 40 个调用点",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 28,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-22",
    "kind": "workflow 模式",
    "title": "分类分流",
    "content": "分类（单次模型调用）→ 按类别交给不同处理者 · 问题分诊",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 29,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-23",
    "kind": "workflow 模式",
    "title": "生成-验证",
    "content": "做 → 测 → 改，直到通过 · 修 bug 到测试全绿",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 30,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-24",
    "kind": "workflow 模式",
    "title": "指标优化",
    "content": "尝试 → 测量 → 保留更好、回滚更差 · 性能调优",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 31,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-25",
    "kind": "workflow 模式",
    "title": "轮询等待",
    "content": "检查 → 等待 → 再检查 · 等 CI、等外部审批",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 32,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-26",
    "kind": "workflow 模式",
    "title": "对抗验证",
    "content": "攻击 → 核实 → 下一轮（无新成立反例或满 N 轮停止） · 方案审查、代码审查",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 33,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-27",
    "kind": "workflow 模式",
    "title": "多视角评审",
    "content": "多个评审者并行 → 去重合并 · 合同审查",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 34,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-28",
    "kind": "workflow 模式",
    "title": "生成后筛选",
    "content": "生成 N 份 → 按标准过滤 → 选一份 · 文案、方案草稿",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 35,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-29",
    "kind": "workflow 模式",
    "title": "竞赛比较",
    "content": "多种思路分别实现 → 两两评判 · 技术选型",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 36,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-30",
    "kind": "workflow 模式",
    "title": "人工关卡",
    "content": "中途暂停，等用户决定 · 发布前确认",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 37,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  },
  {
    "id": "play-31",
    "kind": "workflow 模式",
    "title": "对齐点",
    "content": "并行分支汇合并统一 · 并行分支的接口统一",
    "source": "HANDBOOK.md 第 4 节",
    "stats": {
      "references": 38,
      "firstPass": 7,
      "total": 10,
      "cost": 12.4,
      "returns": 3,
      "example": true
    }
  }
];
db.handbookRoles=[
  [
    "项目负责人",
    "全部"
  ],
  [
    "成员",
    "2.1、2.4（本卡用到的模板）、3.1 最后一条、3.5、第 4 节、5.1、第 6 节、10.2–10.3"
  ],
  [
    "出题会话",
    "3.1、3.4、3.5、10.2"
  ],
  [
    "验证会话",
    "3.2、3.5、10.2，加上本卡选定的验证方法"
  ],
  [
    "答疑负责人",
    "全部，用来判断问题是否出在调度决定上"
  ],
  [
    "步骤 agent",
    "不放"
  ]
];
db.playbookProposals=[{id:'play-proposal-1',title:'调研先列证据缺口',kind:'卡片组合',content:'示例 · 并行检索 → 汇总缺失证据 → 请求资料；不删无法验证项。',reason:'示例 · 两个项目中减少了无依据的结论。',status:'pending',example:true}];
db.toolLibrary=[
 {id:'research',name:'research',kind:'技能',purpose:'一手来源调研',permissions:'示例 · 只读资料，允许网络',version:'示例 · gungnir-demo-v1',dependencies:['资料检索'],boundAgents:['agent-market']},
 {id:'code-review',name:'code-review',kind:'验证方法',purpose:'合并前交叉代码审查',permissions:'示例 · 一次性副本内读写，无凭据',version:'示例 · gungnir-demo-v1',dependencies:['git'],boundAgents:['agent-check'],when:'实现独立验证后、申请验收前',run:'示例 · 对照规格审查被验证提交的 diff',results:'逐项通过 / 失败 / 无法验证 / 未处理',debug:'先查覆盖清单、提交一致性与未通过项'},
 {id:'browser-check',name:'浏览器检查',kind:'验证方法',purpose:'真实界面业务检查与截图',permissions:'示例 · 测试环境读写，允许本机网络',version:'示例 · 1',dependencies:['浏览器','本机 HTTP 服务'],boundAgents:['agent-browser'],when:'界面实现完成后、申请验收前',run:'示例 · 按行为清单操作，保存截图和断言',results:'逐项对照预期，保留全部非通过项',debug:'先查截图、原始断言、视口尺寸与对比度'},
 {id:'git',name:'git',kind:'命令行工具',purpose:'基线快照与差异',permissions:'示例 · 只读仓库；推送列入禁止动作',version:'未记录',dependencies:[],boundAgents:['agent-frontend','agent-check']},
 {id:'query',name:'runtime 查询接口',kind:'MCP 服务',purpose:'查询看板、记录与产出',permissions:'示例 · 按会话授权；答疑只读',version:'示例 · v7',dependencies:['runtime'],boundAgents:['agent-pm-dev','agent-pm-client','agent-answer']}
];
db.toolProposals=[{id:'method-1',name:'窄屏可读性验证',kind:'验证方法',purpose:'示例 · 防止无溢出但正文仍挤压',permissions:'示例 · 测试副本与截图',version:'示例 · 1',dependencies:['浏览器'],boundAgents:['agent-browser'],when:'窄屏布局变化后',run:'示例 · 核对 375px 正文宽度和短标题行数',results:'保持失败项，不以无滚动条代替可读',debug:'查 S11 截图和正文列宽',status:'pending',source:'evidence/002/assertions.txt:33',example:true}];
db.gungnir={version:'示例 · gungnir-demo-v1',next:'示例 · gungnir-demo-v2'};
db.executors=[{name:'Codex CLI',versions:[{version:'0.160.1',tests:[
 {id:'I1',name:'限制读取',status:'partial',text:'部分测过，待测',source:'任务 019 S05b；只用 codex sandbox 测过，尚缺 codex exec 与 Helm 目录隔离测试'},
 {id:'I2',name:'网络开关',status:'partial',text:'部分测过，待测',source:'任务 004 S09；旧沙箱模式测试，尚缺权限配置下网络开 / 关与读写组合'},
 {id:'I4',name:'限制写入',status:'confirmed',text:'已确认',source:'任务 019 S01–S03；只读、续接收紧与工作区外写入被拦'},
 {id:'I9',name:'凭据',status:'untested',text:'未测 · 待测',source:'尚缺 shell_environment_policy 白名单、SSH_AUTH_SOCK 与 token 不可用测试'},
 {id:'I9-actions',name:'禁止动作清单',status:'untested',text:'未测 · 待测',source:'尚缺 execpolicy .rules 拦截并记录日志的测试；未通过只算提醒'}
 ]}]},...['Claude Code','DeepSeek','Grok Build'].map(name=>({name,upcoming:true,versions:[]}))];
db.askHistory=[];
for(const p of db.projects){
 p.answerBudget={limit:8,spent:0,example:true};
 p.enabledPlaybookIds=db.playbookLibrary.filter(t=>t.kind==='卡片组合'&&(p.type==='客户交付'?t.title.includes('客户交付'):!t.title.includes('客户交付'))).map(t=>t.id);
 p.assignmentRules=p.id==='project-a'?'示例 · 卡片标题=市场调研 → 市场调研员（agent-market）→ runtime 直接拉起；其他卡由项目负责人指派。':'示例 · 未配置预设规则；由项目负责人选代理。';
 p.resourceTemplate='示例 · 端口=2；数据库=helm_{slot}；初始化=init-demo；销毁=cleanup-demo；输出目录=dist/；共享目录=node_modules/（只读）；复制文件=.env.example（无凭据）；部署命令=deploy-demo（禁止动作）。';
 p.forbiddenActions='示例 · git push；部署命令 deploy-demo；发布；联系客户；删除项目外文件。对外动作须由你决定；执行者清单能力未测时只算提醒。';
}
for(const a of db.agents){a.instructions=a.instructions.replace('节点批准的','卡片确认的');a.permissions=a.permissions.replace('节点','卡片');}
db.agents.find(a=>a.id==='agent-frontend').stat={firstPass:7,total:10,failures:['示例 · 窄屏可读性不足（2）','示例 · 对比度不足（1）']};
db.agents.find(a=>a.id==='agent-market').stat={firstPass:6,total:8,failures:['示例 · 最新来源缺证据（2）']};
db.agents.push({id:'agent-answer',name:'答疑（Gungnir）',tasks:'项目答疑、证据定位与建议草稿',instructions:'示例 · 只读全部记录，每个结论附依据；建议只起草。',executor:'Codex CLI',model:'gpt-6.1-sol',mainModel:'gpt-6.1-sol',mainStrength:'high',strength:'high',stepModel:null,stepStrength:null,tools:['diagnosing-bugs','wait-what','first-principles','runtime 查询接口'],sources:['项目全部记录'],defaultBoundaries:[],defaultTests:[],stat:{firstPass:0,total:0,failures:[]},example:true});
for(const [name,tasks,tools,model,strength,step] of [
 ['项目经理（Gungnir）','项目负责人',['grilling','to-spec','to-tickets','wayfinder','triage','domain-modeling'],'gpt-6.1-sol','ultra',null],
 ['答疑（Gungnir）','答疑负责人',['diagnosing-bugs','wait-what','first-principles'],'gpt-6.1-sol','high',null],
 ['执行（Gungnir）','成员',['implement','tdd','research'],'gpt-6.1-sol','ultra','gpt-6.1-sol'],
 ['出题（Gungnir）','起草测试',['只读访问验证方法库'],'gpt-6.1-sol','ultra',null],
 ['审查（Gungnir）','独立验证、审查卡',['adversarial-review','code-review'],'gpt-6-astra','high',null],
 ['通用执行','成员',[],'gpt-6.1-sol','ultra','gpt-6.1-sol'],['通用验证','验证会话',[],'gpt-6-astra','high',null],['通用管理者','项目负责人',[],'gpt-6.1-sol','ultra',null]
])db.agentTemplates.push({id:'template-v7-'+db.agentTemplates.length,name,tasks,tools,model,strength,executor:'Codex CLI',stepModel:step,stepStrength:step?'high':null,instructions:'参考调度手册的适用章节，遵守用户要求与五条硬约束。',sources:[],defaultBoundaries:[],defaultTests:[],example:true});
const market029=db.cards['a-market'];
market029.assignmentNote='示例 · 命中预设指派规则：市场调研 → 市场调研员；runtime 直接拉起，不经过项目负责人。';
market029.contextPackages[0].sent.push(market029.assignmentNote);
market029.attempts[0].steps.forEach(s=>{s.callType=s.id==='market-join'?'单次模型调用':'代理调用';s.parallelGroup=['market-industry','market-competitors','market-pricing'].includes(s.id)?'sources':null;});
market029.workflowNote='示例 · 行业报告 ∥ 竞品官网 ∥ 最新统计与报价（代理调用，并行）→ 汇总（单次模型调用）；最新统计与报价无法验证，单独保留。汇总因预算暂停未开始。';
db.decisions.push({id:'a-runtime-assignment',projectId:'project-a',cardId:market029.id,title:'示例 · runtime 预设指派市场调研',reason:market029.assignmentNote,decisionMaker:'runtime',time:'示例 · 2026-10-09 09:40',outcome:'直接拉起',example:true});
for(const id of ['a-tech','a-capacity','a-cost'])db.cards[id].assignmentNote='示例 · 项目负责人根据专业配置挑选 '+db.agents.find(a=>a.id===db.members[db.cards[id].memberId].agentId).name+'，分配预算后派单。';
db.cards['b-sandbox'].findings=[{time:'未记录',text:'真实记录 · 任务 004 在嵌套沙箱里测得的几项结论未能确认；任务 019 在外层环境补测。示例 · 由此发现拆子卡 Codex 沙箱补测。',example:true}];
db.cards['b-collaboration'].findings=[{time:'未记录',text:'示例 · v6 协作设计需要了解现有方案，拆子卡 agent team 开源调研（任务 020）。',example:true}];
db.cards['b-collaboration'].handoffs.push({time:'未记录',text:'示例 · 子卡验收后结论回到父卡：信箱按轮投递、共享看板认领、并行文件冲突与信息流标签。真实来源：tasks/020-report.md 与 git:169ad12。',example:true});
db.projects[1].memory.cautions.push('真实调研资料：ADE 底层功能调研 → research/workflow-templates.md。示例 · 单卡调研产出登记到项目记忆，参考清单、恢复与幂等模式。');
db.projects[0].conversation.push({id:'a-feasible-scenario',speaker:'项目负责人',kind:'message',time:'2026-10-10 10:59',text:'示例 · 可行情景：若汇总结论为可行，交付准备与实施属于新范围，按“新范围先问我”提议到收件箱；当前汇总仍待开工，本条独立演示后续授权。',example:true});
const serialReason029=db.decisions.find(d=>d.id==='seed-serial');
serialReason029.reason+='；示例 · 两张卡都改 prototype/index.html，后一张等前一张合并后再开工，避免文件冲突。真实依据是任务 005 / 007 的范围与提交先后，组织决定为推断。';
serialReason029.organizationReason=serialReason029.reason;
for(const template of db.agentTemplates){template.instructions=template.instructions?.replace('节点批准的','卡片确认的');template.permissions=template.permissions?.replace('节点','卡片');}
// 工具库与代理配置共用绑定关系；后续新建代理的工具也在库页派生显示。
for(const tool of db.toolLibrary)for(const id of tool.boundAgents){const agent=db.agents.find(a=>a.id===id);if(agent&&!agent.tools.includes(tool.name))agent.tools.push(tool.name);}

// 029 返工：恢复证据阅读，不把旧检查要求误当 t2 的执行缺陷。
const s03EvidenceDetail={method:'独立代理复核；按任务 002 复检要求区分 method 与 redteam 修正链',correction:'t2 只检查 method；t3 检查先不通过后通过以及修正链。原 S03 把 t3 的 correction 要求放到 t2，是检查要求错误。',note:'真实检查说明：tasks/002-recheck-1.md。该说明中的 t2 / t3 是历史技术可行性测试对象，与当前浏览器检查卡的测试编号不同。',source:'tasks/002-recheck-1.md:6',relatedCard:'a-tech'};
db.cards['b-browser'].tests.find(t=>t.id==='t2').evidenceDetail={...s03EvidenceDetail};
db.cards['a-tech'].tests.find(t=>t.id==='t2').evidenceDetail={...s03EvidenceDetail};
db.cards['a-tech'].tests.find(t=>t.id==='t3').evidenceDetail={method:'独立代理复核',note:'示例 · 复用仓库 34fb658 的历史原型 redteam 检查链；不是新增真实客户检查记录。',checks:[{result:'fail',reason:'基准未覆盖插单'},{result:'pass',reason:'回应充分',correction:'补充 P-2024-07 插单率 18% 场景数据'}]};

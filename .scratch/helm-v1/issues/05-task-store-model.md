# 任务库数据模型与状态

Type: grilling
Status: open
Labels: wayfinder:grilling
Blocked by: 01, 16
Map: [Helm v1 设计](../map.md)

## Question

任务库里存什么：工作、工作说明、卡片、依赖、派单与派单结果、消息、事件、验收结果、用户决定。各自有哪些状态，怎样流转？怎样保证每个问题都能追溯到具体的 agent 和步骤？

## Comments

- 来自 01（2026-10-21）：术语以 `GLOSSARY.md` 为准。派单结果 = 运行层判定的结束方式（正常退出、出错退出、超时终止、被取消）+ 执行者的最终回答（仅正常退出时有）。执行者无人值守、不能中途提问，"缺信息"只能写进最终回答、结束派单，见 [16](16-results-and-outputs-research.md)。成果和派单输出存在任务库外的目录，数据库只记路径。

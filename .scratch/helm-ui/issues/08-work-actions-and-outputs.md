# 08 — 工作操作菜单与输出管理

**What to build:** 工作页"操作"菜单：暂停 / 恢复 / 取消工作（取消需二次确认）、换调度者模板。已结束的工作可导出输出、删除输出，删除前未导出时先提示导出，删除后显示"已删除"。输出总量超过阈值时界面顶部提示，指向设置里的阈值和已结束工作的导出 / 删除。显示卡片副本路径的地方提示别在副本目录开终端。见 [需求文档](../spec.md)"主界面"，界面以 [设计稿](../../../design/INDEX.md) 的 `main.html` 为准。

**Blocked by:** 02 — 界面骨架：托管、收件箱与实时更新

**Status:** resolved

- [x] 菜单项按工作状态启用（运行层返回的 `allowedOperations` 优先）；被拒时显示原因
- [x] 换调度者模板只列可用的调度者模板，调用 `change-coordinator-template`
- [x] 导出 / 删除调用 `export-outputs`、`delete-outputs`，删除沿用其 `confirm` 流程
- [x] 超阈值提示由运行层事件或 `get-settings` 得出，低于阈值后消失
- [x] jsdom 整页测试覆盖暂停 / 恢复、取消确认、换模板、导出、未导出时删除的提示、删除后状态、超阈值提示
- [x] `npm run check`、`npm test` 通过


## Comments

2026-10-24：已实现工作页操作菜单（暂停 / 恢复 / 取消确认 / 换调度者模板 / 导出 / 删除输出）。菜单结合工作状态与运行层返回的 allowedOperations 禁用操作，拒绝原因原样显示；模板仅列可用的调度者。所有读写复用 useResource / api.call 和既有 SSE。取消与删除使用应用内原生 dialog，默认聚焦返回，支持 Escape 与焦点恢复。

导出在本机指定 .tar.gz 路径，失败保留输入；删除先确认，再遵循 delete-outputs 的 requiresConfirmation / confirm 流程，未导出时可先导出或仍然删除；已删除从 get-work 持久状态显示。get-settings 仅追加 outputTotalBytes 与 outputThresholdExceeded；全局顶部提示可跳转运行设置及已结束工作，阈值提高或输出删除后消失。页面专用组件、类型及样式留在 work/，共享文件只作追加式小改动。测试夹具的 HOME 与模板目录均隔离到临时目录。

验证：npm run check 通过；新整页测试 7/7、全部整页测试 14/14 通过。首次 npm test 为 447/448，唯一失败是已知 dispatch 偶发项，首次单独复跑仍失败；第二次完整 npm test 为 448/448 Node 测试及 14/14 整页测试通过。自行完成 Standards / Spec 两轴 diff-review，未派生代理。按本轮要求未提交、未启动浏览器及真实 Agent、未运行真实冒烟。

后续合并说明：保留 WorkPage 顶栏的 WorkActions（传入 get-work 的完整 work 与 reload），保留 App 中的 OutputWarning。当前基线及本单均未展示卡片副本路径；05 集成卡片检查器时须在实际路径旁补“别在副本目录开终端，看代码去工作分支”的中英文提醒，再验收该条件。未提前实现卡片视图。

- [x] 由调度者另行执行真实浏览器冒烟与截图验收（本轮未运行）。

### 2026-10-24 验收关闭（调度者）

沙箱外完整 `npm run test:real` 于 d92130e 通过（9 套 19/19，含 `ui.real` 界面全流程：新建 → 对齐 → 执行 → 审核 → 接受，10 张截图已人工查看）；沙箱内 `npm test` 457/457 + 界面 49/49。界面走查中发现的 F1–F4、T1、重复审核标题已修复并复测。证据：`.scratch/tasks/ui-real3/`、`.scratch/tasks/ui-real4/`（不入库）。真实浏览器未覆盖的分支（暂停/恢复、换模板、导出/删除、多版草稿高亮、长 diff）仅由 jsdom 整页测试覆盖；与设计稿的尺寸偏差（新建区、对齐右栏、图节点偏大）未处理。

# 任务 017 返工 1：可视化编辑的两个问题

浏览器检查（任务 018，见 `tasks/018-report.md`、`evidence/018/assertions.txt`、截图 `evidence/018/S05-modified-deleted-added.png`）发现两个问题。只改 `prototype/index.html`，证据写入 `evidence/017/rework-1/`。

## 要修复的问题

1. **取消影响确认后条件文字丢失**（`assertions.txt` 中 `FAIL S09`）：在连线菜单中填写条件文字后，若触发"受影响下游"确认并点取消，已输入的条件文字被清空。要求：取消后回到原菜单，已输入内容保留；改动不加入清单。检查其他会触发确认的操作（删节点、删依赖、加依赖）是否也有同类输入丢失问题，一并修复。
2. **预览箭头颜色与线条不一致**：新增（绿色虚线）、修改（棕色）、删除（红色）连线的箭头仍是默认颜色。要求：每种预览状态的箭头颜色与该连线一致（为每种状态定义对应的 marker，或改用 `context-stroke` 等方式；需在深色模式下同样正确）；悬停高亮时的箭头也随线条颜色变化。

## 不要做的内容

- 只改 `prototype/index.html`；不改 `evidence/001`–`018`、`tasks/` 下已有文件；不做浏览器检查；不做其他改动。

## 必须有的测试

1. 复制 `evidence/017/check.mjs` 为 `evidence/017/rework-1/check.mjs` 并新增：
   - 条件文字输入后触发影响确认、取消：菜单仍打开且文字保留，改动清单不变；对删节点、删依赖、加依赖的确认取消路径同样检查无输入丢失与清单变化
   - 每种预览状态（新增、修改、删除）及悬停高亮的连线，其箭头 marker 的填充色与线条颜色一致（浅色与深色）
2. `node evidence/017/rework-1/check.mjs` 全部通过；回归 `node evidence/015/check.mjs`、`node evidence/013/check.mjs`、`node evidence/011/rework-1/check.mjs`、`node evidence/009/check.mjs`（`evidence/007/check.mjs` 已知失败 T03、T12）。输出保存到 `evidence/017/rework-1/`。
3. 对比度检查仍通过；`node --check` 通过；`git status` 只显示 `prototype/index.html` 修改、`evidence/017/rework-1/` 新增与报告文件。

## 报告要求（中文）

两个问题的原因与修复方式；同类问题排查结果；测试与回归结果、证据路径。

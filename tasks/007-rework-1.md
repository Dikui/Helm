# 任务 007 返工 1：浏览器检查发现的对比度问题

浏览器检查（任务 008，`evidence/008/assertions.txt`）中只有一类问题：**深色模式下，项目记忆页面的引用链接**（如「功能规格」「实现（Codex）」）没有设置颜色，使用了浏览器默认蓝 rgb(0,0,238)，在深色背景 rgb(31,31,29) 上对比度只有 1.757:1。

## 要做的内容

- 只改 `prototype/index.html`：为这些链接设置颜色，使用已有的 CSS 变量或新增 `:root` 变量（深色模式块中同步定义），浅色与深色对比度都 ≥ 4.5:1，视觉上与原型其他链接一致。
- 顺带检查整个原型中**所有没有显式设置颜色的 `<a>` 元素**（包括 v2 / 任务 A 留下的），统一处理，避免同类问题出现在其他页面。

## 不要做的内容

- 不做其他改动；证据只写入 `evidence/007/rework-1/`；不改 `evidence/007/` 已有文件和 `evidence/001`–`008`；不做浏览器检查。

## 必须有的测试

1. 扩展对比度检查（复制 `evidence/007/contrast-check.mjs` 到 `evidence/007/rework-1/contrast-check.mjs` 再扩展），覆盖所有链接的颜色组合，浅色与深色均 ≥ 4.5:1；输出 `evidence/007/rework-1/contrast-check.txt`。
2. 一个静态检查：渲染所有页面后，列出所有 `<a>` 元素，确认每个都由 CSS 规则设置了颜色（而不是依赖浏览器默认）；输出 `evidence/007/rework-1/link-check.txt`。
3. `node evidence/007/check.mjs` 仍 15/15 通过，输出 `evidence/007/rework-1/check-output.txt`；`node --check` 通过。
4. `git status` 只显示 `prototype/index.html` 修改、`evidence/007/rework-1/` 新增和报告文件。

## 报告要求（中文）

修复方式（改了哪些规则 / 变量）、受影响的链接清单、修改前后对比度、测试结果与证据路径。

# Helm 界面设计约定

Helm 是个人使用的多 Agent 编排器。界面帮助用户在工作收件箱中识别需要自己处理的工作，再进入工作页查看进展。产品术语以 `GLOSSARY.md` 为准，行为与交互以 `.scratch/helm-ui/spec.md` 和 `design/INDEX.md` 登记的已确认设计稿为依据。

## 视觉方向

沿用 `design/main.html`：zinc 中性色、内嵌主区、紧凑的收件箱行、状态药丸和 ✦ 标记。侧栏 320px，1280px 以下 280px；主区可收缩，窄屏保持内容和操作可访问。琥珀色只表示“等你处理”，进行中用蓝色转圈，完成用绿色；状态同时有文字，不能仅靠颜色识别。

## 设计变量与运行时所有权

`frontend/src/styles/tokens.css` 是运行时变量的唯一来源，初始迁自 `design/kit/tokens.css`，运行时不读取 `design/`。设计稿继续作为设计参照，后续共享变量变更需同时更新本约定与相关设计稿。

| 角色 | 运行时变量 | 使用位置 |
| --- | --- | --- |
| 页面、侧栏、内容面 | `--bg`、`--sidebar-bg`、`--surface`、`--surface-soft` | `styles/app.css` 的外壳与共享控件 |
| 正文与次要文字 | `--text`、`--muted`、`--faint` | 所有页面 |
| 主操作、键盘焦点 | `--accent`、`--on-accent`、`--ring` | `.btn`、`:focus-visible` |
| 进行中、待处理、完成、错误 | `--running`、`--attention`、`--success`、`--danger` 及对应 soft 变量 | 状态标记与错误提示 |
| 字体 | `--font`、`--mono`、`--text-*`、`--leading` | 系统字体栈与等宽数据，无远程字体依赖 |
| 间距、圆角、阴影 | `--space-*`、`--radius-*`、`--shadow*` | 外壳、控件和收件箱行 |

浅色基础为白色内容面、`#fafafa` 侧栏、`#09090b` 正文；深色由 `prefers-color-scheme` 覆盖相同语义变量。`styles/app.css` 是全局控件、焦点、滚动条和减少动画规则的共同所有者；页面复用这些类和变量，不另建主题。

## 共享行为

- 路由：`shared/router.tsx` 管理浏览器历史，`routes.tsx` 注册页面，支持工作 id、工作视图、设置分区与模板 id 的深链接。
- 读取：`shared/api.ts` 调用现有 POST 操作，保留运行层错误的 code、reason、allowedOperations；`shared/data.tsx` 负责初始读取、重读、取消过时请求。
- 实时：`shared/events.ts` 使用 fetch 读取 POST SSE，重读相关资源成功后推进游标；断线使用 Last-Event-ID 补读。
- 语言：`shared/i18n.tsx` 管理中文 / 英文和 localStorage。仅翻译界面文字，用户和 Agent 内容原样显示。
- 反馈：`shared/feedback.tsx` 提供可读取原始原因的行内错误；保留输入，按钮提交中禁用并标记忙碌。
- 搜索：收件箱本地标题过滤，关键词为临时状态；提供清除和 ⌘K / Ctrl+K 聚焦。

## 验证边界

HTTP 接口与静态托管由 `tests/ui-http.test.ts` 验证。整页行为在 `frontend/tests/` 用 Vitest + jsdom 渲染 `App`，通过 `tests/ui-fixture.ts` 连接假驱动的真实 helmd；该边界不验证布局或视觉。真实浏览器冒烟由调度者另行安排。

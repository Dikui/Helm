## Agent skills

### Issue tracker

任务以本地 Markdown 存放在 `.scratch/<feature>/`。See `docs/agents/issue-tracker.md`.

### Triage labels

使用默认五个状态（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`），写在任务文件的 `Status:` 行。See `docs/agents/triage-labels.md`.

### Domain docs

single-context：根目录 `GLOSSARY.md` 加 `docs/adr/`。涉及业务或架构设计时，参阅 `docs/agents/domain.md` 中的资料入口与按需读取规则。

### Document layout

文档放置约定见 `docs/agents/layout.md`。

### Commit rules

禁止 `--no-verify`、`git add -A` / `git add .` 和强推。

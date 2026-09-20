<!-- peanut-hub:standards:start -->
# Peanut 共享规范入口

Hub 安装器维护；所有 Agent 共用。

- 新目标仅一次 `node ../peanut-hub-wt-context-entry-v4/tools/knowledge/rag.mjs query --brief [--repo <id>] "<任务>"`（默认 2 条，不足才 3 条）；续轮不重复加载。
- 写入先建专用 worktree；改代码更新知识卡，执行同工具的 `build` 与 `check-sync --brief --repo <id>`（失败才展开，跨仓才全量）。事实未变用 `attest`；提交 `sync.json`，不提交 `.rag/`。
- 编辑代码读语言 README；跨仓或边界不清才读项目边界。Hub `standards/` 唯一权威，并遵守 `code-design.md` 与 `context-efficiency.md`。
- 限定仓库搜索、输出和验证，不覆盖他人改动。排障只用筛选后的文本日志、堆栈和命令行，禁截图与读图；Hub 不可读先恢复。
<!-- peanut-hub:standards:end -->

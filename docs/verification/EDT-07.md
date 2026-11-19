# EDT-07 状态栏与异步统计验收

关联 PRD §3.2.5、TDD §5.1。状态栏现在显示文档名称、保存状态、异步字数、Unicode 码点字符数、光标行列和布局模式。

- 统计任务通过独立 Worker 和 300ms 防抖调度。每个结果携带 `documentId` 与 `revision`，活动文档和当前 revision 不匹配的结果会丢弃。
- 字数逐个统计汉字，其他语言使用 `Intl.Segmenter` 的 `isWordLike`，标点和空白不计入。字符数按 Unicode code point 计数，包含空白与换行。
- 光标列按 grapheme cluster 计数，行列从 1 开始。切换标签时统计和光标状态随文档更新。未命名或未打开文档不会显示“已保存”。

## 执行与结果

本机 Windows 上运行 `pnpm exec vitest run src/services/document-stats.test.ts src/services/editor-registry.test.ts`，6 项通过。使用 Playwright Chromium 运行 `pnpm exec playwright test tests/e2e/status-bar.spec.ts --workers=2`，3 项通过，覆盖中文、英文、Emoji、换行、快速编辑、标签切换、未命名文档状态与浅深主题。原生保存及冲突状态待 M3 文件任务接入，此处仅显示编辑会话的保存状态。

[浅色截图](./EDT-07/light.png) · [深色截图](./EDT-07/dark.png)

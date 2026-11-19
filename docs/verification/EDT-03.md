# EDT-03 GitHub 风格 Markdown 与 GFM 验收

任务 ID / 验收编号：EDT-03 / PRD §4.3、AT-04、UX-03、UX-04  
验收日期：2026-11-19  
执行人：Codex

## 实现范围

- 新增隔离的 `src/styles/markdown.css`，仅注入预览 `srcdoc`，覆盖浅色/深色主题下的标题、段落、列表、引用、分隔线、代码、表格、链接、图片、任务列表、脚注和 `details`。
- Markdown-it 固定启用 `markdown-it-footnote` 与 `markdown-it-task-lists`；任务复选框输出为 disabled，只读不回写源码。
- 标题生成确定性 `id` 与可聚焦锚点；重复标题使用稳定数字后缀，链接、自动链接和删除线保留 Markdown-it 语义。
- 表格使用 `.table-scroll` 受控横向滚动容器，长代码块保留空白并独立滚动，不撑宽应用；普通单换行保持 Markdown 语义。
- 预览文档通过 CSP、`sandbox="allow-same-origin"` 和 DOMPurify 净化后渲染，应用外层样式不会泄漏到正文或反向污染。

## 执行命令与结果

```powershell
pnpm typecheck
pnpm test -- --runInBand
pnpm exec playwright test tests/e2e/markdown-style.spec.ts --workers=1
```

结果：全部通过。

- TypeScript 类型检查通过。
- Vitest：6 个测试文件、26 项通过，覆盖 GFM 表格、任务列表、脚注、标题锚点和渲染调度。
- Playwright：3 项通过，覆盖元素展示与样式隔离、主题切换、宽表格滚动边界。

## 截图基线

- [浅色 showcase](./EDT-03/light.png)
- [深色 showcase](./EDT-03/dark.png)

截图覆盖标题层级、任务列表、表格、链接、脚注、引用、代码块、双栏布局和主题对比。

## 验收结论

通过。满足 EDT-03 的 GitHub 风格正文隔离、GFM 常用语法、浅深主题基线、只读任务列表和宽内容边界要求。

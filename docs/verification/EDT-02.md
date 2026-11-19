# EDT-02 安全 Markdown 基础解析与调度验收

任务 ID / 验收编号：EDT-02 / PRD §4.3、AT-03、AT-04  
验收日期：2026-11-19  
执行人：Codex

## 实现范围

- `markdown.worker.ts` 在 Worker 中执行 Markdown-it 解析，输出 HTML 与带源码行范围的块级结果。
- `RenderScheduler` 以 100ms 防抖合并输入，按 `documentId + revision + renderEpoch` 校验结果；旧文档、旧版本和失效渲染配置不会更新当前预览。
- 主线程使用 DOMPurify 原始 HTML 白名单净化，再写入 `sandbox="allow-same-origin"` 的 `srcdoc` iframe；预览无脚本、表单、网络和顶层导航能力。
- CodeMirror 事务自动触发调度，无需点击预览按钮；活动标签切换会重新请求当前文档快照。

## 执行命令与结果

```powershell
. ./.tmp/toolchain.ps1
pnpm check
```

结果：通过。

- Prettier、ESLint、TypeScript 通过。
- Vitest：6 个测试文件、25 项通过，覆盖 Markdown/GFM 行号、调度防抖、revision/epoch 丢弃和净化边界。
- Rust fmt/clippy/test 通过：原有原生测试全部通过。
- Vite production build 通过（Mermaid 依赖的既有大 chunk 提示）。
- Playwright：22 项通过，包含实时预览与安全净化专项 2 项。

## 专项验收

- 编辑源码后 100ms 调度预览自动更新，标题、段落和强调语义正确。
- 首次渲染即移除 `<script>` 等危险 HTML；安全正文只进入隔离 iframe。
- 切换文档后旧文档晚到的解析结果不会覆盖活动文档预览。
- 表格、自动链接和普通换行按 Markdown-it 配置处理；代码块/公式/Mermaid 的高级渲染由后续任务接入。

## 证据

- `src/services/markdown-renderer.ts`
- `src/services/markdown.worker.ts`
- `src/services/markdown-renderer.test.ts`
- `tests/e2e/render.spec.ts`
- `pnpm check` 输出（2026-11-19）

## 未解决问题 / 风险

Worker 解析使用全文快照；大文档增量解析、块级 DOM 局部更新和高级语法渲染由 EDT-03、QUAL-01 继续完善。`localStorage`/浏览器环境下使用同步降级解析器，生产 Tauri WebView 使用模块 Worker。

## 结论

通过。满足 EDT-02 的安全基础 Markdown 解析、自动调度、版本竞态丢弃和首次渲染净化验收条件。

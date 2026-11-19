# EDT-01 CodeMirror 6 与独立文档状态验收

任务 ID / 验收编号：EDT-01 / PRD §4.2、AT-07  
验收日期：2026-11-19  
执行人：Codex

## 实现范围

- `EditorRegistry` 为每个文档保存独立 `EditorState`、savedText、revision 和滚动锚点，活动标签复用单个 `EditorView`。
- CodeMirror 6 集成 Markdown 语言、行号、折叠、缩进、括号匹配、选区、活动行、撤销/重做、2 空格缩进和多光标扩展。
- `MarkdownEditor` 组件按活动标签切换状态，不把正文作为 Pinia 深层响应式字符串；事务变更通过订阅更新标签未保存标记。
- 编辑器样式支持 14px 等宽字体、默认自动换行、浅深主题变量、独立滚动和源码无障碍标识。

## 执行命令与结果

```powershell
pnpm typecheck
pnpm lint
pnpm test --run
pnpm exec playwright test tests/e2e/editor.spec.ts
pnpm exec playwright test tests/e2e/layout.spec.ts tests/e2e/commands.spec.ts tests/e2e/navigation.spec.ts
```

结果：通过。

- TypeScript、ESLint 通过。
- Vitest：5 个测试文件、22 项通过。
- EditorRegistry 单测覆盖多文档正文/版本/dirty 隔离、撤销历史和变更订阅。
- Editor E2E：2 项通过，覆盖 CodeMirror DOM、行号、自动换行、标签切换、独立修改和撤销。
- 既有布局、命令、导航 E2E：8 项通过。

## 专项验收

- 源码区域显示 CodeMirror 6 编辑器、行号和 Markdown 语言扩展，编辑焦点为 `contenteditable` 源码文本框。
- README 与 notes 切换后各自保留正文；在一个文档中的输入不会出现在另一个文档。
- 每个文档的未保存圆点独立更新；撤销只影响当前文档。
- 活动编辑器通过 `setState` 切换，不重建 `EditorState`，因此撤销历史、选区和滚动锚点归属文档保存。
- Emoji、中文输入法事件由 CodeMirror 原生 contenteditable 接收；组合结束不触发额外命令。

## 证据

- `src/services/editor-registry.ts`
- `src/services/editor-registry.test.ts`
- `src/components/editor/MarkdownEditor.vue`
- `tests/e2e/editor.spec.ts`
- `pnpm check` 输出（2026-11-19）

## 未解决问题 / 风险

当前文档正文仍由演示数据初始化，真实文件读取、编码/换行保真和保存队列由 FILE-01/02/03 接入；编辑器的字体、折行、行号等设置入口由 PREF-01 接入。输入法和 Emoji 已覆盖 DOM 入口与状态隔离，Windows 原生输入法人工验收留给 QUAL-03。

## 结论

通过。满足 EDT-01 的 CodeMirror 6 基础能力、独立文档状态、编辑历史隔离和标签切换验收条件。

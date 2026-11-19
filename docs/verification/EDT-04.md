# EDT-04 块级源码映射与预览点击定位验收

任务 ID / 验收编号：EDT-04 / PRD §5.1、UX-07  
验收日期：2026-11-19  
执行人：Codex

## 实现范围

- `SourceMapService` 保存受控 `blockId` 到 0-based 源码行范围的映射，未知或伪造 ID 不可解析。
- Markdown-it 标题、段落、列表、引用、表格和代码块生成 `data-source-block`，代码与表格包装节点保持块级映射；复杂子节点回退到最近可信块。
- 预览 iframe 通过同源事件代理定位源码；链接、图片、复选框、折叠、媒体和可编辑元素执行自身交互，不触发定位；拖选文字时忽略点击。
- CodeMirror `EditorRegistry.revealLine()` 只改变选区、滚动和短暂行高亮，不修改文档内容或历史。

## 执行命令与结果

```powershell
pnpm typecheck
pnpm test -- --runInBand
pnpm exec playwright test tests/e2e/source-map.spec.ts --workers=1
```

结果：全部通过。

- TypeScript 类型检查通过。
- Vitest：7 个测试文件、27 项通过，覆盖 SourceMapService、Markdown 解析和编辑器状态。
- Playwright：2 项通过，覆盖段落定位、源码不变、代码块映射以及链接/图片过滤。

## 验收结论

通过。满足 EDT-04 的受控块级映射、复杂节点回退、点击过滤、行高亮和不修改文档要求。

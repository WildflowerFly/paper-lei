# EDT-06 当前文档查找、替换与格式操作验收

关联 PRD §4.2.4、AT-11 当前文档部分。验证环境为本机 Windows 和 Playwright Chromium。

- 编辑菜单与 `Ctrl+F` / `Ctrl+H` 共用命令入口。在仅预览模式打开查找或替换时切换至源码。面板支持关键词高亮、结果计数、前后定位、无结果提示与 `Esc` 关闭。
- 替换当前和全部替换各产生独立的撤销步骤。格式菜单支持标题、粗体、斜体、删除线、列表、引用、代码、链接、图片和表格，每个操作对应一个编辑事务。
- `pnpm exec vitest run src/services/editor-format.test.ts` 三项通过，覆盖行范围、强调、代码围栏和链接、图片及表格语法。
- `pnpm exec playwright test tests/e2e/editor-search.spec.ts --workers=3` 三项通过，覆盖中文查找与定位、空结果、仅预览下的替换入口、两种替换的独立撤销，以及格式渲染与撤销。

[浅色截图](./EDT-06/light.png) · [深色截图](./EDT-06/dark.png)

# FILE-02 单文件打开与编码保真验收

关联任务：`FILE-02`；对应 PRD AT-02、TDD §4.1 和 §11。

## 实现范围

- 桌面端“打开文件”命令与欢迎页入口使用原生选择框，过滤 `.md` / `.markdown`；取消选择不改变文档状态。
- Rust 为选中文件建立身份绑定的授权 token。重复打开同一文件身份复用授权；前端按卷序列号和文件索引复用现有标签，不覆盖已有编辑会话。
- 后端通过文件句柄再次核对身份后读取内容，返回名称、显示路径、身份、只读属性和编码元数据；只读文档通过 CodeMirror `readOnly` 状态阻止编辑。窗口名称不是 `main` 时拒绝调用。
- 严格解码 UTF-8，记录 BOM、每条 LF/CRLF/CR 换行及末尾换行；非 UTF-8 返回 `UNSUPPORTED_ENCODING`，不生成可编辑会话。原生对话框在浏览器预览环境不可用时提供明确提示。
- `encode_document` 在正文未修改时可往返保留 BOM、混合换行及末尾换行；新增换行采用原文件主要换行风格。

## 验证命令与结果

环境：Windows、Rust `1.95.0`（GNU）、Node `22`、Tauri `2.12`。

```text
cargo fmt --manifest-path src-tauri/Cargo.toml --check                         通过
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings  通过
cargo test --manifest-path src-tauri/Cargo.toml --locked                       通过：10 个库测试、15 个安全保存测试、1 个窗口 capability 测试
pnpm format:check                                                              通过
pnpm lint                                                                      通过
pnpm typecheck                                                                 通过
pnpm exec vitest run src/types/ipc.test.ts                                     通过：2 个 IPC 契约测试
```

Rust 单元测试覆盖 UTF-8 BOM、混合 LF/CRLF/CR、末尾换行、非法 UTF-8 拒绝，以及 `.markdown` 文件读取、元数据回传、编码往返和身份授权复用；前端编辑器单测覆盖只读文档拒绝编辑。桌面原生文件选择框尚未进行人工交互验收；此记录不代表系统关联、拖放或 Windows 安装包验证。

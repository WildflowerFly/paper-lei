# Markdown Studio（paper-lei）

面向 Windows 的本地 Markdown 工作台。当前是开发版，功能和验收进度见 [任务清单](docs/task-list.md)。不上传文档，不从 CDN 加载应用脚本。

## 本地构建

1. Windows x64、Microsoft Edge WebView2 Evergreen Runtime、Node.js 22.13+、pnpm 11.25.0（可用 `npm install -g pnpm@11.25.0`）。
2. 安装 rustup。推荐 Visual Studio Build Tools 的“使用 C++ 的桌面开发”和 Windows SDK，使用 `x86_64-pc-windows-msvc`；也可使用 x64 MinGW-w64，确保 `gcc`、`windres`、`dlltool` 在 PATH，并让 rustup 使用 `x86_64-pc-windows-gnu` 主机。仓库固定 Rust、前端及 Cargo 依赖版本。
3. 在仓库根目录执行：

   ```powershell
   pnpm install --frozen-lockfile
   cargo fetch --locked --manifest-path src-tauri/Cargo.toml
   pnpm desktop:dev
   ```

   `pnpm dev` 只启动浏览器前端；`pnpm desktop:dev` 启动 Vite 和原生窗口。开发服务器仅监听 `127.0.0.1:1420`，端口占用时请先关闭已有开发实例。

4. 运行 `pnpm desktop:build` 构建 release，启动 `src-tauri/target/release/markdown-studio.exe`。使用 GNU 工具链时须保留同目录的 `WebView2Loader.dll`。release 不需要 Vite 或网络；此命令不生成安装包。

## 代码结构

- `src/`：Vue 入口、组件、静态资产和样式。编辑器、Worker、业务服务随相应任务加入。
- `src-tauri/`：Rust 桌面入口、窗口配置与权限。当前窗口不具有任意文件读写权限。
- `docs/`：[产品需求](docs/prd.md)、[交互设计](docs/ui-ux-design.md)、[技术方案](docs/tdd.md)及验收记录。

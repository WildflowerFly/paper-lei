# FND-01 工程初始化验收

- 日期：2026-11-18；任务：FND-01；关联 AT-01 的工程前置，非安装验收。
- 构建版本：0.1.0；实现提交可用 `git log --grep=FND-01` 查询。
- 环境：Windows 11 专业版 build 26300，i5-14600KF，32GB RAM，96 DPI（100%）；WebView2 157.0.4341.46。
- Node 22.23.4，pnpm 11.25.0，Rust 1.95.0，x86_64-pc-windows-gnu，MinGW GCC 13.1。

## 执行与结果

1. `pnpm install`：通过；随后可用 `pnpm install --frozen-lockfile` 复现。下载受网络吞吐影响，镜像仅用于开发依赖获取，锁文件带完整校验和。
2. `pnpm build`：Vue 类型检查和 Vite 生产打包通过。
3. `pnpm desktop:dev --no-watch`：原生窗口启动。辅助功能树包含 `Markdown Studio` 和 `本地 Markdown 工作台`；关闭窗口可正常退出，Vite 同步结束。
4. `pnpm desktop:build`：release 构建通过。产物 `src-tauri/target/release/markdown-studio.exe`，18,255,367 字节，SHA256 `D0D668483D0F9B6E843D8FD5782C49E96625DC9CC2701AD13421DF362CE91604`。
5. 确认 1420 端口无监听，再启动 release。使用进程级 WebView2 调试参数临时开启本地 CDP，读取 `http://tauri.localhost/` 的正文并截图，浅色/深色均出现欢迎页正文。退出后清除该环境变量；应用配置未开启远程调试。
6. [浅色截图](FND-01/light.png)、[深色截图](FND-01/dark.png)。样式、图标、脚本均来自产物本身，无 CDN。

## 结论

FND-01 通过。当前仅工程欢迎页；文件打开、编辑等由后续任务交付。未验证 Windows 10、安装包、MSVC 构建或完整 AT-01；这些仍由最终发行任务追踪。GNU 工具链的 release 必须与其 `WebView2Loader.dll` 一起运行。

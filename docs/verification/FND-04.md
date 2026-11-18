# FND-04 WebView2 PDF 与原生打印

2026-11-18，Windows 11 专业版 build 26300，WebView2 157.0.4341.46，Tauri 2.12.7，Wry 0.57.2，webview2-com 0.39.1；其余环境见 FND-01。独立 Rust example，不是正式导出入口。

## 复现

```powershell
cargo build --locked --manifest-path src-tauri/Cargo.toml --example print_probe
cargo run --locked --manifest-path src-tauri/Cargo.toml --example print_probe -- pdf
cargo run --locked --manifest-path src-tauri/Cargo.toml --example print_probe -- cancel
cargo run --locked --manifest-path src-tauri/Cargo.toml --example print_probe -- fail
cargo run --locked --manifest-path src-tauri/Cargo.toml --example print_probe -- print
```

GNU 工具链直接运行 example 时将 `src-tauri/target/debug` 加入 PATH，供进程定位 `WebView2Loader.dll`。`build.rs` 将主窗口的公共控件清单资源同样链接到 examples，避免 GNU 下未激活 ComCtl32 v6。打印测试点击“取消”后关闭原型窗口，不提交任何打印作业。

## 结果

- `pdf` 返回 0 / `COMPLETED`：从只读本地协议加载静态模板，禁用 JavaScript、网络、导航及 IPC 能力；使用 WebView2 原生 PrintToPdf 回调。输出 [sample.pdf](FND-04/sample.pdf)，90,658 字节，SHA256 `31E5B47A3D8DBD774D597C3D5F151D2C467C346783C534155CF61E9A2954CA21`。
- `pdfinfo`：2 页，A4，594.96 × 841.92 pt，PDF 1.4，无 JavaScript。`pypdf` 验证页数和中英文文本；`pdftoppm` 逐页渲染后视觉核对中文、表格、MathML 分式、SVG 流程图及边距，均可读。样例暂用静态 MathML / SVG，高级渲染器另由 RENDER 任务验证。
- `cancel` 返回 0 / `CANCELLED`：PrintToPdf 调用后立即取消应用任务，等待原生回调再删除本次临时文件；目录为空，不产生 `sample.pdf`。
- `fail` 返回 1 / `EXPORT_FAILED`：使用不存在的目标父目录，原生回调报告失败，未生成最终文件。
- `print` 输出 `PRINT_UI_REQUESTED`：辅助功能树观察到独立的“Microsoft Edge WebView2 - 打印”窗口，调用其“取消”按钮后窗口消失，未打印。

## 结论与限制

FND-04 / R-01 桥接可行性通过。45 秒无结果退出为失败，不伪装成功。此原型不依赖系统“打印为 PDF”生成 PDF。

取消采用等待并丢弃结果的语义，不声称底层 API 立即停止排版。ShowPrintUI 不暴露系统 UI 的取消/提交回调，正式功能只能提示已打开打印窗口；需要精确作业状态时用带回调的 Print API 并在应用内先确认。Windows 10、正式导出准备流程、字体打包和安装器仍需后续任务验收。退出时观察到 WebView2 控件注销日志 1412，未影响文件或返回码，正式导出生命周期需在 EXPORT-03/QUAL-02 再验证。

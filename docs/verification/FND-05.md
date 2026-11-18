# FND-05 渲染隔离风险原型

日期：2026-11-19；Windows 11 / WebView2 环境同 FND-04。固定 DOMPurify 3.4.18、KaTeX 0.16.47、Mermaid 11.17.2，所有脚本和字体本地打包。

## 验证入口

```powershell
pnpm build
cargo build --locked --manifest-path src-tauri/Cargo.toml --example render_probe --features tauri/custom-protocol
cargo run --locked --manifest-path src-tauri/Cargo.toml --example render_probe --features tauri/custom-protocol -- all
```

`invalid` / `oversize` / `stall` 替换末尾 `all`，分别验证无效语法、100KB 以上源码及无法自行返回的同步循环。原型输出 `.tmp/render-probe/<随机任务>/result-N.json`，结果绑定 UUID nonce。GNU 工具链直接运行时将 `src-tauri/target/debug` 加入 PATH。

`node scripts/probe-isolation.mjs` 启动独立原生 host 和 stall 进程，各用独立 WebView2 数据目录；用本地 CDP 反复修改 host 输入，监督 stall 退出。临时调试端口仅由测试进程环境开启。原生结果保存在 `.tmp/isolation/result.json`。

## 结果与边界

- 六类 Mermaid（流程/时序/类/状态/甘特/饼图）在 WebView2 成功生成净化 SVG；每项结果核对请求 nonce，`ipcDenied=true`。窗口无 capability，试图调用受保护的 `business_probe` 被 Rust 窗口身份检查拒绝。Tauri 内部对象本身仍存在，不把对象存在与否当作权限结论。
- 超限与无效语法返回 `RENDER_FAILED`；同步死循环触发 `RENDER_TIMEOUT`，原生进程退出 2。2s 预算从任务脚本开始计，另允许 8s 加载预算；总看门狗 30s。后续 RENDER-03 需包装进程生命周期和取消服务。
- 进程隔离原型 60 次输入值写入/读取：首次测量 P95 0.971ms，最大 2.201ms；只用于判断事件循环是否被阻塞，不等于真实 CodeMirror 输入性能验收。
- Playwright 验证原始 HTML 删除脚本、事件、网络图片、导航、class/style/id 与伪造源码属性；`sandbox=allow-same-origin` 中即使再次注入 script 也不执行，未发生外部请求。
- 公式在独立白名单中保留 KaTeX MathML 与分式标记；SVG 删除脚本、外链、foreignObject、用户样式及危险 URL，附加固定的本地展示样式。用户 HTML 不能继承生成内容白名单。
- Rust 资源 token 原型仅接受小于 20MB 的 PNG 字节，UUID 绑定文档、拒绝伪造令牌和跨文档读取，关闭文档可撤销；正式 MIME/路径/网络资源仍由 RES-01 验收。

R-03/R-04 方案可行性通过，最终打包权限和业务 IPC 全回归仍在 FILE-01、RES-03、QUAL-02。原型页面与脚本不是完整编辑器，当前只作为边界验证基线。

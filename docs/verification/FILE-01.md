# FILE-01 Rust 授权、路径和类型化 IPC 验收

关联任务：`FILE-01`；对应 TDD §7.1、§11 和 PRD §7.3。

## 实现范围

- `AuthorizationRegistry` 在 Rust 内生成 UUID token，保存规范化路径、文件身份和授权类型；撤销后 token 立即失效。
- Windows 文件身份通过打开句柄后的 `GetFileInformationByHandle` 读取卷序列号和文件索引；授权文档替换后身份不匹配，不会继续使用旧授权。
- 路径入口拒绝空名、保留设备名、非法字符、尾随点/空格、路径穿越、UNC/设备路径、ADS 和绝对路径；目录 token 的目标会重新规范化并检查是否仍在授权根内，因此 junction 越界会被拒绝。
- `IpcError` 统一提供 `code`、`message`、`retryable`、`operationId` 和 `details`；前端只暴露 token + 相对路径的 `inspectAuthorizedEntry` 类型契约。
- `main` capability 只允许显式生成的 `inspect_authorized_entry` 命令；Rust 还检查调用窗口必须为 `main`。渲染页面没有该 capability。

## 验证命令与结果

环境：Windows 11、Rust `1.95.0`（GNU）、Node `22`、Tauri `2.12`。

```text
cargo fmt --manifest-path src-tauri/Cargo.toml --check       通过
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings  通过
cargo test --manifest-path src-tauri/Cargo.toml --locked     通过：6 个授权/资源测试、15 个保存测试、1 个窗口 capability 测试
pnpm exec vitest run src/types/ipc.test.ts                   通过：1 个类型化 IPC 契约测试
pnpm typecheck                                               通过
```

授权测试实际覆盖：非法名称与设备路径、中文和空格路径、伪造 token、token 撤销、文件替换后的身份失效，以及 Windows junction 指向授权根外部目录时的拒绝。测试输出确认 junction 被创建并返回 `PATH_OUT_OF_SCOPE`。

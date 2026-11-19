# FILE-03 安全保存、另存为与自动保存验收

关联任务：`FILE-03`；对应 PRD AT-06、AT-09、TDD §4.2–§4.3 和 §11。

## 实现范围

- 打开文档返回 `DiskVersion`（文件身份、BLAKE3 摘要、长度和修改时间）；保存请求必须携带该版本，Rust 在授权 token、路径身份和提交前后再次校验。
- Windows 保存复用已通过 FND-03 验证的 NTFS 事务原型：同目录候选文件、`ReplaceFileW`、唯一恢复目录和 `base/local/disk/recovery.json`；不先截断目标，不以删除后重命名替代原子替换。
- `save_document` 只接受授权文件 token，映射冲突、提交竞态、占用、权限和磁盘空间错误；`save_document_as` 走原生保存对话框，默认 `.md`，拒绝非法扩展和已有目标，空扩展自动补 `.md`。
- 前端 `SaveCoordinator` 对每个文档停止输入 800ms 后调度，输入法组合期间暂停；同文档串行、队列只保留最新 revision。保存期间继续编辑只更新当前 revision，不会误标为已保存。
- 自动保存失败或冲突会暂停自动重试，状态栏持续显示并提供“重试/另存为”；手动保存和全部保存复用同一协调器。

## 验证命令与结果

环境：Windows 11、固定本地 NTFS、Rust `1.95.0`（GNU）、Node `22`、Tauri `2.12`。

```text
cargo fmt --manifest-path src-tauri/Cargo.toml --check                                  通过
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings 通过
cargo test --manifest-path src-tauri/Cargo.toml --locked                                通过：10 个库测试、15 个安全保存测试、1 个窗口 capability 测试
cargo check --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-gnu 通过
pnpm format:check                                                                       通过
pnpm lint                                                                               通过
pnpm typecheck                                                                          通过
pnpm exec vitest run src/types/ipc.test.ts src/services/editor-registry.test.ts src/services/save-coordinator.test.ts src/App.test.ts 通过：11 项
```

Rust FND-03 原生测试覆盖正常替换、外部写入、最后窗口竞态、原子替换、删除、占用、模拟满盘、进程终止和回收站恢复；本任务新增授权版本快照和保存 IPC。前端单测覆盖 800ms 防抖、输入中继续编辑、同文档串行队列、冲突暂停和手动重试。真实桌面人工保存对话框、系统关联和拖放仍属于 `WIN-01`，不在本任务验收范围内。

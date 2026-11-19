# FILE-04 文件监听、冲突会话与差异处理验收

关联任务：`FILE-04`；对应 AT-10、TDD §4.4 和 UI/UX §6.3。

## 实现范围

- Rust `FileWatchRegistry` 对每个授权文件进行 150ms 轮询与 150ms 合并通知；文件删除、替换和内容变化统一发出 `document-changed`，前端同时在窗口获得焦点时复核磁盘版本。
- 自写保存事件先更新内存中的 `DiskVersion`，收到通知后比较 `fileId` 与 BLAKE3 摘要；相同版本直接忽略，不因自身保存进入冲突。监听读取失败与路径消失分开报告。
- `read_latest_document` 可读取路径上的最新身份，`adopt_document_version` 只有在版本仍完全匹配时才更新授权基线；替换后的文件不会被旧 token 静默写回。
- 冲突会话保留 `base/local/disk` 三份文本，并提供并排查看、重新加载磁盘版本、保留当前编辑、另存为和一次性明确覆盖。保留编辑调用 `SaveCoordinator.pause`，不会恢复自动保存。
- 外部删除进入 `missing` 会话，不自动创建原文件；另存副本会解绑旧监听并建立新文件监听。安全保存提交竞态继续沿用 FILE-03 的恢复目录和 `CONFLICT_DURING_COMMIT` 提示。

## 验证命令与结果

```text
pnpm exec prettier --check .                                  通过
pnpm lint                                                     通过
pnpm typecheck                                                通过
pnpm exec vitest run                                          通过：46 项
```

Rust 工具链未在当前环境 PATH 中提供，未能运行 `cargo fmt`、`cargo clippy` 和 `cargo test`；代码保持现有 Rust 版本和 Tauri 命令注册模式，待具备 Rust 工具链的 Windows 环境执行完整桌面验证。提交竞态备份与恢复行为由 FILE-03/FND-03 原型测试覆盖。

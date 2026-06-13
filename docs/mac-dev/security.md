# 桌面端安全规范

Last updated: 2026-06-08

## 继承规则

桌面端必须继承现有安全模型（`AGENT.md` 全部规则适用）：

- master password 永不发送到服务器。
- vault key 和 derived key 不进入日志、analytics、crash report、SQLite 普通表、普通文件。
- plaintext item 只存在于解锁后的 JS/Rust 内存中。
- 锁定必须清空 unlocked state、详情页明文、搜索结果明文和临时 copy 状态。
- 禁止在测试 fixture、截图、日志中放真实密码、真实 origin、真实用户名。
- 生产构建必须关闭调试日志中的请求 body、响应 body 和 crypto 参数输出。

## 桌面端特有规则

- macOS Keychain 条目必须使用设备专属可访问性策略（不同步到 iCloud）。
- Tauri IPC 消息不得包含 master password、derived key 或 plaintext credential。加密操作完全在 Rust 后端完成，仅加密结果跨越 IPC 边界。
- Rust 后端必须在使用后 zeroize 敏感字节数组（`zeroize` crate）。
- 生产构建必须禁用 WebView devtools。
- Tauri CSP (Content Security Policy) 必须严格：不允许 `unsafe-inline`、`unsafe-eval`。
- 窗口失焦时自动锁定（可配置）。
- 剪贴板：复制操作必须由用户点击触发；复制后显示"已复制"提示；平台允许时 30 秒后清空剪贴板。

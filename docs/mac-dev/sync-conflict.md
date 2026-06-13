# 桌面端同步与冲突策略

Last updated: 2026-06-08

## 同步流程

桌面端支持完整同步（非只读）：

1. 登录成功后获取 session user 和 CSRF token。
2. 用户输入 master password 解锁本地 vault key。
3. 拉取 item-level ciphertext。
4. 使用 `DesktopCryptoAdapter` 本地解密 item payload。
5. 将 ciphertext、revision、lastSyncedAt 写入 `DesktopCiphertextStore`。
6. UI 展示解锁后的内存 plaintext，不将 plaintext 持久化。

## 同步规则

- 自动同步可配置（默认开启），手动同步始终可用。
- 上行同步使用 `ItemLevelSyncPlan`，每个 upsert 包含 `baseItemRevision` 用于冲突检测。
- 服务端返回 `ItemLevelSyncResponse`，包含 applied IDs 和 conflicts。
- 冲突解决 UI：保留本地、接受远端、创建副本、跳过。
- Pull 返回所有 item 的 ciphertext 加上 `serverRevision`。
- 离线时展示最后缓存时间，并明确当前数据可能不是最新。
- 离线变更排队，恢复连接后自动或手动推送。

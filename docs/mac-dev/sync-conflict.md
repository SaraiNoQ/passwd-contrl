# 桌面端同步与冲突策略

Last updated: 2026-06-08

## 同步流程

桌面端当前支持服务端全量拉取和在线 CRUD 上行同步：

1. 登录成功后获取 session user 和 CSRF token。
2. 用户输入 master password 解锁本地 vault key。
3. 拉取 item-level ciphertext。
4. 使用 `DesktopCryptoAdapter` 本地解密 item payload。
5. 将 ciphertext、revision、lastSyncedAt 写入 `DesktopCiphertextStore`。
6. UI 展示解锁后的内存 plaintext，不将 plaintext 持久化。

## 同步规则

- 手动同步可用；自动同步和持久化离线 mutation queue 尚未完成。
- 上行同步使用 `ItemLevelSyncPlan`，每个 upsert 包含 `baseItemRevision` 用于冲突检测。
- 服务端返回 `ItemLevelSyncResponse`，包含 applied IDs 和 conflicts。
- 冲突解决 UI：保留本地、接受远端、创建副本、跳过。
- Pull 返回所有 item 的 ciphertext 加上 `serverRevision`。
- 离线时展示最后缓存时间，并明确当前数据可能不是最新。
- 离线读取缓存可用；离线变更排队仍是下一阶段工作。

当前冲突处理仅保证 `skip` 保留 marker。`keep_local`、`accept_remote` 和
`create_copy` 的完整双版本密文仲裁仍需实现并进行 Worker 联调。

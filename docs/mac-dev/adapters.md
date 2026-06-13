# 桌面端 Adapter 模式

Last updated: 2026-06-08

桌面端实现应先建立清晰 adapter 边界，避免把平台 API、网络、加密和 UI 状态混在页面组件里。

## `DesktopCryptoAdapter`

封装所有桌面端加密能力，通过 Tauri command 调用 Rust 原生 crypto-core：

- `deriveVaultKey`：从 master password 派生 vault key。
- `decryptItem`：解密单个 item。
- `encryptItem`：加密单个 item（用于 CRUD 操作）- `lock`：清理 JS 侧缓存的 key 和敏感状态。
- `generateRecoveryCode`：生成 256 位 recovery code。
- `deriveRecoveryKey`：从 recovery code 派生 recovery key。
- `generateDeviceKeypair`：生成 X25519 设备密钥对。
- `encryptVaultKeyForDevice`：为设备加密 vault key。
- `decryptVaultKeyOnDevice`：在设备上解密 vault key。

实现要求：

- 生产实现通过 `invoke('derive_vault_key', { ... })` 调用 Rust 原生函数。
- 初期可提供 `TestDoubleCryptoAdapter`（标记 `TEST_DOUBLE_NOT_FOR_PRODUCTION`）用于开发。
- 桌面端不需要加载 WASM — Rust 函数是原生的。
- 不在 JS 日志、异常 message、测试快照中输出 master password、derived key、vault key、plaintext item。
- 锁定时必须清理 JS 内存中的 unlocked snapshot 和敏感临时状态。

## `DesktopSecureStore`

封装 macOS Keychain：

- `getItem(key)`、`setItem(key, value)`、`deleteItem(key)`。
- `KeychainAdapter` — 通过 Tauri command 封装 `security-framework` crate，使用 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` 策略。
- `InMemorySecureStore` — 测试用内存存储。

可保存：session metadata、wrapped vault key reference、device ID。

不可保存：master password、明文密码、明文用户名、明文 notes、明文 origin。

## `DesktopCiphertextStore`

封装 SQLite 本地密文缓存：

- `getAll()`、`getById(itemId)`、`upsert(item)`、`delete(itemId)`。
- `getServerRevision()`、`setServerRevision(revision)`。
- `getLastSyncedAt()`、`setLastSyncedAt(timestamp)`。
- `getConflictIds()`、`setConflictIds(ids)`、`clear()`。
- `SqliteCiphertextStore` — 通过 Tauri command 使用 `rusqlite`，在 Rust 后端执行。
- `InMemoryCiphertextStore` — 测试用内存存储。

SQLite 中保存：encrypted item envelope、server revision、item revision、lastSyncedAt、conflict marker。

SQLite 中不得保存：master password、derived key、vault key、plaintext credential、recovery code。

## `DesktopApiClient`

封装 Worker API 通信：

- 复用现有 API URL 配置方式，不依赖 `NEXT_PUBLIC_*` 环境变量 — 使用 Tauri 配置或运行时参数。
- 使用 `fetch` + `credentials: "include"` 进行 HttpOnly cookie 认证。
- 复用 OPAQUE 登录（`@serenity-kit/opaque` WASM 在 WebView 中运行）、CSRF token 规则。
- 复用 `item_level_v1` sync plan/response。
- 统一处理离线、401、403、sync conflict、server revision advanced 等状态。

完整接口：

- `loginStart`、`loginFinish`（OPAQUE 两步登录）。
- `fetchCurrentUser`、`logout`。
- `pullItems`、`pushItemLevelSync`。
- `createItem`、`updateItem`、`deleteItem`（CRUD）。
- `registerDevice`、`approveDevice`、`revokeDevice`、`shareVaultKey`（设备信任）。
- `uploadRecoveryPacket`、`downloadRecoveryPacket`（恢复码）。

## `DesktopSyncService`

封装同步逻辑：

- `pullAll()`：拉取并缓存 ciphertext。
- `pushSync(plan)`：推送本地变更。
- `processPullResponse()`：存储 ciphertext、更新 server revision。
- `markConflicts()`：标记冲突项。
- `resolveConflict(itemId, strategy)`：解决冲突（保留本地/接受远端/创建副本/跳过）。

桌面端不新增 Worker API 协议。需要新增协议时，必须先更新 `packages/shared` schema、Worker API 测试和 Web 兼容说明。

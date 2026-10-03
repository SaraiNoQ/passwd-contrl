# Native Bridge

Last updated: 2026-07-16

> **实现状态：** Gradle 已定义双 ABI cargo-ndk 构建和 UniFFI Kotlin 生成任务，Expo Module、TypeScript bridge、`UniFfiRustCrypto`、`VaultRepository` 与生产 RN auth/crypto/Room adapters 已接线。2026-07-16 的历史快照曾在服务器通过 Rust client 与 Worker Serenity OPAQUE 的真实互操作、两个 Android ABI、Kotlin binding、debug APK 和 API 33–36 instrumented，`OPAQUE_INTEROP_VERIFIED` 已设为 `true`；当前及后续自动 Android 验证仅运行 API 36，`minSdk 26` 仍是安装兼容声明。初始化仍会在模块缺失或 native status 异常时使用 fail-closed unavailable adapter；真实注册/登录和完整业务 E2E 仍是门禁。

## 边界

Rust `crypto-core` 是 KDF、AEAD、item key、设备 ECDH 和恢复加密的唯一实现。UniFFI 生成 Kotlin binding；Expo Module 只暴露面向产品的粗粒度操作，不逐个转发底层 crypto primitive。

当前 bridge 暴露 OPAQUE start/finish/cancel、设备准备/绑定、初始 vault、解锁/生物识别/lock、item 加解密、恢复、生成器/TOTP、Room ciphertext/cursor/mutation/conflict 操作。返回值使用 DTO 和 session handle，不返回 key byte array；增加接口时仍应保持产品级粒度。

当前密文模型尚无独立的 vault verifier。Rust `mobile_unlock_vault` 因此只能创建候选 key session：非空密码库必须先成功认证并解密至少一个既有密文，才能向 UI 宣告解锁；失败立即销毁 handle。空密码库在增加版本化加密 verifier 前必须 fail closed，不能把“派生成功”误当成密码正确。

该空库 verifier 缺口是恢复/首次注册的已知限制，不能通过跳过认证或接受空列表解决。

## ABI 与构建

- 必需 ABI：`arm64-v8a`、`x86_64`；v1 不支持 32 位 ABI。
- 由 `cargo ndk -t arm64-v8a -t x86_64` 在远程容器构建 `.so`。
- module `preBuild` 依赖 binding 生成；必须通过当前 debug APK 的 ABI 内容和真实 native 调用证明进入 APK，独立 `cargo ndk` 成功不够。
- Kotlin binding 和 `.so` 版本必须携带相同 protocol/crypto version；不匹配时 fail closed。
- `release` 必须 strip symbol，但保留受控 native symbols 文件用于崩溃定位；文件不得包含敏感数据。

## 线程与生命周期

- Argon2id、数据库、网络和批量解密不得运行在 JS、UI 或 Binder 主线程。
- 每个异步调用支持取消；取消后清理口令 buffer、中间 key 和 plaintext。
- native session handle 带到期时间和 generation。锁定会递增 generation，使所有旧 handle 失效。
- FFI 输入要做长度、版本和 UTF-8 校验；Rust panic 不得穿过 FFI 边界。

## 错误

公开稳定错误码，例如 `AUTH_INVALID`、`DEVICE_PENDING`、`VAULT_LOCKED`、`KEY_INVALIDATED`、`CIPHERTEXT_TAMPERED`、`CONFLICT`、`NETWORK_OFFLINE`、`UNSUPPORTED_VAULT_FORMAT`。JS 获得安全文案和 correlation id；底层错误不得包含密码、key、ciphertext 或明文。

## 兼容向量

每个发布必须用固定非生产向量验证 Rust native 与 WASM 在 KDF 参数、AAD、nonce 格式、item envelope、recovery packet 和 device key packet 上互操作。向量验证包括成功、tamper、wrong-key、截断、未知版本；测试数据不得被产品代码接受为真实密钥。

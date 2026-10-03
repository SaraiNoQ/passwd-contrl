# Recovery

## Extension onboarding and local passwords (2026-10-03)

The extension joins an existing account through trusted-device approval. It does not register accounts, replace recovery packets or implement a new recovery scheme. Its local password wraps the shared vault key and protects the local device identity. Losing that password requires joining again in a fresh extension/browser profile, approved by another trusted device. Pending offline-only edits must be synchronized before removing an installation. Existing Web/mobile recovery flows and codes remain unchanged.

Last updated: 2026-10-03

> Android Recovery v2 的 Worker/shared/Rust/native/RN 信任重建链已实现，OPAQUE 跨实现互操作、debug APK 和原生 instrumented 已有通过证据。`20260730T124911Z-e2e-local-91529-15360` 已通过 clear-state 服务端重建、原密文解密、密码/恢复码轮换和旧密码拒绝；`20260730T125747Z-e2e-multidevice-api36-94573-25141` 已通过 replacement device 恢复及旧批准设备失效。真实 D1 与物理设备全丢失演练仍未完成。旧 Web `webcrypto-mvp` recovery packet 仍须在已有认证会话中迁移，不能直接用于 Android Recovery v2。

## Overview

Recovery codes allow a user to regain access to their vault without the master password. The recovery system is designed so that the server cannot decrypt the vault without the user's recovery code.

## Recovery Code Generation

1. The client generates 256 bits of cryptographically secure random data.
2. The random data is encoded as a base64url string (the "recovery code").
3. The recovery code is displayed to the user exactly once during setup.
4. The user is prompted to write the code on paper and store it offline.

The recovery code is never sent to the server at any point.

## Recovery Packet Creation

When the user sets up recovery:

1. The recovery code is fed through a KDF to derive a recovery key.
2. The recovery key encrypts the vault key, producing a recovery packet.
3. The recovery packet is sent to the server for storage.
4. The server stores only the encrypted recovery packet; it cannot decrypt it without the recovery key.

The recovery packet is bound to the user's account and stored alongside other encrypted server data.

### Recovery packet formats

**Android Recovery v2 (`crypto-core`)：**

- 32-byte 随机 recovery code，以 43 字符 canonical unpadded base64url 显示。
- Argon2id v1.3，64 MiB、3 iterations、parallelism 4，使用 packet 内 16-byte 随机 salt。
- XChaCha20-Poly1305，AAD `"zero-vault:recovery-packet:v2"`；固定 121-byte packet 包含 salt、nonce 与 `version + vault key + auth salt` 的密文。
- Ed25519 signing seed 由 vault key 和独立 auth salt 经 HKDF-SHA256 派生。服务端只保存 signing public key；私钥种子不离开 Rust。

以下是仍存在的旧双运行时格式，只用于兼容/迁移说明：

The recovery KDF and cipher depend on the crypto runtime:

**`crypto-core-wasm` (Rust):**
- KDF: Argon2id v1.3 with domain-separation salt `"zero-vault-recovery-v1"`.
- Cipher: XChaCha20-Poly1305 with AAD `"zero-vault:recovery:v1"`.
- Source: `crates/crypto-core` `derive_recovery_key`, `encrypt_recovery_packet`, `decrypt_recovery_packet`.

**`webcrypto-mvp` (Web Crypto API, current Web Vault default for recovery):**
- KDF: PBKDF2-SHA256 with 600,000 iterations and salt `"zero-vault-recovery-salt"`.
- Cipher: AES-256-GCM with AAD `"zero-vault.recovery.v1"`.
- Source: `apps/web/lib/recovery.ts`.

The Web Vault currently uses the `webcrypto-mvp` path for recovery regardless of vault runtime. The Rust `crypto-core-wasm` recovery functions are available but not yet integrated into the Web Vault recovery flow.

## Android Recovery v2 Flow

1. 客户端以新主密码开始一次 OPAQUE registration，并请求 `/auth/recovery/start`。Worker 对已知 v2、旧 v1 和未知账户返回相同结构；非 v2 使用确定性假 recovery material，避免通过响应形状枚举账户。
2. 客户端只在本地用 recovery code 打开 v2 packet，恢复 vault session 和一次性 recovery proof handle，并核对 packet 派生的 signing public key 与 Worker 记录一致。
3. 客户端生成下一代 recovery code/packet/signing public key、新设备 X25519 身份和只面向该设备的 encrypted vault-key packet。
4. Rust 使用旧恢复材料派生的 Ed25519 key，对包含一次性 challenge、OPAQUE 新 registration record、新恢复材料和新设备材料的规范 transcript 签名。proof handle 最多存活 10 分钟，并在签名尝试时消费。
5. `/auth/recovery/finish` 验证签名和所有绑定字段。Worker 以 claim-first D1 batch 原子地递增 `auth_epoch`、更新 OPAQUE record、撤销全部旧 session/设备/key packet、登记唯一 approved replacement device，并轮换恢复 packet/signing key。
6. finish 只返回 `{ ok: true }`，不返回 bearer 或 key。客户端随后以新密码走正常 OPAQUE 登录，取得绑定 replacement device 的 bearer，并从只面向该设备的 packet 安装 vault key。
7. 新 recovery code 仅在本地绑定完成后展示一次；旧码、旧 session、旧设备和重放 challenge 均应失效。

超时发生在已发送 finish 之后时，客户端不得猜测提交结果或重复使用 proof；它保留本地 continuation 材料，并以新密码登录来判定服务端是否已经提交。若服务端返回 pending，已有本地身份时撤销试探 session 并回退；没有旧身份时丢弃未提交 rotation，转成普通待审批设备，避免展示未绑定恢复码。

## Legacy Web Recovery Flow

Device-approved enrollment is separate from recovery. A joining browser's local password wraps the account vault key, and password changes preserve that key. This does not convert legacy Web recovery packets to Recovery v2 or establish Android recovery compatibility for an unconverted account.

When a user needs to recover access:

1. The user enters their recovery code in the Web Vault.
2. The client derives the recovery key from the code via the active recovery KDF.
3. The client fetches the recovery packet from the server.
4. The client decrypts the recovery packet using the recovery key, recovering the vault key.
5. The vault is unlocked with the recovered vault key.
6. The user can optionally set a new master password, which re-wraps the vault key.

The server sees only the fetch request for the recovery packet. It never sees the recovery code or the derived recovery key.

## Security Properties

- **Server cannot decrypt:** The recovery packet is encrypted with a key derived from the recovery code. Without the code, the packet is indistinguishable from random data.
- **Code never transmitted:** The recovery code stays on the client. It is not sent during setup, storage, or recovery.
- **Offline storage recommended:** The code should be written on paper and stored in a physically secure location (safe, lockbox). Digital copies increase the risk of compromise.
- **Code rotation:** If a user suspects their recovery code has been compromised, they can generate a new one. This creates a new recovery packet and invalidates the old one.

## Backup Recommendation

Write the recovery code on paper. Store it in a physically secure location separate from the device. Do not store the code in:

- Email.
- Cloud storage.
- Notes apps.
- Screenshots.
- Password managers (the code is for recovering the password manager itself).

If the recovery code is lost and the master password is forgotten, the vault cannot be recovered. This is by design; there is no server-side backdoor.

## Android handling rules

Android uses Rust `crypto-core` through UniFFI. The recovery code necessarily exists briefly in the RN secure input/call stack, but it must never be persisted, logged, copied automatically or sent to the API; the server only returns/stores an encrypted recovery packet. Screenshots, clipboard, Android backup and logs must not retain the code.

### Current production gate

Recovery-authorized device enrollment is now implemented with a replay-resistant single-use claim, rate limits, account-enumeration-resistant fake material, a fresh device public key, `auth_epoch` revocation and atomic recovery rotation. The code path is intended to cover “recovery code → replacement device → approved device-bound session → vault sync” without exposing the vault key to the server.

This is not yet a verified production guarantee. The remote Rust↔Serenity OPAQUE gate and Worker recovery tests have passed and `OPAQUE_INTEROP_VERIFIED` is now `true`; release still requires current APK evidence, D1 deployment tests, old-code/replay/expiry coverage, crash/continuation cases, process restart, log/backup leakage checks and an all-devices-lost E2E.

Android also rejects legacy `webcrypto-mvp` AES/PBKDF2 recovery/vault formats. Web currently creates PBKDF2/AES recovery packets even for its Rust vault runtime, so the production migration must both re-encrypt vault/item data and rotate the recovery packet into the versioned Rust `crypto-core` format before Android recovery is offered.

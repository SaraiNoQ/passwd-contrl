# Architecture

> Android 分层已有 Rust/UniFFI、Kotlin Repository/Room/Keystore、RN adapters、Recovery v2 信任重建和系统服务源码。2026-07-16 的历史快照曾通过 OPAQUE 跨实现互操作、双 ABI bindings、Room v2 schema/migration、debug APK 和 API 33–36 instrumented；当前及后续自动 Android 验证仅运行 API 36，`minSdk 26` 仍是安装兼容声明。完整业务 E2E 与 release 仍未完成，权威状态见 `docs/android-dev/overview.md`。

Zero Vault is split into clients that hold secrets and a sync service that only stores encrypted records.

## Components

- `apps/web`: Web Vault for vault management, import, recovery setup, and future account settings.
- `apps/extension`: Manifest V3 extension for form detection and user-confirmed fill.
- `apps/worker-api`: Sync API (Cloudflare Worker + Hono). It stores registration records, encrypted recovery packets, encrypted vault items, and revision metadata in D1.
- `packages/shared`: DTOs and runtime validation schemas shared by app, API, and extension.
- `crates/crypto-core`: Rust KDF and AEAD primitives. It should become the only implementation of key derivation and item encryption.
- `apps/mobile`: Android-first Expo UI. Its target native architecture has Kotlin `VaultRepository` owning Room, Keystore, system services, and Rust UniFFI access; Autofill must not depend on the React Native process.

## Data Flow

1. A client derives keys locally from the master password and device material.
2. A vault item is serialized locally and encrypted locally.
3. The API receives only encrypted envelopes and a revision number.
4. Other clients pull encrypted envelopes and decrypt locally after unlock.
5. The browser extension receives fillable credentials only after the user unlocks and confirms a matched origin.

In the Android architecture, Room is the local ciphertext and sync-metadata source of truth. JavaScript holds only a short-lived native session handle; vault keys, device private keys, OPAQUE state, and Keystore wrapping keys remain native. This is a security contract, not a claim that the current APK has passed its remote gates. See `docs/android-dev/architecture.md`.

## Server Boundary

The API must not hold master passwords, plaintext item data, plaintext domains, plaintext usernames, plaintext notes, or recovery codes. The Worker API uses D1 (SQLite) for all persistent storage.

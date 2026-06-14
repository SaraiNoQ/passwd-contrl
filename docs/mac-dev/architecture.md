# 桌面端架构设计

Last updated: 2026-06-14

## Monorepo 位置

桌面端在 monorepo 中的位置：

```
apps/web           — Web Vault (Next.js) — 不变
apps/desktop       — macOS 桌面端 (Tauri 2.x) — 新增
apps/extension     — Manifest V3 浏览器扩展 — 不变
apps/worker-api    — Cloudflare Worker API — 不变
apps/mobile        — React Native + Expo — 不变
packages/shared    — DTO 和 validation schema — 共享
crates/crypto-core — Rust KDF 和 AEAD 原语 — 共享（原生库）
```

## 应用启动流程

1. `main.tsx` 调用 `initializeApp()`（`src/lib/init.ts`）。
2. `init.ts` 创建并注入生产 adapter：
   - `DesktopApiClient`（默认 `http://localhost:8787`）。
   - `TauriCryptoAdapter`（通过 Tauri IPC 调用 Rust crypto-core）。
   - `KeychainAdapter`（macOS Keychain）。
   - `SqliteCiphertextStore`（Tauri/Rust SQLite 密文缓存）。
3. React 渲染 `<App />`：
   - `auth.restoreSession()` — 尝试恢复会话（`GET /auth/me`）。
   - `vault-state` 检测 `vault_salt` 是否存在 → 设置 `hasLocalVault`。

## 数据流

1. 用户在登录表单输入 email/password → `POST /auth/login/direct` → Worker API 创建/恢复用户 session → 返回 `{user, csrfToken}` + `Set-Cookie`。
2. 登录后进入 FORGE MODE 或 UNLOCK MODE（取决于 `hasLocalVault`）。
3. 用户输入 master password。
4. 桌面端通过 Tauri command 调用 Rust `derive_vault_key`（原生 FFI，非 WASM）。
5. **FORGE MODE**：生成随机 salt + Argon2id 参数 → 派生 vault key → 存入 macOS Keychain。
6. **UNLOCK MODE**：从 Keychain 读取 salt + 参数 → 派生 vault key → 解密本地密文缓存。
7. 明文仅存在于 JS 内存中，解锁状态下有效。
8. 锁定时清除所有敏感 JS 状态。

## 与 Web 的关键架构差异

- Web 通过 `@zero-vault/crypto-core-wasm` 加载 WASM 加密模块。
- 桌面端通过 Tauri `invoke` 命令系统直接调用 Rust 原生函数。
- Tauri command 作为桥接层：Rust 后端暴露 `derive_vault_key`、`decrypt_item`、`encrypt_item` 等命令，前端通过 `@tauri-apps/api/core` 的 `invoke` 调用。
- 桌面端不能直接 import Web 组件、CSS Modules、Next.js 页面或浏览器专用 hooks；Web 只作为视觉和交互参考。
- 桌面端 UI 视觉以 `docs/DESIGN.md` 和当前 Web Vault 已落地界面为准，保持 Cloud Mist 亮色主题。

## Tauri Command 桥接模式

```rust
// src-tauri/src/crypto.rs
#[tauri::command]
pub fn derive_vault_key(
    master_password: String,
    salt: Vec<u8>,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<Vec<u8>, String> {
    // 调用 crypto-core 原生函数
    crypto_core::derive_vault_key(&master_password, &salt, memory_kib, iterations, parallelism)
        .map_err(|e| e.to_string())
}
```

```typescript
// src/lib/crypto/desktop-crypto-adapter.ts
import { invoke } from "@tauri-apps/api/core";

async function deriveVaultKey(
  masterPassword: string,
  salt: Uint8Array,
  params: { memoryKib: number; iterations: number; parallelism: number }
): Promise<Uint8Array> {
  const result = await invoke<number[]>("derive_vault_key", {
    masterPassword,
    salt: Array.from(salt),
    memoryKib: params.memoryKib,
    iterations: params.iterations,
    parallelism: params.parallelism,
  });
  return new Uint8Array(result);
}
```

## 目录结构

```
apps/desktop/
  src/                       — React 前端
    components/              — UI 组件
    lib/
      api/                   — DesktopApiClient, types
      crypto/                — DesktopCryptoAdapter
      storage/               — DesktopSecureStore, DesktopCiphertextStore
      sync/                  — DesktopSyncService
      init.ts                — 应用引导：创建并注入 DesktopApiClient
      clipboard.ts           — 剪贴板工具
      csv-import.ts          — CSV 解析
      utils.ts               — cn() 等工具函数
    state/                   — useAuthState, useVaultState (React hooks)
    components/
      credentials/           — CredentialList, CredentialRow, CredentialRowItem (memoized), CredentialDetail, AddEditDrawer, ConfirmDeleteDialog
    theme/                   — CSS token（复制自 Web tokens.css）
    test/                    — 前端测试
  src-tauri/                 — Rust 后端
    src/
      crypto.rs              — Tauri commands 桥接 crypto-core
      keychain.rs            — Keychain 安全存储 commands
      db.rs                  — SQLite 密文缓存 commands
      main.rs                — Tauri app 入口
    Cargo.toml               — 依赖 crypto-core (path = "../crates/crypto-core")
    tauri.conf.json           — Tauri 配置（窗口、权限、打包）
  package.json               — pnpm workspace 脚本
  tsconfig.json              — TypeScript 配置
  vite.config.ts             — Vite 配置（如果使用 Vite SPA）
```

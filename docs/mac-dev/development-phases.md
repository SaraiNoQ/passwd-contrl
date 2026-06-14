# 桌面端开发阶段规划

Last updated: 2026-06-14

## 阶段 0：规范文档 — 已完成

- 新增本文档集（`docs/mac-dev/` 目录下 10 个文档）。
- AGENT.md 补充桌面端文档索引和 `apps/desktop` 架构条目。
- 不修改 Web UI。

## 阶段 1：桌面端 scaffold — 已完成

- 创建 `apps/desktop` Tauri 2.x + React + TypeScript 工程。
- 手动创建（非 `pnpm create tauri-app`）以获得完全控制。
- 接入 pnpm workspace（`apps/*` 自动覆盖）。
- `package.json` scripts：`dev`（vite）、`build`（tsc + vite build）、`typecheck`（tsc --noEmit）、`test`（vitest run）。
- 目录结构：
  - `src/` — React 前端入口（main.tsx、App.tsx）
  - `src/theme/` — tokens.css（复制自 Web）、globals.css
  - `src/components/`、`src/lib/api/`、`src/lib/crypto/`、`src/lib/storage/`、`src/lib/sync/`、`src/state/`、`src/test/` — 空目录骨架
  - `src-tauri/` — Rust 后端（main.rs、lib.rs、crypto.rs、keychain.rs、db.rs）
  - `src-tauri/Cargo.toml` — 依赖 tauri 2.x、crypto-core（path）、rusqlite、keyring、zeroize
  - `src-tauri/tauri.conf.json` — Obscura 窗口配置、严格 CSP、最小权限
- CSS token 值复制到 `src/theme/tokens.css`（148 行，与 Web 完全一致）。
- 基础窗口配置：1200×800，最小 800×600，居中。
- 验收：typecheck 通过、cargo check 通过、Web 测试 116 通过、Shared 测试 38 通过。
- 修复项：tsconfig.node.json 添加 `composite: true`、Cargo.toml crypto-core 路径修正为 `../../../crates/crypto-core`、移除 `macos-private-api` feature、修正 db.rs/keychain.rs 浮动 doc comment、创建占位 icon PNG。

## 阶段 2：认证与只读数据流 — 进行中

- [x] 实现 `DesktopApiClient`（`src/lib/api/desktop-api-client.ts`）。
  - `loginStart`/`loginFinish`（OPAQUE 两步登录）。
  - `fetchCurrentUser`、`logout`。
  - `pullItems`（拉取 item-level ciphertext）、`pushItemLevelSync`。
  - `createItem`、`updateItem`、`deleteItem`（CRUD 扩展）。
  - `registerDevice`、`listDevices`、`approveDevice`、`revokeDevice`、`shareVaultKey`。
  - `uploadRecoveryPacket`、`downloadRecoveryPacket`。
  - 统一处理 401、403、离线、request_timeout。
  - 12 单元测试通过。
- [x] 实现 `useAuthState`（`src/state/auth-state.ts`）。
  - `login`、`logout`、`restoreSession`、`clearError`。
  - `configureApiClient` 依赖注入。
  - 中文错误消息。
  - 18 单元测试通过。
- [x] 实现 `DesktopSyncService`（`src/lib/sync/desktop-sync-service.ts`）。
  - `pullAll`、`pushSync`、`resolveConflict`。
  - 12 单元测试通过。
- [x] 实现 `useVaultState`（`src/state/vault-state.ts`）。
  - `unlock`、`lock`、`sync`、`clearError`、`setAutoLockMinutes`。
  - `configureVaultDependencies` 依赖注入。
  - 12 单元测试通过。

## 阶段 3：原生 crypto adapter — 已完成

- [x] 定义 `DesktopCryptoAdapter` 接口（`src/lib/crypto/desktop-crypto-adapter.ts`）。
- [x] 实现 `TauriCryptoAdapter`（生产实现，通过 Tauri invoke 调用 Rust）。
- [x] 实现 `TestDoubleCryptoAdapter`（标记 `TEST_DOUBLE_NOT_FOR_PRODUCTION`）。
- [x] 在 `src-tauri/src/crypto.rs` 中实现 8 个 Tauri commands，调用 `crypto-core` 原生函数：
  - `derive_vault_key`、`decrypt_item`、`encrypt_item`
  - `generate_recovery_code`、`derive_recovery_key`
  - `generate_device_keypair`、`encrypt_vault_key_for_device`、`decrypt_vault_key_on_device`
- [x] 7 个 Rust 单元测试通过（round-trip、wrong-key、recovery code、device keypair）。
- [x] 14 个 TypeScript 单元测试通过（TestDouble 所有方法）。

## 阶段 4：安全存储与密文缓存 — 已完成

- [x] 实现 `DesktopSecureStore`（`src/lib/storage/desktop-secure-store.ts`）。
  - `KeychainAdapter` — Tauri command 桥接 macOS Keychain（`keyring` crate）。
  - `InMemorySecureStore` — 测试用内存存储。
  - 8 单元测试通过。
- [x] 实现 `DesktopCiphertextStore`（`src/lib/storage/desktop-ciphertext-store.ts`）。
  - `SqliteCiphertextStore` — Tauri command 桥接 rusqlite（`DbConnection` Mutex 包装）。
  - `InMemoryCiphertextStore` — 测试用内存存储。
  - 19 单元测试通过。
- [x] Rust 侧实现：keychain.rs（3 commands + 4 tests）、db.rs（12 commands + 6 tests）。
- [x] main.rs setup() hook 初始化 SQLite + 注册所有 commands。

## 阶段 4b：完整 CRUD — 已完成

- [x] 实现 `AddEditDrawer` — login/secure_note/credit_card 三类型、表单验证、自定义字段、丢弃确认。
- [x] 实现 `ConfirmDeleteDialog` — 破坏性确认对话框。
- [x] 实现 `PasswordGenerator` — 长度滑块、字符集切换、强度指示器。13 测试通过。
- [x] vault-state 添加 `addItem`/`updateItem`/`deleteItem` — 加密→推送→本地存储→更新状态。18 测试通过。
- [x] App.tsx 接入 CRUD — drawer 打开/关闭、保存、删除确认、Toast 反馈、自动同步。

## 阶段 5：导入与恢复 — 已完成

- [x] 实现 `csv-import.ts` — CSV 解析支持 Chrome/Firefox/Bitwarden/1Password/LastPass。24 测试通过。
- [x] 实现 `CsvImportWizard` — 5 步向导（文件选择→预览→字段映射→验证→导入确认）。
- [x] 实现 `RecoverySetup` — 3 步恢复码生成向导（生成→备份提示→验证）。
- [x] 实现 `RecoveryModal` — 恢复码解锁模态框（派生 key → 解密 vault key → 解锁）。
- [x] 恢复码操作完全在客户端完成，永不发送到服务器。

## 阶段 6：Shell 布局与 UI 组件 — 已完成

- [x] 实现 UI 原语组件：Button、Input、Toast、Modal、Badge（CSS Modules + tokens.css）。
- [x] 实现 `cn()` 工具函数。
- [x] 实现 Sidebar（导航、logo、同步状态、锁定按钮）。
- [x] 实现 TopBar（搜索、同步按钮、自动锁定计时器）。
- [x] 实现 LockedState（master password 表单、恢复码入口、错误显示）。
- [x] 实现 CredentialList、CredentialRow、CredentialDetail。
- [x] 实现 App.tsx 主编排组件（登录/锁定/解锁三态、页面路由）。
- [x] 实现剪贴板工具（`copyToClipboard` + 中文安全提示）。
- [x] 所有 CSS 使用 tokens.css 自定义属性，视觉风格与 Web 一致。

## 阶段 6b：设备信任与冲突解决 — 已完成

- [x] 实现 `DeviceManagementPanel` — 设备列表（pending/active/revoked）、注册新设备、审批/撤销。
- [x] 实现 `ConflictResolutionPanel` — 冲突列表、四种解决策略、批量解决、并排对比。
- [x] 实现 `SyncPanel` — 同步状态、手动同步、活动日志时间线。
- [x] 18 设备管理测试 + 25 冲突解决测试通过。

## 阶段 7：打磨与收尾 — 基础完成，发行前验证进行中

- [x] 完善设置页面（自动锁定时间、master password 修改、CSV/加密导出、账户删除、关于信息）。14 测试通过。
- [x] 实现自动锁定（vault-state 中 autoLockMinutes + 超时锁屏）。
- [x] 实现 macOS 菜单栏（Tauri 2.x `tauri::menu` API）。
  - 标准菜单：Obscura（关于、偏好设置、退出）、文件（新建凭据、导入 CSV）、编辑（撤销、重做、剪切、复制、粘贴、全选）、显示（搜索、全屏、重新加载、开发者工具）、密码库（锁定、同步）、窗口（最小化、最大化、全部前置）。
  - 自定义快捷键：Cmd+L（锁定）、Cmd+K（搜索）、Cmd+N（新建凭据）、Cmd+,（设置/偏好设置）、Cmd+S（同步）、Cmd+R（重新加载）。
  - 菜单事件通过 `app.emit()` 发送到前端。
- [x] 更新 `docs/roadmap.md` 添加桌面端 phase。
- [ ] Tauri 真机 smoke：登录、首次铸造、重启后 Keychain/SQLite 恢复、菜单快捷键、导入、恢复码、设备审批、同步冲突。
- [ ] macOS 打包、签名、公证、DMG 分发。

## 阶段 7b：Bug 修复与性能优化 — 已完成 (2026-06-08)

### Bug 修复

#### #1 登录页面"发生未知错误"

**根因：** `configureApiClient()` 从未在生产代码中调用，`apiClient` 单例为 `null`。`getClient()` 抛出异常后 `getErrorMessage()` 找不到映射，fallback 到"发生了未知错误"。

**历史问题：** 当时 `DesktopApiClient` 缺少发行登录实现；该 direct-login 临时路径现已被 OPAQUE 两步登录替代。

**修复：**
- 新建 `src/lib/init.ts`（应用引导文件），创建 `DesktopApiClient` 实例并注入 `auth-state` 和 `vault-state`。
- `src/lib/api/desktop-api-client.ts` — 当前使用 `loginStart`/`loginFinish` OPAQUE 两步协议。
- `src/lib/api/types.ts` — `logout` 返回类型 `Promise<void>` → `Promise<{ ok: true }>`（匹配实现）。
- `src/main.tsx` — React 渲染前调用 `initializeApp()`。

#### #2 登录页面"网络错误，请检查连接"

**根因：**
1. CSP `connect-src` 不含 `http://localhost:8787`，WebView 阻止 fetch。
2. Worker API 的 `/auth/login/direct` 端点不存在（桌面/移动端调用但服务端未实现）。
3. Worker API 开发服务器未运行。

**修复：**
- `src-tauri/tauri.conf.json` — CSP `connect-src` 增加 `http://localhost:8787`。
- `apps/worker-api/src/routes/auth.ts` — 新增 `POST /auth/login/direct` 端点。MVP 方案：自动创建用户（使用占位 OPAQUE 字段），生成 session token + CSRF，设置 HttpOnly cookie。149 worker-api 测试通过。

#### #3 登录后"未找到本地密码库"

**根因：** 桌面端 `LockedState` 组件仅有 UNLOCK MODE，缺少首次创建密码库的 FORGE MODE。登录后直接跳到解锁页面，`unlock()` 因 `vault_salt` 不存在而失败。

**修复：**
- `src/state/vault-state.ts` — 新增 `hasLocalVault` 状态（挂载时检测 `vault_salt`）；`unlock()` 自动处理两态：无 vault → 生成 salt + Argon2id 参数 → 派生密钥 → 持久化（FORGE MODE）；有 vault → 读取参数 → 派生密钥 → 解密（UNLOCK MODE）。
- `src/components/shell/locked-state.tsx` — 新增 `hasLocalVault` prop；FORGE MODE 显示"铸造主密钥"/"开始铸造"，UNLOCK MODE 显示"唤醒本地密钥"/"解锁密码库"；恢复码入口仅在已有密码库时显示。
- `src/App.tsx` — 传递 `hasLocalVault` 给 `LockedState`。
- `src/test/vault-state.test.ts` — 更新测试：缺少 vault params 时期望 auto-create 成功。

### 性能优化

#### 渲染优化：React memoization

| 优化 | 文件 | 机制 |
|------|------|------|
| `useVaultState` 返回值 memoized | `vault-state.ts` | `useMemo` 包装返回对象，阻止 App.tsx 回调级联失效 |
| `useAuthState` 返回值 memoized | `auth-state.ts` | 同上 |
| `Sidebar` → `React.memo` | `sidebar.tsx` | 纯展示组件，props 不变时跳过渲染 |
| `TopBar` → `React.memo` | `top-bar.tsx` | 同上 |
| `CredentialRow` → `React.memo` | `credential-row.tsx` | 列表行仅在自身数据变化时重渲染 |
| `CredentialRowItem` 包裹组件 | `credential-list.tsx` | 消除 `.map()` 体内联函数和对象；每项独立 memo |
| `totalCount` 移入 `useMemo` | `credential-list.tsx` | 避免每次渲染重复 `filter(isLogin)` |
| `handleNavigate` → `useCallback` | `App.tsx` | Sidebar `onNavigate` 引用稳定化 |
| `handleSave`/`handleConfirmDelete` 依赖窄化 | `App.tsx` | `[vault, auth]` → `[addItem, updateItem, csrfToken, ...]` |

#### 渲染优化：CSS GPU compositing

| 优化 | 文件 | 机制 |
|------|------|------|
| `@keyframes progressIndeterminate` 替代 layout 属性 | `csv-import-wizard.module.css` | `margin-left`/`width` → `transform: translateX()`，compositor-only |
| 5 个 overlay 添加 `will-change: backdrop-filter, opacity` | `add-edit-drawer`, `confirm-delete-dialog`, `modal` | blur 提前提升到 GPU 层 |
| drawer/modal 添加 `will-change: transform` | `add-edit-drawer`, `modal` | 入场动画避免每帧重光栅化 |
| `.loadingSpinner` 添加 `will-change: transform` | `locked-state.module.css` | 旋转动画提升到 GPU 层 |

#### 构建优化

| 优化 | 文件 | 效果 |
|------|------|------|
| 字体自托管 | `index.html` + `public/fonts.css` + `public/fonts/` | 消除 Google Fonts 渲染阻塞请求；离线可用；CSP 不冲突 |
| `vite target: safari14 → safari15` | `vite.config.ts` | 减少不必要的语法转译 |
| React/ReactDOM 独立 chunk | `vite.config.ts` | `manualChunks` 分离 react vendor chunk |

### 验证

- 类型检查：通过
- 桌面端测试：210/210 通过（2026-06-14 最新验证）
- Worker API 测试：149/149 通过
- Vite 构建：通过（主包 178KB + react 12KB + CSS 59KB，无外部网络依赖）

## 阶段 7c：主应用编排与文档校准 — 已完成 (2026-06-14)

### 主应用编排

- `App.tsx` 移除 dashboard/sync/devices 占位页，接入真实页面编排：
  - Dashboard：显示条目数量、类型统计、同步状态、冲突数、设备数和自动锁定。
  - Credentials：保留列表、详情、新增/编辑抽屉、删除确认。
  - Import：接入 `CsvImportWizard`，导入后转为 login item 并通过现有加密/同步链路写入。
  - Recovery：接入 `RecoverySetup` 和 `RecoveryModal`，由父级创建 AES-GCM recovery packet 并上传。
  - Sync：接入 `SyncPanel` 与 `ConflictResolutionPanel`，读取本地 ciphertext store 快照。
  - Devices：接入 `DeviceManagementPanel`，注册/审批/拒绝/撤销走现有 Worker API 设备信任协议。
  - Settings：接入主密码本地 key-wrap 轮换、明文 CSV 风险确认、加密备份和 server-first 账户删除。
- 登录页使用 email/password 表单和 OPAQUE `loginStart`/`loginFinish`。
- `initializeApp()` 生产启动路径注入真实 `TauriCryptoAdapter`、`KeychainAdapter`、`SqliteCiphertextStore`，不再默认使用测试替身/内存存储。
- 接入 Tauri 菜单事件和键盘快捷键：
  - Cmd+N 新建凭据。
  - Cmd+K 聚焦搜索。
  - Cmd+L 锁定。
  - Cmd+S 同步。
  - Cmd+, 打开设置。
  - 菜单导入 CSV、偏好设置、重新加载触发前端行为。

### 协议对齐

- `DesktopApiClient` 的设备信任路径与 Worker/Web 对齐：
  - `POST /devices`
  - `POST /devices/:id/reject`
  - `POST /devices/:id/share-key`
- 未新增服务端协议，未修改 Web 代码。

### 验证

- 类型检查：通过。
- 构建：通过。
- 桌面端测试：210/210 通过。
- Worker API 测试：150/150 通过。
- Vite production build：通过。

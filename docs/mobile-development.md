# Zero Vault 移动端开发规范

Last updated: 2026-06-08

本文档是 Zero Vault 移动端 App 开发的主规范。当前阶段只规划移动端开发方式，不创建 `apps/mobile`，不修改 `apps/web`，不调整现有 Web Vault 的前端显示效果。

移动端路线固定为 **React Native + Expo + TypeScript**。当前产品阶段固定为 **MVP 解锁同步**：用户可以在移动端登录、解锁、同步、查看并复制凭据，但不在移动端完成完整密码库管理闭环。

## 目标与边界

移动端 App 是独立客户端，不是 Web Vault 的响应式改造，也不是把 Next.js 页面嵌入 WebView。

必须做到：

- 复用现有零知识架构、同步协议、DTO/schema 和 Rust 加密核心。
- 保持服务器只接收密文、revision、设备元数据，不接收 master password、vault key、明文凭据、recovery code。
- 移动端开发不得破坏 Web Vault 或浏览器扩展的 UI、协议和测试。
- 中文为默认界面语言，文案沿用 `docs/ui-development.md` 的安全表达原则。

当前 MVP 包含：

- 账号登录与会话恢复。
- 主密码解锁与本地锁定。
- 拉取、缓存、解密并展示密文条目。
- 凭据列表、凭据详情、复制用户名和密码。
- 离线读取已缓存密文。
- 手动同步状态展示。

当前 MVP 不包含：

- 新增、编辑、删除凭据。
- CSV 导入。
- 恢复码设置与恢复码解锁 UI。
- 设备信任审批 UI。
- 完整冲突解决 UI。
- Android Autofill。
- iOS Credential Provider。

如果同步返回冲突，MVP 只提示“需在 Web 端处理冲突”，不在移动端解决冲突。

## 技术栈

未来移动端工程使用 `apps/mobile`，继续纳入现有 `pnpm-workspace.yaml` 的 `apps/*` workspace 结构。

推荐栈：

| 层级 | 技术 | 规范 |
| --- | --- | --- |
| App 框架 | Expo managed workflow + development builds | 接入 Rust native crypto 后不依赖 Expo Go |
| 语言 | TypeScript | 与现有 Web/shared 包保持同一类型风格 |
| UI | React Native 原生组件 | 不复用 Web CSS Modules、DOM 组件或 Next.js 页面 |
| 路由 | Expo Router | 文件路由，按功能分组 screen |
| API 类型 | `packages/shared` | 复用 zod schema 与 DTO 类型 |
| 加密核心 | `crates/crypto-core` + UniFFI | 生成 Kotlin/Swift 绑定，再通过 Expo native module 暴露给 RN |
| 安全存储 | Expo SecureStore / platform keystore adapter | 仅存小型敏感材料和 key reference |
| 本地密文缓存 | SQLite | 保存 ciphertext、revision、lastSyncedAt、conflict marker |
| 测试 | Vitest/Jest + RN Testing Library + mobile E2E smoke | 与 Web/shared/Rust 检查共同构成移动端 PR gate |

加密实现优先遵循 `crates/crypto-core/MOBILE_PLAN.md`。移动端不能重新实现一套与 Rust 核心不一致的 KDF、AEAD 或设备信任算法。

## 与 Web 的隔离规则

移动端相关改动必须遵守以下规则：

- 不修改 `apps/web/app/*`、`apps/web/components/*` 的视觉样式、布局和交互来服务移动端。
- 不通过重命名全局 CSS token、替换 Web 组件、调整 Web CSS Modules 来适配移动端。
- 不从 `apps/web` 直接 import React 组件、CSS Modules、Next.js 页面或浏览器 DOM 专用 hook。
- 可复用的业务逻辑应逐步抽到 `packages/*`，并保持 Web 端测试通过。
- 涉及共享包的改动必须证明 Web、Extension、Worker API 的协议行为没有回退。

允许复用：

- `packages/shared` 中的 schema、DTO 和协议类型。
- `crates/crypto-core` 中的加密能力。
- Worker API 的现有 OPAQUE 登录、session、CSRF 和 item-level sync 协议。
- `docs/ui-development.md` 中的视觉原则、中文文案原则和安全边界。

不允许复用：

- Web 的 CSS Modules。
- Web 的 DOM 事件、`navigator.clipboard` 直接实现、`localStorage` 直接实现。
- Web 的 Next.js route、layout、page 或 app router 结构。
- 浏览器扩展 messaging 作为移动端数据通道。

## 模块边界

移动端实现时应先建立清晰 adapter 边界，避免把平台 API、网络、加密和 UI 状态混在 screen 组件里。

### `MobileCryptoAdapter`

封装所有移动端加密能力：

- master password 到 vault key 的派生。
- item payload 解密。
- item-level sync 所需的 item encrypt/decrypt。
- recovery/device crypto 的未来占位。
- Rust native module 初始化与错误归一化。

实现要求：

- 初期可以提供接口和测试替身，但生产解密必须接入 `crypto-core` UniFFI/Expo native module。
- 不在 JS 日志、异常 message、测试快照中输出 master password、derived key、vault key、plaintext item。
- 锁定时必须清理 JS 内存中的 unlocked snapshot 和敏感临时状态。

### `MobileSecureStore`

封装平台安全存储：

- 可保存 session metadata、wrapped vault key reference、device id 等小型敏感材料。
- 不保存 master password。
- 不保存明文密码、明文用户名、明文 notes、明文 origin。
- 不把完整 vault plaintext 放入 SecureStore。

Android 应依赖 Keystore 保护密钥材料。iOS 应依赖 Keychain，并优先使用仅本设备可访问的策略。

### `MobileCiphertextStore`

封装 SQLite 本地密文缓存：

- 保存 encrypted item envelope。
- 保存 server revision、item revision、lastSyncedAt。
- 保存 conflict marker，但不保存明文冲突内容。
- 支持离线读取：离线时只能读取本地密文并在用户解锁后解密。

SQLite 中不得保存：

- master password。
- derived key。
- vault key。
- plaintext credential。
- recovery code。

### `MobileApiClient`

封装 Worker API 通信：

- 复用现有 API URL 配置方式，但移动端不能依赖 `NEXT_PUBLIC_*`。
- 复用 OPAQUE 登录、HttpOnly cookie 或移动端等效 session 策略、CSRF token 规则。
- 复用 `item_level_v1` sync plan/response。
- 统一处理离线、401、403、sync conflict、server revision advanced 等状态。

移动端不新增 Worker API 协议。需要新增协议时，必须先更新 `packages/shared` schema、Worker API 测试和 Web 兼容说明。

## 信息架构与交互规范

MVP screen 建议：

- `LoginScreen`：账号登录、会话状态、错误提示。
- `UnlockScreen`：主密码输入、本地解锁、锁定状态说明。
- `VaultListScreen`：凭据列表、搜索、同步状态、空状态。
- `CredentialDetailScreen`：标题、origin、username、password reveal/copy、notes 摘要。
- `SyncStatusScreen`：最近同步时间、待同步/冲突提示、手动同步按钮。
- `SettingsScreen`：锁定、自动锁定时间、API 环境、版本信息。

移动端 UI 规范：

- 使用 React Native 原生组件与 platform-safe layout。
- 触控目标最小 44px。
- 支持系统字体缩放，核心信息不能因中文文案变长而截断关键动作。
- 使用 `SafeAreaView` 或等效安全区处理。
- 密码默认隐藏，显示密码必须由用户主动触发。
- 复制密码后必须给出短暂提示，并在可行时设置剪贴板清理策略。
- App 进入后台、设备锁屏、超过自动锁定时间后必须锁定或进入重新验证状态。

视觉风格应参考 `docs/ui-development.md` 和 `docs/DESIGN.md`，但移动端不得通过修改 Web token 达成视觉一致。需要移动端 token 时，在 `apps/mobile` 内建立独立 token mapping。

## 同步与冲突策略

移动端 MVP 采用只读优先策略：

1. 登录成功后获取 session user 和 CSRF token。
2. 用户输入主密码解锁本地 vault key。
3. 拉取 item-level ciphertext。
4. 使用 `MobileCryptoAdapter` 本地解密 item payload。
5. 将 ciphertext、revision、lastSyncedAt 写入 `MobileCiphertextStore`。
6. UI 只展示解锁后的内存 plaintext，不把 plaintext 持久化。

同步规则：

- 手动同步为 MVP 默认入口。
- 自动同步可以规划但不作为 MVP 必需。
- 只读 MVP 不提交 item upsert/delete。
- 如果服务端返回冲突或 revision advanced，展示冲突状态并引导用户到 Web 端处理。
- 离线时展示最后缓存时间，并明确当前数据可能不是最新。

## 安全规范

移动端必须继承现有安全模型：

- master password 永不发送到服务器。
- vault key 和 derived key 不进入日志、analytics、crash report、SQLite、普通 AsyncStorage。
- plaintext item 只存在于解锁后的 JS/native 内存中。
- 锁定必须清空 unlocked state、详情页明文、搜索结果明文和临时 copy 状态。
- 禁止在测试 fixture、截图、日志中放真实密码、真实 origin、真实用户名。
- 禁止把 Expo public config 当作 secret 存储。
- 生产构建必须关闭调试日志中的请求 body、响应 body 和 crypto 参数输出。

移动端剪贴板处理：

- 复制操作必须由用户点击触发。
- 复制后显示“已复制，建议尽快粘贴并清除剪贴板”或等效中文提示。
- 如果平台能力允许，设置短时间后清空剪贴板；如果不允许，在文档和 UI 中明确限制。

## 开发流程

### 阶段 0：规范文档 — 已完成

- 新增本文档。
- README Documentation 列表补充移动端规范链接。
- 不创建 `apps/mobile`。
- 不修改 Web UI。

### 阶段 1：移动端 scaffold — 已完成

- 创建 `apps/mobile` Expo + TypeScript 工程。
- 接入 Expo Router、基础主题 token、safe area、基础页面壳。
- 添加 `package.json` scripts：`dev`、`typecheck`、`test`。
- 保持 workspace 与现有 pnpm 结构一致。
- 目录结构：`app/`（路由）、`src/screens`、`src/components`、`src/lib/api`、`src/lib/crypto`、`src/lib/storage`、`src/lib/sync`、`src/state`、`src/theme`、`src/test`。
- 暗色主题 token 独立于 Web CSS，参考 `docs/ui-development.md` 和 `docs/DESIGN.md`。

### 阶段 2：API 与只读数据流 — 已完成

- 实现 `MobileApiClient`（`src/lib/api/mobile-api-client.ts`）。
  - `loginDirect`（MVP 直接登录，待替换为 OPAQUE）。
  - `loginStart`/`loginFinish`（OPAQUE 两步登录，预留接口）。
  - `fetchCurrentUser`、`logout`。
  - `pullItems`（拉取 item-level ciphertext）。
  - `pushItemLevelSync`（预留，MVP 不使用）。
  - 统一处理 401、403、离线、request_timeout。
- 实现 `MobileSyncService`（`src/lib/sync/mobile-sync-service.ts`）。
  - `pullAll`：拉取并缓存 ciphertext。
  - `processPullResponse`：存储 ciphertext、更新 server revision。
  - `markConflicts`：标记冲突项。
- 接入凭据列表和详情页的 loading/error/empty/offline 状态。

### 阶段 3：native crypto adapter — 部分完成

- 定义 `MobileCryptoAdapter` 接口（`src/lib/crypto/mobile-crypto-adapter.ts`）。
  - `deriveVaultKey`：从主密码派生 vault key。
  - `decryptItem`：解密单个 item。
  - `lock`：清理敏感状态。
- 实现 `TestDoubleCryptoAdapter`（明确标记为非生产用途）。
- 生产路径待接入 `crypto-core` UniFFI/Expo native module。
- 为 crypto adapter 增加 round-trip、wrong-key 测试。

### 阶段 4：本地安全与锁定 — 已完成

- 实现 `MobileSecureStore`（`src/lib/storage/mobile-secure-store.ts`）。
  - `ExpoSecureStoreAdapter`：封装 Expo SecureStore。
  - `InMemorySecureStore`：测试用内存存储。
- 实现 `MobileCiphertextStore`（`src/lib/storage/mobile-ciphertext-store.ts`）。
  - `InMemoryCiphertextStore`：保存 ciphertext、revision、lastSyncedAt、conflict marker。
  - 生产待替换为 SQLite 实现。
- 实现自动锁定（可配置时间）、手动锁定。
- 实现复制凭据安全提示（"已复制，建议尽快粘贴并清除剪贴板"）。

### 阶段 5：MVP 验收 — 进行中

- 补齐手动同步状态（`SyncStatusScreen`）。
- 冲突状态引导 Web 端处理。
- 完成 Web/shared/Rust 回归检查（全部通过）。
- 待完成：移动端 E2E smoke。

## PR 验收门槛

所有移动端相关 PR 至少运行：

```sh
pnpm --filter @zero-vault/web typecheck
pnpm --filter @zero-vault/web test
pnpm --filter @zero-vault/shared test
cargo test --manifest-path crates/crypto-core/Cargo.toml
```

涉及移动端工程后，还必须运行：

```sh
pnpm --filter @zero-vault/mobile typecheck
pnpm --filter @zero-vault/mobile test
```

涉及共享包、API 协议或同步行为时，额外运行：

```sh
pnpm --filter @zero-vault/web test:e2e:sync
pnpm --filter @zero-vault/worker-api test
```

移动端 E2E smoke 至少覆盖：

- 登录。
- 解锁。
- 查看凭据列表。
- 查看凭据详情。
- 复制用户名或密码。
- 手动锁定。
- 离线读取已缓存密文。

## 文档与实现更新规则

当移动端进入实现阶段，下列变更必须同步更新本文档：

- 新增或改变移动端技术栈。
- 新增 API 协议或改变 sync 行为。
- 改变加密参数、native crypto binding 或 key storage 策略。
- MVP 范围扩大到编辑、导入、恢复码、设备信任、Autofill 或 Credential Provider。
- 引入新的持久化存储、analytics、crash reporting 或日志系统。

本文档优先级高于临时实现偏好。若实现需要违反本文档，必须先更新文档并说明安全和 Web 兼容影响。

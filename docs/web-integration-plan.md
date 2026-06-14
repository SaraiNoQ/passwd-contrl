# Web 端后续开发计划：接口开发、前后端联调与测试

> 生成日期：2026-06-14
> 基于代码审计 + 3 个并行探索代理的全量分析

---

## 一、现状总结

### 1.1 项目架构

| 层级 | 技术栈 | 位置 |
|---|---|---|
| 前端 Web Vault | Next.js 15.3 + React 19 + TypeScript | `apps/web/` |
| 后端 Worker API | Hono 4 + Cloudflare D1 (SQLite) + R2 | `apps/worker-api/` |
| 共享契约 | Zod schemas + TypeScript DTOs | `packages/shared/` |
| 加密核心 | Rust Argon2id + XChaCha20-Poly1305 (WASM) | `crates/crypto-core/` |

### 1.2 已完成的接口连接（正常工作）

| 功能域 | 前端调用 | 后端端点 | 状态 |
|---|---|---|---|
| OPAQUE 注册 | `registerAccount()` | `POST /auth/register/{start,finish}` | ✅ 已联调 |
| OPAQUE 登录 | `loginAccount()` | `POST /auth/login/{start,finish}` | ✅ 已联调 |
| 会话检查 | `fetchCurrentUser()` | `GET /auth/me` | ✅ 已联调 |
| 登出 | `logoutAccount()` | `POST /auth/logout` | ✅ 已联调 |
| 账户删除 | `deleteAccount()` | `DELETE /auth/account` | ✅ 已联调 |
| 全量同步拉取 | `pullVault()` | `GET /vault/sync` | ✅ 已联调 |
| 全量同步推送 | `pushVault()` | `POST /vault/sync` | ✅ 已联调 |
| 条目级同步 | `pushItemLevelSync()` | `POST /vault/item-sync` | ✅ 已联调 |
| 恢复包获取 | `fetchRecoveryPacket()` | `GET /vault/recovery-packet` | ✅ 已联调 |
| 恢复包保存 | `saveRecoveryPacketToServer()` | `POST /vault/recovery-packet` | ✅ 已联调 |
| 设备列表 | `listDevices()` | `GET /devices` | ✅ 已联调 |
| 设备注册 | `registerDevice()` | `POST /devices` | ✅ 已联调 |
| 设备批准/拒绝/撤销 | `approveDevice()` 等 | `POST /devices/:id/{approve,reject,revoke}` | ✅ 已联调 |
| 设备密钥共享 | `shareVaultKeyWithDevice()` | `POST /devices/:id/share-key` | ✅ 已联调 |

### 1.3 已发现的关键问题

| 编号 | 类型 | 描述 | 严重性 |
|---|---|---|---|
| **ISS-1** | 死代码 | `apps/web/app/vault-app.tsx` 是 1365 行的孤儿文件，未被任何代码导入，是旧版单体实现 | 低（但会造成混淆） |
| **ISS-2** | 数据未传递 | `vault/page.tsx` 中 Sidebar 接收的文件夹数据为空数组（`folders: []`），但 `useFolders` hook 已计算出正确数据 | 中 |
| **ISS-3** | 功能未接入 | `useSearch` hook 已定义但未被任何组件使用，搜索功能仅为本地内存过滤 | 中 |
| **ISS-4** | 功能未接入 | `fetchItemHistory()` 已在 api-client 中定义但从未被 UI 调用，后端 `GET /vault/items/:id/history` 已实现 | 中 |
| **ISS-5** | 功能未接入 | R2 导出接口（`POST /exports/create`, `GET /exports`, `GET /exports/:id`, `DELETE /exports/:id`）后端已完整实现，前端完全未接入 | 中 |
| **ISS-6** | 功能未接入 | `GET /vault/item-sync`（条目级同步拉取）后端已实现，前端仅使用 POST | 低 |
| **ISS-7** | 功能未接入 | `fetchDeviceVaultKey()` 和 `decryptVaultKeyOnDevice()` 在 `device-trust.ts` 中定义但未被 UI 使用 | 低 |
| **ISS-8** | 代码重复 | `vault-provider.tsx`（新架构）和 `vault-app.tsx`（旧架构）存在两套并行的状态管理逻辑 | 低 |
| **ISS-9** | Hook 未清理 | `useExtensionBridge` 和 `useOfflineSync` 仅被旧版 `vault-app.tsx` 使用，新版 `vault-provider.tsx` 内联了简化版逻辑 | 低 |

---

## 二、开发计划总览

计划分为 **5 个阶段**，按依赖关系排序。每个阶段内的任务可并行执行（除非标注了依赖关系）。

```
Phase 0: 代码清理与架构统一 ──────────────── 预估 1-2 天
    ↓
Phase 1: 已有功能的联调修复与补全 ──────────── 预估 2-3 天
    ↓
Phase 2: 未接入功能的开发与联调 ────────────── 预估 3-5 天
    ↓
Phase 3: 测试体系建设 ──────────────────────── 预估 3-4 天
    ↓
Phase 4: 集成验证与发布准备 ────────────────── 预估 1-2 天
```

**总计预估：10-16 天**

---

## Phase 0：代码清理与架构统一

> 目标：消除死代码和重复实现，统一为单一架构模式（Context + 纯函数模块），为后续开发扫清障碍。

### Task 0.1：删除孤儿文件 `vault-app.tsx`

**文件**：`apps/web/app/vault-app.tsx`（1365 行）

**操作**：
1. 确认无导入：`grep -r "vault-app" apps/web/` 验证仅有注释引用
2. 删除文件
3. 运行 `pnpm --filter @zero-vault/web typecheck` 确认无编译错误
4. 运行 `pnpm --filter @zero-vault/web test` 确认无测试失败

**验收标准**：typecheck 通过，所有现有测试通过。

### Task 0.2：清理仅被旧代码使用的 hooks

**文件**：
- `apps/web/hooks/useExtensionBridge.ts`
- `apps/web/hooks/useOfflineSync.ts`
- `apps/web/hooks/useAuth.ts`
- `apps/web/hooks/useVault.ts`
- `apps/web/hooks/index.ts`

**操作**：
1. 逐一检查每个 hook 的导入者（`lsp_find_references` 或 `grep`）
2. 对于仅被 `vault-app.tsx`（已删除）引用的 hooks：
   - 如果新版 `vault-provider.tsx` 已有等价实现 → 删除该 hook
   - 如果新版缺少等价实现 → 迁移逻辑到 `vault-provider.tsx` 或对应的 `lib/vault-*.ts` 模块
3. 更新 `hooks/index.ts` 的导出列表
4. typecheck + test

**注意**：`useSettings`、`useAutoLock`、`useMascot`、`useBreachCheck`、`useFolders`、`useRecovery` 在新架构中仍被使用，不要删除。

**验收标准**：所有 hooks 都有明确的导入者，无悬空导出。

### Task 0.3：修复文件夹数据传递问题

**文件**：`apps/web/app/vault/page.tsx`

**当前问题**：
```tsx
// 第 92 行：useFolders 已计算出正确数据
const { folders, folderCounts, uncategorizedCount } = useFolders(allItems);

// 但 Sidebar 接收的是空数据（来自旧的 vault-app.tsx 模式）
// vault/page.tsx 第 149-154 行传递了正确数据 ✅
// 需要确认是否有遗漏
```

**操作**：
1. 确认 `vault/page.tsx` 中 `<Sidebar>` 的 `folders`、`folderItemCounts`、`allCount`、`uncategorizedCount`、`selectedFolder`、`onFolderSelect` 属性是否已正确传递 `useFolders` 的结果
2. 如果有空值传递，修复为正确数据
3. 手动验证：创建多个带不同 folder 的凭据，确认侧栏文件夹树正确显示

**验收标准**：侧栏文件夹导航功能正常工作。

---

## Phase 1：已有功能的联调修复与补全

> 目标：确保所有已连接的前后端接口在各种场景下都能正确工作，修复边界情况。

### Task 1.1：认证流程全场景联调

**涉及文件**：
- `apps/web/lib/api-client.ts`（OPAQUE 注册/登录）
- `apps/web/app/vault-provider.tsx`（`submitRegister`、`submitLogin`、`submitLogout`）
- `apps/web/components/shell/sidebar.tsx`（账户表单 UI）

**测试矩阵**：

| 场景 | 预期行为 | 当前状态 |
|---|---|---|
| 新用户注册（邮箱 + 密码 ≥12 字符） | 注册成功 → 自动登录 → 显示恢复码弹窗 | 待验证 |
| 注册时密码 <12 字符 | 前端拦截，显示 "账户密码至少需要 12 个字符" | 待验证 |
| 注册时邮箱已存在 | 后端返回 `user_exists` → 前端显示 "该邮箱已注册" | 待验证 |
| 已注册用户登录 | OPAQUE 握手成功 → 会话 cookie 设置 → CSRF token 获取 | 待验证 |
| 错误密码登录 | OPAQUE 握手失败 → 显示 "邮箱或密码不正确" | 待验证 |
| 未注册邮箱登录 | 后端返回 `user_not_found` → 显示 "该邮箱未注册" | 待验证 |
| 会话过期后操作 | 401 响应 → 前端提示 "请先登录" | 待验证 |
| 登出 | 会话 cookie 清除 → 同步状态重置为 "仅本地" | 待验证 |
| 频率限制触发（注册 >8/min） | 429 响应 → 显示 "请求过于频繁，请稍后重试" | 待验证 |
| CSRF token 不匹配 | 403 响应 → 显示 "安全验证失败，请刷新页面" | 待验证 |

**操作**：
1. 启动 Worker API（`pnpm dev:worker`）+ Web Vault（`pnpm dev:web`）
2. 逐一执行上述测试矩阵
3. 记录每个场景的实际行为 vs 预期行为
4. 修复发现的差异

**验收标准**：10/10 场景全部通过。

### Task 1.2：同步流程全场景联调

**涉及文件**：
- `apps/web/lib/vault-sync.ts`（`performSync`）
- `apps/web/lib/sync-vault.ts`（`performItemLevelSync`）
- `apps/web/lib/item-sync.ts`（`buildItemLevelSyncPlan`）
- `apps/web/app/vault-provider.tsx`（`syncNow`）

**测试矩阵**：

| 场景 | 预期行为 | 当前状态 |
|---|---|---|
| 首次同步（本地有数据，服务器空） | 条目级同步推送成功 → 版本 1 | 待验证 |
| 增量同步（本地新增条目） | 仅推送新增条目 → 版本递增 | 待验证 |
| 增量同步（本地修改条目） | 推送修改 → baseItemRevision 正确 | 待验证 |
| 增量同步（本地删除条目） | 推送删除 → 服务器标记 deleted_at | 待验证 |
| 拉取远端变更 | 合并远端新增/修改/删除到本地 | 待验证 |
| 冲突检测（同条目双端修改） | 返回 409 → 显示 ConflictResolutionPanel | 待验证 |
| 冲突解决：保留本地 | 重新推送本地版本 → 冲突消除 | 待验证 |
| 冲突解决：接受远端 | 拉取远端版本 → 合并到本地 | 待验证 |
| 冲突解决：创建副本 | 本地创建 "(副本)" → 冲突消除 | 待验证 |
| 冲突解决：跳过 | 冲突标记清除 → 条目保持原状 | 待验证 |
| 未登录时点击同步 | 显示 "请先在左侧账户区注册或登录后再同步" | 待验证 |
| 无本地密码库时同步 | 显示 "请先创建本地密码库后再同步" | 待验证 |
| 自动同步（定时器触发） | 按 `syncInterval` 设置自动触发 | 待验证 |
| 离线 → 上线后同步 | 检测 online 事件 → 自动触发同步 | 待验证 |

**操作**：
1. 准备两个浏览器 profile（模拟双设备）
2. 逐一执行测试矩阵
3. 重点关注冲突场景的正确性

**验收标准**：14/14 场景全部通过。

### Task 1.3：设备信任流程联调

**涉及文件**：
- `apps/web/lib/vault-device.ts`
- `apps/web/lib/device-trust.ts`
- `apps/web/components/sync/sync-device-panel.tsx`

**测试矩阵**：

| 场景 | 预期行为 | 当前状态 |
|---|---|---|
| 登录后自动注册设备 | 设备出现在列表中，状态为 pending | 待验证 |
| 刷新设备列表 | 列表更新，当前设备 ID 正确标记 | 待验证 |
| 批准 pending 设备 | 状态变为 approved + 密钥共享成功 | 待验证 |
| 批准设备但密钥共享失败 | 设备已批准但显示 "授权共享失败" 提示 | 待验证 |
| 拒绝 pending 设备 | 状态变为 rejected | 待验证 |
| 撤销 approved 设备 | 状态变为 revoked + 加密密钥从服务器删除 | 待验证 |
| 未登录时操作设备 | 显示 "请先登录后再..." | 待验证 |

**验收标准**：7/7 场景全部通过。

### Task 1.4：恢复流程联调

**涉及文件**：
- `apps/web/lib/vault-recovery.ts`
- `apps/web/lib/recovery.ts`
- `apps/web/components/recovery/`

**测试矩阵**：

| 场景 | 预期行为 | 当前状态 |
|---|---|---|
| 生成恢复码 | 256-bit 随机码 → 显示在弹窗中 → 用户确认保存 | 待验证 |
| 恢复包上传到服务器 | 加密恢复包 → POST /vault/recovery-packet 成功 | 待验证 |
| 使用恢复码恢复（本地有加密库） | 解密恢复包 → 解锁本地库 → 设置新主密码 | 待验证 |
| 使用恢复码恢复（本地无加密库） | 从服务器拉取 → 解密 → 创建新本地库 | 待验证 |
| 恢复码错误 | 显示 "恢复失败。请检查恢复码" | 待验证 |
| 新主密码 <12 字符 | 提示 "请设置新的主密码（至少 12 个字符）" | 待验证 |
| 恢复包不存在 | 显示 "未找到恢复包" | 待验证 |

**验收标准**：7/7 场景全部通过。

### Task 1.5：设置与导入导出联调

**涉及文件**：
- `apps/web/lib/vault-settings.ts`
- `apps/web/components/settings/settings-page.tsx`
- `apps/web/components/import/csv-import.tsx`

**测试矩阵**：

| 场景 | 预期行为 | 当前状态 |
|---|---|---|
| CSV 导入（Bitwarden JSON） | 解析成功 → 加密存储 → 显示导入数量 | 待验证 |
| CSV 导入（1Password CSV） | 解析成功 → 同上 | 待验证 |
| CSV 导入（浏览器 CSV） | 解析成功 → 同上 | 待验证 |
| CSV 导入（无法识别格式） | 显示 "无法识别文件格式" | 待验证 |
| 导出 CSV | 下载明文 CSV 文件 | 待验证 |
| 导出加密备份 | 下载加密文件 | 待验证 |
| 导入加密备份 | 验证格式 → 替换本地库 → 锁定 | 待验证 |
| 修改主密码（正确旧密码） | 重新加密 → 本地库更新 | 待验证 |
| 修改主密码（错误旧密码） | 显示 "当前密码不正确" | 待验证 |
| 删除账户 | 调用 DELETE /auth/account → 清除本地数据 → 刷新页面 | 待验证 |
| 自动锁定超时设置 | localStorage 持久化 → 倒计时正确 | 待验证 |
| 自动同步开关/间隔设置 | localStorage 持久化 → 定时器正确 | 待验证 |

**验收标准**：12/12 场景全部通过。

---

## Phase 2：未接入功能的开发与联调

> 目标：将后端已实现但前端未接入的功能连接到 UI，并完成联调。

### Task 2.1：条目历史记录功能

**现状**：
- 后端：`GET /vault/items/:id/history` 已实现 + 已测试
- 前端：`fetchItemHistory()` 已在 `api-client.ts` 中定义但未被调用
- UI：无历史记录展示组件

**开发内容**：

1. **新建组件** `apps/web/components/credentials/credential-history.tsx`
   - 展示条目的版本历史列表（时间戳、版本号）
   - 支持查看历史快照（只读）
   - 加载状态和错误处理

2. **集成到 CredentialDrawer**
   - 在 `credential-drawer.tsx` 中添加 "历史" 标签页或按钮
   - 编辑模式下显示历史入口
   - 调用 `fetchItemHistory(itemId)` 获取数据

3. **在 vault-provider.tsx 中添加状态管理**
   - `historyOpen: boolean` 状态
   - `historyItems: VaultItemHistoryResponse` 状态
   - `loadHistory(itemId)` action

**联调验证**：
- 创建条目 → 修改 2-3 次 → 查看历史列表是否正确
- 历史快照内容是否可正确解密展示

**预估工作量**：1-1.5 天

### Task 2.2：加密搜索功能（服务端搜索）

**现状**：
- 后端：`POST /vault/search` 已实现（基于 HMAC-SHA256 加密 token 的盲搜索）
- 前端：`useSearch` hook 已定义但未被使用；`search-tokens.ts` 已实现 HMAC token 生成
- UI：TopBar 搜索框仅做本地内存过滤

**开发内容**：

1. **将 `useSearch` hook 接入 TopBar**
   - 当用户输入搜索关键词时，生成 HMAC search tokens
   - 调用 `POST /vault/search` 发送加密 token（服务器永远看不到明文）
   - 将搜索结果与本地过滤结果合并

2. **搜索策略选择**
   - 本地优先：先做本地过滤（即时响应），再异步调用服务端搜索补充
   - 或：仅当条目数量超过阈值时启用服务端搜索

3. **在 vault-provider.tsx 中集成**
   - 替换 `filteredItems` 的纯本地过滤逻辑
   - 添加搜索 loading 状态
   - 处理搜索结果去重

**安全注意**：search tokens 使用 HMAC-SHA256，服务器无法反推明文。确保 token 生成逻辑与后端验证逻辑一致。

**联调验证**：
- 搜索已知条目 → 确认结果正确
- 搜索不存在的条目 → 确认无结果
- 确认搜索请求中不包含明文关键词（DevTools Network 面板检查）

**预估工作量**：1-2 天

### Task 2.3：R2 云端导出/导入功能

**现状**：
- 后端：4 个 R2 导出端点已完整实现 + 已测试
  - `POST /exports/create` — 上传加密导出到 R2
  - `GET /exports` — 列出用户的导出记录（仅元数据）
  - `GET /exports/:id` — 下载加密导出
  - `DELETE /exports/:id` — 删除导出
- 前端：`vault-settings.ts` 仅实现了本地文件下载/上传，未接入 R2
- UI：设置页面有 "导出加密备份" 按钮，但仅触发本地下载

**开发内容**：

1. **新建 API 客户端函数**（`apps/web/lib/api-client.ts`）
   ```
   createCloudExport(csrfToken, data, exportId, algorithm)
   listCloudExports()
   downloadCloudExport(exportId)
   deleteCloudExport(exportId)
   ```

2. **新建组件** `apps/web/components/settings/cloud-export-panel.tsx`
   - 云端导出列表（显示创建时间、大小、算法）
   - "上传到云端" 按钮（加密当前 vault → POST /exports/create）
   - "从云端下载" 按钮（GET /exports/:id → 解密 → 导入）
   - "删除" 按钮（DELETE /exports/:id）
   - 加载/错误/空状态处理

3. **集成到 SettingsPage**
   - 在现有导出区域下方添加 "云端备份" 区块
   - 区分 "本地下载" 和 "云端备份" 两种操作

4. **在 vault-provider.tsx 中添加状态管理**
   - `cloudExports: ExportMetadata[]` 状态
   - `loadCloudExports()` / `createCloudExport()` / `deleteCloudExport()` actions

**联调验证**：
- 上传加密备份到 R2 → 确认列表中出现
- 从 R2 下载 → 确认内容与上传一致
- 删除 R2 导出 → 确认列表中消失
- 跨设备：设备 A 上传 → 设备 B 下载 → 确认数据正确

**预估工作量**：1.5-2 天

### Task 2.4：`GET /vault/item-sync` 初始状态水合

**现状**：
- 后端：`GET /vault/item-sync` 已实现（返回完整的条目级同步状态）
- 前端：仅使用 `POST /vault/item-sync` 推送，未使用 GET 拉取

**开发内容**：

1. **在初始化流程中使用 GET item-sync**
   - 登录后首次加载时，调用 `GET /vault/item-sync` 获取服务器端的条目修订号映射
   - 用于初始化本地 `itemRevisionMap`，避免首次同步时产生假冲突

2. **在 `vault-provider.tsx` 的初始化 effect 中集成**
   - 在 `fetchCurrentUser()` 成功后，并行调用 `GET /vault/item-sync`
   - 将返回的 revision map 保存到 localStorage

**联调验证**：
- 新设备登录 → 首次同步不产生假冲突
- 多设备交替修改 → revision map 正确同步

**预估工作量**：0.5 天

---

## Phase 3：测试体系建设

> 目标：建立覆盖单元测试、集成测试、E2E 测试的完整测试金字塔。

### Task 3.1：补充单元测试（Vitest）

**当前测试覆盖**：
- `api-client.test.ts` — requestJson、CSRF、409、网络错误
- `local-vault.test.ts` — 本地 vault CRUD
- `item-sync.test.ts` — 条目级同步计划构建
- `sync-vault.ts` — 同步原语
- `device-trust.test.ts` — 设备信任
- `recovery.test.ts` — 恢复码
- `csv-import.test.ts` — CSV 解析
- `password-import.test.ts` — 密码导入
- `offline-queue.test.ts` — 离线队列
- `extension-bridge.test.ts` — 扩展桥接
- `totp.test.ts` — TOTP
- `security-leakage.test.ts` — 安全泄漏回归

**需要补充的测试**：

| 测试文件 | 覆盖内容 | 优先级 |
|---|---|---|
| `vault-sync.test.ts` | `performSync` 全路径（merged / item-synced / conflicts / version-conflict / error） | 高 |
| `vault-recovery.test.ts` | `handleCreateRecoveryCode` + `handleRecoverVault` 全路径 | 高 |
| `vault-settings.test.ts` | `handleImportPasswords`（多格式）、`handleChangeMasterPassword`、`handleDeleteAccount` | 高 |
| `vault-device.test.ts` | `handleRefreshDevices`、`handleApproveDevice`（含密钥共享）、`handleRejectDevice`、`handleRevokeDevice` | 中 |
| `vault-auth.test.ts` | `handleCreateVault`、`handleUnlockVault`、`handleLoadExistingVault` | 中 |
| `search-tokens.test.ts` | HMAC-SHA256 token 生成正确性、与后端验证一致性 | 中 |
| `breach-check.test.ts` | HIBP k-anonymity 查询（mock fetch） | 低 |

**验收标准**：每个纯函数模块至少有 happy path + 1 个 error path 的测试覆盖。

### Task 3.2：扩展 E2E 测试（Playwright）

**当前 E2E 覆盖**：
- `vault-flow.spec.ts`（458 行）— vault 创建/解锁、CRUD、同步错误、CSV 导入、搜索、密码生成、设置、恢复
- `worker-sync.spec.ts`（68 行）— Worker API 注册 + 2 次条目级同步

**需要补充的 E2E 场景**：

| 场景 | 文件 | 优先级 |
|---|---|---|
| 完整设备信任流程（注册 → 批准 → 撤销） | `device-trust.spec.ts`（新建） | 高 |
| 冲突检测与解决（4 种策略） | `conflict-resolution.spec.ts`（新建） | 高 |
| 恢复码生成 + 使用恢复码恢复 | 扩展 `vault-flow.spec.ts` | 高 |
| R2 云端导出/导入（Phase 2.3 完成后） | `cloud-export.spec.ts`（新建） | 中 |
| 条目历史记录查看（Phase 2.1 完成后） | 扩展 `vault-flow.spec.ts` | 中 |
| 加密搜索（Phase 2.2 完成后） | 扩展 `vault-flow.spec.ts` | 中 |
| 离线 → 上线自动同步恢复 | `offline-sync.spec.ts`（新建） | 中 |
| 批量操作（批量删除、批量更新密码） | 扩展 `vault-flow.spec.ts` | 低 |
| 文件夹导航 | 扩展 `vault-flow.spec.ts` | 低 |

**验收标准**：核心用户旅程（注册 → 创建 → 同步 → 冲突 → 恢复 → 设备管理）全部有 E2E 覆盖。

### Task 3.3：后端 API 集成测试补充

**当前后端测试**：130+ 测试，覆盖所有路由。

**需要补充的场景**：

| 场景 | 文件 | 说明 |
|---|---|---|
| `GET /vault/item-sync` 带 `?serverRevision=N` 查询参数 | `vault.test.ts` | 当前 API 忽略该参数，需要决定行为并添加测试 |
| 多设备并发同步 | `vault.test.ts` | 模拟两个 session 同时 push 的竞态 |
| R2 不可用时的降级行为 | `exports.test.ts` | `c.env.R2` 为 undefined 时返回 503 |
| 大量条目的同步性能 | `vault.test.ts` | 1000+ 条目的 item-level sync 计划 |

### Task 3.4：安全回归测试

**操作**：
1. 确认 `security-leakage.test.ts`（web + extension + shared）覆盖所有新增代码路径
2. 新增测试：确保新增的 API 调用（history、search、exports）不会在请求/响应中泄露明文密码或密钥
3. 新增测试：确保错误消息映射（`getErrorMessage`）覆盖所有新增的后端错误码

---

## Phase 4：集成验证与发布准备

> 目标：全链路验证，确保所有功能在真实环境下正常工作。

### Task 4.1：全量 typecheck + lint

**操作**：
```bash
npx pnpm typecheck        # 全 monorepo 类型检查
npx pnpm --filter @zero-vault/web lint  # Next.js lint
npx pnpm test             # 全 monorepo 单元测试
```

**验收标准**：零错误、零警告。

### Task 4.2：E2E 全量运行

**操作**：
```bash
# 前端 E2E（不需要 Worker API）
npx pnpm --filter @zero-vault/web test:e2e

# 需要 Worker API 的同步 E2E
npx pnpm --filter @zero-vault/web test:e2e:sync
```

**验收标准**：所有 E2E 测试通过。

### Task 4.3：手动验收测试

**操作**：按照以下用户旅程进行手动测试

**核心用户旅程**：

1. **新用户完整流程**
   - 访问 `/` → 创建本地密码库 → 注册账户 → 查看恢复码 → 添加 3 条凭据 → 同步 → 登出 → 登录 → 验证数据完整

2. **多设备同步流程**
   - 设备 A 创建 + 添加数据 → 同步
   - 设备 B 登录 → 同步 → 验证数据一致
   - 设备 A 修改条目 → 同步
   - 设备 B 同步 → 验证修改同步
   - 设备 A 和 B 同时修改同一条目 → 冲突 → 解决

3. **恢复流程**
   - 生成恢复码 → 记录
   - 清除浏览器数据
   - 使用恢复码恢复 → 设置新主密码 → 验证数据完整

4. **设备管理流程**
   - 设备 A 注册 + 登录
   - 设备 B 注册（pending）
   - 设备 A 批准设备 B
   - 设备 B 同步获取数据
   - 设备 A 撤销设备 B
   - 设备 B 同步失败（权限被拒）

5. **导入导出流程**
   - 从 Bitwarden 导出 JSON → 导入 Zero Vault → 验证数据
   - 导出 CSV → 验证内容
   - 导出加密备份 → 清除数据 → 导入备份 → 解锁 → 验证数据
   - （Phase 2.3 后）云端备份 → 清除 → 云端恢复

6. **安全验证**
   - DevTools Network 面板：确认所有请求中无明文密码
   - DevTools Console：确认无敏感信息日志
   - 自动锁定：等待超时 → 确认锁定 → 确认扩展会话清除

### Task 4.4：性能基线

**操作**：
1. 创建 500 条凭据的测试数据
2. 测量并记录：
   - 首次同步时间
   - 增量同步时间（修改 1 条）
   - 页面加载时间（解锁后）
   - 搜索响应时间（本地 + 服务端）
3. 记录基线数据，用于后续优化参考

### Task 4.5：发布检查清单核对

**操作**：逐项核对 `docs/release-gate.md` 中的 45 项检查

**重点关注**：
- Worker API 部署状态
- D1 生产环境配置
- R2 生产环境绑定
- Worker secrets 设置
- CORS 生产配置
- Cookie Secure 标志
- 浏览器兼容性测试（Chrome + Edge）

---

## 三、执行优先级排序

按业务价值和依赖关系排序的推荐执行顺序：

### 🔴 高优先级（立即执行）

| 任务 | 理由 |
|---|---|
| Task 0.1 — 删除 vault-app.tsx | 消除混淆源，零风险 |
| Task 0.3 — 修复文件夹数据传递 | 修复已有功能缺陷 |
| Task 1.1 — 认证流程联调 | 核心用户入口 |
| Task 1.2 — 同步流程联调 | 核心功能 |

### 🟡 中优先级（第二批执行）

| 任务 | 理由 |
|---|---|
| Task 0.2 — 清理旧 hooks | 架构统一 |
| Task 1.3 — 设备信任联调 | 多设备核心功能 |
| Task 1.4 — 恢复流程联调 | 安全关键功能 |
| Task 1.5 — 设置与导入导出联调 | 用户迁移关键 |
| Task 2.1 — 条目历史记录 | 用户可感知的功能 |

### 🟢 低优先级（第三批执行）

| 任务 | 理由 |
|---|---|
| Task 2.2 — 加密搜索 | 本地过滤已可用，服务端搜索是增强 |
| Task 2.3 — R2 云端导出 | 本地导出已可用，云端是增强 |
| Task 2.4 — GET item-sync 水合 | 优化首次同步体验 |
| Task 3.x — 测试体系建设 | 可与 Phase 1-2 并行推进 |

---

## 四、风险与注意事项

### 4.1 安全红线（来自 AGENT.md，不可违反）

- ❌ 永远不要在请求/响应/日志中暴露主密码
- ❌ 永远不要添加服务端解密路径
- ❌ 永远不要在 fixture/日志/截图中存储明文密码或恢复码
- ❌ 搜索 token 必须使用 HMAC，服务器永远不应看到明文搜索词
- ✅ 新增的安全敏感代码必须更新 `docs/security-model.md` 和相关文档
- ✅ 新增的 API 调用必须通过 `security-leakage.test.ts` 回归测试

### 4.2 技术风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| OPAQUE WASM 在 Worker 环境的兼容性 | 注册/登录失败 | 使用已有的 `opaque-loader.ts` 静态加载方案 |
| D1 本地模拟与生产环境差异 | 同步行为不一致 | 使用 `better-sqlite3` 做本地测试，定期对比生产 |
| R2 本地模拟不完整 | 导出功能在本地无法测试 | 使用 MinIO 或 Cloudflare 开发环境 R2 |
| 大量条目时的同步性能 | 用户体验差 | Phase 4.4 建立基线，后续优化 |

### 4.3 架构决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 状态管理模式 | Context + 纯函数模块（vault-provider + lib/vault-*.ts） | 已在新架构中建立，保持一致 |
| 搜索策略 | 本地优先 + 服务端补充 | 本地过滤即时响应，服务端搜索覆盖加密数据 |
| 导出策略 | 本地下载 + 云端备份并存 | 给用户选择，不强制云端 |
| 旧 hooks 处理 | 删除（非迁移） | vault-provider.tsx 已有等价实现 |

---

## 五、验收标准总表

| 阶段 | 验收标准 |
|---|---|
| Phase 0 | typecheck 通过，无孤儿文件，文件夹导航正常 |
| Phase 1 | 50 个联调测试场景全部通过（认证 10 + 同步 14 + 设备 7 + 恢复 7 + 设置 12） |
| Phase 2 | 4 个新功能（历史、搜索、云导出、水合）全部联调通过 |
| Phase 3 | 新增 7 个单元测试文件 + 5 个 E2E 场景，覆盖率 ≥70% |
| Phase 4 | typecheck + lint + test + e2e 全部零错误，手动验收 6 条用户旅程通过 |

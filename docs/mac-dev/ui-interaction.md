# 桌面端信息架构与交互规范

Last updated: 2026-06-14

## 页面结构

桌面端页面结构与 Web Vault 一致：

- `LoginScreen`：账号登录、会话状态、错误提示。
- `LockedState`（双模式）：
  - **FORGE MODE**（`hasLocalVault: false`）：首次创建密码库。生成随机 salt + Argon2id 参数，派生 vault key，持久化到 Secure Store。UI 显示"铸造主密钥"/"开始铸造"。无恢复码入口（尚无密码库可恢复）。
  - **UNLOCK MODE**（`hasLocalVault: true`）：已有密码库。读取 Secure Store 中的 salt 和参数，派生 vault key，解密本地密文缓存。UI 显示"唤醒本地密钥"/"解锁密码库"。显示恢复码入口。
- 主界面（解锁后）：
  - 侧边栏导航。
  - `DashboardPage`：概览统计。
  - `CredentialList`：凭据列表、搜索、排序、批量操作。
  - `CredentialDetail`/`AddEditDrawer`：凭据详情、新增/编辑抽屉。
  - `CsvImportWizard`：5 步 CSV 导入向导。
  - `RecoverySetup`/`RecoveryModal`：恢复码生成与恢复码解锁。
  - `SyncPanel`：同步状态、活动日志。
  - `ConflictResolutionPanel`：冲突解决。
  - `DeviceManagementPanel`：设备管理、审批、撤销。
  - `PasswordGenerator`：密码生成器。
  - `SettingsPage`：自动锁定、master password 修改、导出、账户删除。

当前 `apps/desktop/src/App.tsx` 负责主应用编排。页面不能保留“将在此处显示”类占位内容；如果某项能力尚未完成，必须明确禁用并展示“暂不可用”反馈。

## 桌面端 UI 规范

- 使用 React 组件 + CSS Modules，与 Web 相同模式。
- 触控/点击目标最小 44px。
- 支持 macOS 系统字体缩放。
- 密码默认隐藏，显示密码必须由用户主动触发。
- 复制密码后必须给出短暂提示："已复制，建议尽快粘贴并清除剪贴板"。
- 如果平台允许，30 秒后自动清空剪贴板。
- App 窗口失焦、最小化或超过自动锁定时间后必须锁定或进入重新验证状态。
- 键盘导航：Tab 在输入框间切换，Enter 提交，Escape 关闭 modal/drawer。
- `Cmd+K` 全局搜索，`Cmd+L` 锁定。
- `Cmd+N` 新建凭据，`Cmd+S` 手动同步，`Cmd+,` 打开设置。
- macOS 菜单事件必须与前端状态联动：新建凭据、导入 CSV、搜索、锁定、同步、偏好设置、重新加载。

## 视觉风格

- 视觉源头优先级：`docs/DESIGN.md` 和当前 `apps/web` 已落地界面高于旧版 `docs/ui-development.md` 暗色控制台描述。
- `docs/ui-development.md` 仅作为安全边界、中文文案和交互原则参考，不能让桌面端回退到暗色主题。
- 桌面端使用与 Web 相同的 Cloud Mist 亮色主题（非移动端暗色主题、非旧暗色 Web Vault 方案）。
- CSS 自定义属性来自 `apps/web/app/tokens.css` 的值。
- Jersey 10 用于 display heading，Manrope 用于正文。
- Signal Orange (#ff5e24) 作为唯一强调色。
- 不直接 import Web React 组件、CSS Modules 或 Next.js 页面；只复用 token 值、视觉模式和交互模式。

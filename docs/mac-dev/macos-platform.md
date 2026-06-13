# macOS 平台规范

Last updated: 2026-06-08

## Keychain 集成

- 使用 macOS Keychain（`security-framework` crate 或 `keyring` crate）进行安全存储。
- Keychain 条目使用 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` 等效策略，不通过 iCloud 同步。
- 可存储：wrapped vault key reference、session token、device ID。
- 不可存储：master password、plaintext credential。
- 开发环境和生产环境使用不同的 Keychain access group。

## 窗口管理

- Tauri 2.x 原生窗口，使用 macOS 原生红绿灯按钮（关闭、最小化、全屏）。
- 最小窗口尺寸：800×600。
- 记住窗口位置和尺寸，跨会话恢复（Tauri `window` 插件）。
- 支持 macOS 原生全屏（绿色按钮行为）。

## 菜单栏

标准 macOS 菜单栏：

- **Obscura** 菜单：关于、偏好设置、退出。
- **文件** 菜单：新建凭据 (Cmd+N)、导入 CSV。
- **编辑** 菜单：撤销、重做、剪切、复制、粘贴、全选（标准 macOS 快捷键）。
- **视图** 菜单：重新加载、开发者工具（仅开发模式）。
- **窗口** 菜单：最小化、缩放、前置全部窗口。
- **帮助** 菜单：Obscura 帮助。

App 内快捷键：

- `Cmd+L`：锁定 vault。
- `Cmd+K`：快速搜索。
- `Cmd+N`：新增凭据。
- `Cmd+,`：打开设置。

## 签名与公证

- 分发到 Mac App Store 以外需要 Apple Developer ID。
- Tauri bundler 通过 `APPLE_SIGNING_IDENTITY` 环境变量处理代码签名。
- 公证通过 `xcrun notarytool` 在构建后执行。
- 公证票据钉入 .app bundle。
- 创建 DMG 用于分发。

## macOS 安全特性

- App Sandbox 启用（Tauri 默认）。
- Hardened Runtime 启用。
- Entitlements：
  - `com.apple.security.network.client`（API 调用）。
  - `com.apple.security.keychain-access-groups`（Keychain 访问）。

## 字体加载

- 将 Jersey 10 和 Manrope WOFF2 文件打包到 Tauri 应用中，支持离线使用。
- 通过 Tauri asset protocol（`asset://localhost/`）提供字体文件。
- 备选：在线时从 Google Fonts CDN 加载（仅开发模式）。

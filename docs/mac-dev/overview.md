# 桌面端概述

Last updated: 2026-06-08

本文档是 Zero Vault macOS 桌面端 App 开发的主规范。当前阶段只规划桌面端开发方式，不创建 `apps/desktop`，不修改 `apps/web`，不调整现有 Web Vault 的前端显示效果。

桌面端路线固定为 **Tauri 2.x + React + TypeScript**。当前产品阶段目标为 **功能对等 Web Vault**：桌面端可以完成 Web Vault 的全部功能，包括凭据增删改查、CSV 导入、恢复码、设备信任、冲突解决和同步管理。

## 目标与边界

桌面端 App 是独立客户端，不是 Web 页面的简单包装，也不是把 Next.js 嵌入 WebView 的壳应用。

必须做到：

- 复用现有零知识架构、同步协议、DTO/schema 和 Rust 加密核心。
- 保持服务器只接收密文、revision、设备元数据，不接收 master password、vault key、明文凭据、recovery code。
- 桌面端开发不得破坏 Web Vault、浏览器扩展或移动端的 UI、协议和测试。
- 中文为默认界面语言，文案沿用 `docs/ui-development.md` 的安全表达原则。

当前 MVP 包含：

- 账号登录（OPAQUE 协议）与会话恢复。
- 主密码解锁与本地锁定。
- 拉取、缓存、解密并展示密文条目。
- 凭据列表、凭据详情、新增、编辑、删除凭据。
- 复制用户名和密码。
- CSV 导入（5 步向导）。
- 恢复码生成与恢复码解锁。
- 设备信任注册、审批、撤销。
- 冲突解决 UI（保留本地、接受远端、创建副本、跳过）。
- 同步面板与活动日志。
- 密码生成器。
- 设置页面（自动锁定、master password 修改、导出等）。
- 离线读取已缓存密文。
- 手动同步与自动同步（可配置）。

当前 MVP 不包含：

- macOS Autofill Service / Credential Provider Extension。
- 生物识别解锁（Touch ID）。
- 系统级全局快捷键（非 App 内）。
- 自动更新（Sparkle 等）。

## 框架选择分析

桌面端选择 Tauri 2.x 而非 Electron，基于以下项目特定因素：

| 因素 | Tauri 2.x | Electron | 结论 |
| --- | --- | --- | --- |
| 安装包体积 | 2-5 MB | 100-200 MB | Tauri |
| 内存占用 | ~30 MB | ~150 MB+ | Tauri |
| 攻击面 | 系统 WebView (WebKit)，较小 | 内嵌 Chromium，较大 | Tauri |
| Rust 集成 | 原生 FFI，直接调用 crypto-core | 仅 WASM | Tauri |
| macOS 原生感 | 原生窗口控件、菜单栏 | 自定义 chrome | Tauri |
| 安全沙箱 | App Sandbox + Hardened Runtime | 进程模型较复杂 | Tauri |
| 生态成熟度 | 较新，社区增长中 | 非常成熟 | Electron |
| 调试体验 | WebKit Inspector + Rust debugger | Chrome DevTools | 相近 |

项目特定因素：

1. 密码管理器对安全性要求极高 — 较小的攻击面是核心优势。
2. 已有 Rust `crypto-core` — `Cargo.toml` 声明 `crate-type = ["cdylib", "rlib"]`，桌面端可直接链接为原生 Rust 库，无需 WASM。
3. Web 应用仅 2 个路由，内部导航基于状态 — 适合 Next.js 静态导出。
4. CSS Modules + CSS 自定义属性在 WebKit 中渲染正确。
5. Google Fonts (Jersey 10 + Manrope) 可通过 `<link>` 标签在 WebKit 中加载，也可打包为本地 WOFF2。**已实施自托管 TTF**（`public/fonts/`），`fonts.css` 中 `@font-face` + `font-display: swap`。

### 前端策略

**已采用 Vite SPA**（独立 `apps/desktop` 工程）：

- 使用 Vite + React 19 + CSS Modules 独立构建，不依赖 Next.js 静态导出。
- 复用 `packages/shared` DTO 和 CSS token 值，但拥有独立组件树。
- 字体自托管为本地 TTF 文件（`public/fonts/`），通过 `fonts.css` 加载，`font-display: swap`，无外部网络依赖。

## 技术栈

| 层级 | 技术 | 规范 |
| --- | --- | --- |
| App 框架 | Tauri 2.x (stable) | macOS 原生窗口、Rust 后端 |
| 后端语言 | Rust | 共享 `crates/crypto-core` 作为原生库 |
| 前端 | React 19 + CSS Modules | 复用 Web 设计系统 token |
| 前端构建 | Vite SPA | `target: safari15`、`manualChunks`（react vendor 分离） |
| 路由 | 状态导航（2 路由） | 与 Web 一致：`/` 和 `/vault` |
| API 类型 | `packages/shared` | 复用 Zod schema 和 DTO 类型 |
| 加密核心 | `crates/crypto-core`（原生 Rust） | 通过 Tauri command 直接 FFI，不使用 WASM |
| 安全存储 | macOS Keychain | 通过 `security-framework` 或 `keyring` crate |
| 本地密文缓存 | SQLite (rusqlite) | 保存 ciphertext、revision、lastSyncedAt、conflict marker |
| 图标 | lucide-react | 与 Web 一致 |
| 字体 | Jersey 10 + Manrope | **已自托管 TTF**（`public/fonts/`），`font-display: swap` |
| 测试 | Vitest (前端) + cargo test (Rust) + Tauri E2E | 桌面端 PR gate |
| 打包 | Tauri bundler | .dmg、.app，Apple 公证签名 |

## 文档索引

桌面端开发规范拆分为以下文档：

| 文档 | 内容 |
| --- | --- |
| [overview.md](./overview.md) | 本文档。项目概述、目标边界、框架选择分析、技术栈 |
| [architecture.md](./architecture.md) | 架构设计、数据流、Tauri command 桥接模式 |
| [adapters.md](./adapters.md) | adapter 模式：CryptoAdapter、SecureStore、CiphertextStore、ApiClient、SyncService |
| [code-sharing.md](./code-sharing.md) | 与 Web/shared 的代码复用规则和隔离边界 |
| [macos-platform.md](./macos-platform.md) | macOS 平台规范：Keychain、窗口、菜单栏、签名公证、安全特性、字体 |
| [ui-interaction.md](./ui-interaction.md) | 信息架构、页面结构、交互规范、视觉风格 |
| [sync-conflict.md](./sync-conflict.md) | 同步策略与冲突解决 |
| [security.md](./security.md) | 安全规范（继承 AGENT.md + 桌面端特有规则） |
| [development-phases.md](./development-phases.md) | 开发阶段规划（Phase 0-7） |
| [quality.md](./quality.md) | PR 验收门槛与文档更新规则 |

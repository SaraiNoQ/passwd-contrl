# 桌面端代码复用规则

Last updated: 2026-06-14

## 隔离规则

桌面端相关改动必须遵守以下规则：

- 不修改 `apps/web/app/*`、`apps/web/components/*` 的视觉样式、布局和交互来服务桌面端。
- 不通过重命名全局 CSS token、替换 Web 组件、调整 Web CSS Modules 来适配桌面端。
- 不从 `apps/web` 直接 import React 组件、CSS Modules、Next.js 页面或浏览器 DOM 专用 hook。
- 不修改 Web UI 来“配合”桌面端；桌面端缺口必须在 `apps/desktop` 内解决。
- 可复用的业务逻辑应逐步抽到 `packages/*`，并保持 Web 端测试通过。
- 涉及共享包的改动必须证明 Web、Extension、Worker API、Mobile 的协议行为没有回退。

## 允许复用

- `packages/shared` 中的 schema、DTO 和协议类型。
- `crates/crypto-core` 中的加密能力（作为原生 Rust 库，非 WASM）。
- Worker API 的现有 OPAQUE 登录、session、CSRF 和 item-level sync 协议。
- `docs/ui-development.md` 中的视觉原则、中文文案原则和安全边界。
- `docs/DESIGN.md` 和当前 `apps/web` 已落地的 Obscura Cloud Mist 亮色视觉模式。
- CSS 自定义属性 token 值（可复制到桌面端 token 文件，不可直接 import Web CSS Modules）。
- 设计系统组件模式（Button、Input、Badge 等）作为桌面端实现的参考。

## 不允许复用

- Web 的 CSS Modules 文件。
- Web 的 DOM 事件、`navigator.clipboard` 直接实现、`localStorage` 直接实现。
- Web 的 Next.js route、layout、page 或 app router 结构。
- 浏览器扩展 messaging 作为桌面端数据通道。
- `@zero-vault/crypto-core-wasm` — 桌面端使用原生 Rust，不使用 WASM。

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/SaraiNoQ/passwd-contrl/ci.yml?branch=main&style=flat-square&label=CI&logo=github" alt="CI Status" />
  <img src="https://img.shields.io/badge/tests-316%20passing-brightgreen?style=flat-square" alt="Tests" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/pnpm-9.15.0-orange?style=flat-square&logo=pnpm" alt="pnpm" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?style=flat-square&logo=rust" alt="Rust" />
</p>

<br />

<h1 align="center">Zero Vault</h1>

<p align="center">
  <strong>A zero-knowledge password manager — your secrets never leave your device unencrypted.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#architecture">Architecture</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="docs/">Documentation</a>
  ·
  <a href="#roadmap">Roadmap</a>
</p>

<p align="center">
  <a href="#中文说明">中文说明</a>
</p>

---

## Overview

Zero Vault is an end-to-end encrypted password manager built for the modern web. The server **never** sees your master password, derived keys, or plaintext vault contents — all encryption and decryption happens client-side using audited cryptographic primitives.

The project is a monorepo containing a **Web Vault** (Next.js), a **browser extension** (Manifest V3), a **desktop app** (Tauri), a **mobile app** (React Native / Expo), and a **Cloudflare Worker API** that stores only encrypted envelopes.

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Zero-Knowledge Encryption** | ✅ Complete | Argon2id + XChaCha20-Poly1305 (Rust → WASM). Server stores ciphertext only. |
| **OPAQUE Authentication** | ✅ Complete | Password-authenticated key exchange — the server never receives your password. |
| **Item-Level Sync** | ✅ Complete | Per-item encrypted sync with conflict detection and user-driven resolution. |
| **Browser Extension** | ✅ Complete | MV3 autofill with phishing protection, origin matching, and confirmed-fill only. |
| **Device Trust** | ✅ Complete | X25519 ECDH keypairs per device. Approve/revoke devices without exposing vault keys. |
| **Recovery Codes** | ✅ Complete | 256-bit random codes, client-side encryption. Server stores only the encrypted packet. |
| **CSV Import** | ✅ Complete | Parse browser exports in client memory, encrypt immediately, never persist plaintext. |
| **Desktop App** | 🚧 In Progress | Tauri 2.x macOS app with native crypto, Keychain, and SQLite cache. |
| **Mobile App** | 🚧 In Progress | React Native / Expo scaffold with 6 MVP screens and sync service. |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Clients                                    │
│                                                                     │
│  ┌──────────┐   ┌──────────────┐   ┌──────────┐   ┌────────────┐  │
│  │  Web App  │   │  Extension   │   │ Desktop  │   │   Mobile   │  │
│  │ (Next.js) │   │   (MV3)      │   │ (Tauri)  │   │  (Expo)    │  │
│  └─────┬─────┘   └──────┬───────┘   └────┬─────┘   └─────┬──────┘  │
│        │                │                 │               │         │
│        │         crypto-core-wasm         │               │         │
│        │      (Argon2id + XChaCha20)      │               │         │
│        │                │                 │               │         │
└────────┼────────────────┼─────────────────┼───────────────┼─────────┘
         │                │                 │               │
         │    ciphertext only (zero-knowledge)              │
         │                │                 │               │
┌────────┴────────────────┴─────────────────┴───────────────┴─────────┐
│                                                                     │
│                     Cloudflare Worker API                           │
│                       (Hono + D1 + R2)                              │
│                                                                     │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │   OPAQUE   │  │  Item Sync   │  │ Device Trust │                │
│  │    Auth    │  │  + Conflicts │  │  + Recovery  │                │
│  └────────────┘  └──────────────┘  └──────────────┘                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Data flow:** Clients derive keys locally → encrypt items locally → send only ciphertext to the API → other clients pull ciphertext → decrypt locally after unlock. The server is a dumb encrypted blob store.

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Crypto Core** | Rust + `wasm-pack` | Argon2id KDF, XChaCha20-Poly1305 AEAD, X25519 ECDH |
| **Web Vault** | Next.js 15, React 19, TypeScript | Vault management, import, recovery, sync UI |
| **Browser Extension** | Manifest V3, esbuild | Autofill with phishing protection |
| **Desktop App** | Tauri 2.x, React, Vite | Native macOS client with Keychain integration |
| **Mobile App** | React Native, Expo 52, Expo Router | Cross-platform mobile client |
| **API** | Cloudflare Workers, Hono 4 | Zero-knowledge sync API |
| **Database** | Cloudflare D1 (SQLite) | Encrypted envelope storage |
| **Object Storage** | Cloudflare R2 | Encrypted export bundles |
| **Auth** | OPAQUE (`@serenity-kit/opaque`) | Password-authenticated key exchange |
| **Validation** | Zod | Runtime schema validation at boundaries |
| **Monorepo** | pnpm workspaces | Shared packages across apps |
| **Testing** | Vitest, Playwright, `cargo test` | Unit, integration, and E2E tests |
| **CI/CD** | GitHub Actions | Typecheck, test, build, audit, E2E |

## Project Structure

```
zero-vault/
├── apps/
│   ├── web/                  # Web Vault (Next.js 15)
│   ├── extension/            # Browser extension (Manifest V3)
│   ├── desktop/              # macOS desktop app (Tauri 2.x)
│   ├── mobile/               # Mobile app (React Native / Expo)
│   └── worker-api/           # Cloudflare Worker API (Hono + D1)
│       └── migrations/       # D1 SQL migrations
├── packages/
│   ├── shared/               # DTOs, validation schemas (Zod)
│   └── crypto-core-wasm/     # WASM bindings for Rust crypto
├── crates/
│   └── crypto-core/          # Rust KDF + AEAD primitives
├── docs/                     # Architecture, security, and design docs
├── .github/workflows/        # CI pipeline
└── UI/                       # UI design references
```

## Quick Start

### Prerequisites

- **Node.js** 20+
- **pnpm** 9.15+ (`corepack enable` or `npm i -g pnpm`)
- **Rust** toolchain (for WASM crypto build) — [setup guide](docs/rust-environment.md)

### Local Development

```bash
# 1. Clone and install
git clone https://github.com/SaraiNoQ/passwd-contrl.git
cd passwd-contrl
pnpm install

# 2. Initialize the local database
pnpm --filter @zero-vault/worker-api db:migrate

# 3. Start the Worker API (port 8787)
pnpm dev:worker

# 4. Start the Web Vault (port 3000) — in a new terminal
pnpm dev:web
```

Configure the Web Vault to connect to the local API by creating `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8787
```

> **Note:** No Docker required. The Worker API uses Wrangler's local D1/R2 simulation.

### Build WASM Crypto

```bash
pnpm wasm:build
```

### Browser Extension

```bash
pnpm dev:extension
```

Load `apps/extension` as an unpacked extension in Chrome/Edge. Set `NEXT_PUBLIC_EXTENSION_ID` in `.env.local` to the extension ID shown by the browser.

### Desktop App

```bash
# Start the Worker API first, then:
ZERO_VAULT_API_URL=http://localhost:8787 pnpm --dir apps/desktop exec tauri dev
```

## Testing

```bash
# All TypeScript tests
pnpm test

# Rust crypto tests
pnpm test:rust

# Everything
pnpm test:all

# E2E tests (requires running services)
pnpm test:e2e

# Typecheck all packages
pnpm typecheck
```

### CI Pipeline

GitHub Actions runs on every push and PR:

| Job | What it checks |
|-----|---------------|
| Typecheck | `tsc --noEmit` across all packages |
| Test | Vitest unit + integration tests |
| Build | Production build for all apps |
| Extension E2E | Playwright tests for browser extension |
| Web Vault E2E | Playwright tests for web vault |
| Sync E2E | End-to-end sync flow tests |
| Lint | ESLint across packages |
| Rust Test | `cargo test` for crypto-core |
| WASM Build | Verifies WASM compilation |
| Audit | `pnpm audit` + `cargo audit` |

## Deployment

Zero Vault deploys on **Cloudflare Workers** with D1 (database) and R2 (object storage).

```bash
# Create D1 database
cd apps/worker-api
npx wrangler d1 create zero-vault-db

# Apply migrations
npx wrangler d1 migrations apply zero-vault-db

# Set production secrets
npx wrangler secret put SESSION_SECRET
npx wrangler secret put OPAQUE_SERVER_SETUP
npx wrangler secret put MAINTENANCE_TOKEN

# Deploy
npx wrangler deploy
```

See the [Cloudflare Deployment Guide](docs/cloudflare-deployment.md) for R2 setup, custom domains, and monitoring.

## Security

Zero Vault is built on a strict zero-knowledge security model:

- **The server never receives the master password.** Authentication uses OPAQUE, a password-authenticated key exchange protocol.
- **The server cannot decrypt vault items.** All encryption is client-side using Argon2id + XChaCha20-Poly1305.
- **Recovery codes never leave the device.** The server stores only an encrypted recovery packet.
- **Device trust uses per-device X25519 keypairs.** The server stores encrypted vault keys it cannot decrypt.
- **Autofill requires explicit user confirmation** and never fills hidden, cross-origin, or insecure fields.
- **CSV imports are parsed in client memory only** and encrypted before any sync.

### Key Hierarchy

```
Master Password (never sent to server)
  └─ Argon2id → Master Key
       └─ wraps → Vault Key (random symmetric)
            └─ derives → Item Keys (per-item)
                 └─ encrypts → Item Payloads (XChaCha20-Poly1305)
```

See the [Security Model](docs/security-model.md), [Threat Model](docs/threat-model.md), and [Security Audit Report](docs/security-audit-report.md) for full details.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | Component overview and data flow |
| [Security Model](docs/security-model.md) | Key hierarchy, dual runtime, encryption model |
| [Threat Model](docs/threat-model.md) | Threats and mitigations |
| [Sync Protocol](docs/sync-protocol.md) | Whole-envelope and item-level sync |
| [Recovery](docs/recovery.md) | Recovery code generation and flow |
| [Device Trust](docs/device-trust.md) | Multi-device access and approval |
| [Autofill](docs/autofill.md) | Fill rules, phishing protection, field checks |
| [Import](docs/import.md) | CSV import flow and security |
| [Development](docs/development.md) | Local setup, testing, extension dev |
| [Mobile Development](docs/mobile-development.md) | React Native / Expo mobile app |
| [Desktop Development](docs/mac-dev/overview.md) | Tauri macOS app specifications |
| [Cloudflare Deployment](docs/cloudflare-deployment.md) | Workers, D1, R2 setup and deployment |
| [Release Gate](docs/release-gate.md) | Launch readiness checklist |
| [Incident Response](docs/incident-response.md) | Security incident procedures |
| [Roadmap](docs/roadmap.md) | Phase status and plan |

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 — Foundation | ✅ | Monorepo, docs, CI, package scripts |
| Phase 1 — Crypto Core | ✅ | Rust Argon2id + XChaCha20-Poly1305, WASM, vault create/unlock/lock, CSV import |
| Phase 2 — API + Sync | ✅ | OPAQUE auth, HttpOnly cookies, CSRF, whole-envelope sync, D1 storage |
| Phase 3 — Extension | ✅ | MV3, form detection, confirmed fill, phishing protection, E2E tests |
| Phase 4 — Item-Level Sync | ✅ | Per-item encrypted sync, conflicts, recovery, device trust |
| Phase 5 — Production | ✅ | Security audit, 299+ tests, Worker API deployed to Cloudflare |
| UI Refactor | ✅ | Design system, component library, responsive layout, A11y |
| Phase 6 — Mobile | 🚧 | Expo scaffold, 6 screens, sync service (crypto integration pending) |
| Phase 7 — Desktop | 🚧 | Tauri macOS app, native adapters (key custody and smoke tests pending) |

---

## 中文说明

### 项目简介

Zero Vault 是一款零知识密码管理器，支持 Web 保险库、浏览器扩展自动填充，以及未来的 Android / iOS / macOS 客户端。

**核心原则：服务器永远不会看到你的主密码、派生密钥或明文保险库内容。所有加密操作均在客户端完成。**

### 技术架构

- **加密核心** — Rust 编写的 Argon2id 密钥派生 + XChaCha20-Poly1305 认证加密，通过 WASM 在浏览器中运行
- **Web 保险库** — Next.js 15 + React 19，提供保险库管理、CSV 导入、恢复码设置、同步与设备管理
- **浏览器扩展** — Manifest V3，支持表单检测、确认填充、钓鱼网站防护
- **桌面应用** — Tauri 2.x macOS 原生应用，集成 Keychain 和本地 SQLite 缓存
- **移动应用** — React Native + Expo，已完成基础框架搭建
- **后端 API** — Cloudflare Workers + Hono，使用 D1 (SQLite) 和 R2 存储加密数据
- **认证协议** — OPAQUE（密码认证密钥交换），服务器不接触明文密码

### 快速开始

```bash
# 安装依赖
pnpm install

# 初始化本地数据库
pnpm --filter @zero-vault/worker-api db:migrate

# 启动后端 API（端口 8787）
pnpm dev:worker

# 启动 Web 前端（端口 3000）
pnpm dev:web
```

在 `apps/web/.env.local` 中配置：

```env
NEXT_PUBLIC_API_URL=http://localhost:8787
```

### 开发阶段状态

| 阶段 | 状态 | 说明 |
|------|------|------|
| 阶段 0 — 项目基础 | ✅ 完成 | Monorepo、文档、CI 流水线 |
| 阶段 1 — 加密核心 | ✅ 完成 | Rust Argon2id + XChaCha20-Poly1305，WASM 导出，保险库创建/解锁/锁定，CSV 导入 |
| 阶段 2 — API + 同步 | ✅ 完成 | OPAQUE 认证，HttpOnly Cookie，CSRF 防护，整体信封同步，D1 存储 |
| 阶段 3 — 浏览器扩展 | ✅ 完成 | MV3，表单检测，确认填充，钓鱼防护，E2E 测试 |
| 阶段 4 — 项目级同步 | ✅ 完成 | 逐条加密同步，冲突检测与解决，恢复码，设备信任 |
| 阶段 5 — 生产就绪 | ✅ 完成 | 安全审计，299+ 测试通过，Worker API 已部署至 Cloudflare |
| UI 重构 | ✅ 完成 | 设计系统、组件库、响应式布局、无障碍支持 |
| 阶段 6 — 移动端 | 🚧 进行中 | Expo 框架搭建，6 个 MVP 页面，同步服务（加密集成待完成） |
| 阶段 7 — 桌面端 | 🚧 进行中 | Tauri macOS 应用，原生适配器（密钥托管和冒烟测试待完成） |

### 安全原则

- 服务器**绝不接收**主密码
- 服务器**无法解密**保险库内容
- 恢复码**绝不发送**到服务器
- 设备信任使用**每设备 X25519 密钥对**
- 自动填充**必须用户确认**，且不会填充隐藏、跨域或非安全字段
- CSV 导入**仅在客户端内存中解析**，立即加密后同步

### 文档索引

完整文档请查看 [`docs/`](docs/) 目录，包含架构设计、安全模型、威胁模型、同步协议、恢复流程、设备信任、自动填充规则、部署指南等。

---

## License

This project is licensed under the [MIT License](LICENSE).

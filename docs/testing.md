# 测试文档

本文档描述 Zero Vault 项目的测试架构、运行方式和编写规范。

## 测试架构概览

Zero Vault 采用三层测试策略：

| 层级 | 工具 | 覆盖范围 | 运行速度 |
|------|------|----------|----------|
| 单元测试 | Vitest | 函数、hooks、schema 校验、加密原语 | 毫秒级 |
| 集成测试 | Vitest + Miniflare | Worker API 路由、存储层、同步协议 | 秒级 |
| 端到端测试 | Playwright | 完整用户流程、浏览器扩展、跨端同步 | 分钟级 |

Rust 加密核心使用 `cargo test` 独立运行，WASM 构建后通过 Vitest 集成测试验证。

```
单元测试 (Vitest + cargo test)
  ├── apps/web          — hooks、lib 函数
  ├── apps/worker-api   — 路由处理、存储层
  ├── apps/extension    — 表单检测、origin 匹配
  ├── packages/shared   — schema 校验、DTO 验证
  └── crates/crypto-core — AEAD、KDF、nonce 安全

集成测试 (Vitest + Miniflare)
  └── apps/worker-api   — Worker API 端到端路由测试

端到端测试 (Playwright)
  ├── apps/web          — Vault 完整用户流程
  ├── apps/web (sync)   — Worker 同步流程
  └── apps/extension    — 浏览器扩展注入与填充
```

## 快速开始

### 安装依赖

```sh
npx pnpm install
```

### 运行所有测试

```sh
# 单元测试（TypeScript）
npx pnpm test

# 单元测试（Rust）
cargo test --manifest-path crates/crypto-core/Cargo.toml

# 端到端测试
npx pnpm test:e2e
```

### 首次运行 Playwright

```sh
npx playwright install chromium
```

## 单元测试

单元测试使用 [Vitest](https://vitest.dev/)，通过 pnpm workspace 统一管理。

### 运行全部单元测试

```sh
npx pnpm test
```

这会并行运行所有 workspace 的单元测试。

### 运行 Rust 加密测试

```sh
cargo test --manifest-path crates/crypto-core/Cargo.toml
```

Rust 测试覆盖：
- AES-256-GCM 加密/解密正确性
- tamper 检测（篡改密文应失败）
- wrong-key 检测（错误密钥应失败）
- nonce 唯一性验证
- Argon2id KDF 参数验证

### 按 workspace 运行

```sh
# Web Vault — lib 函数 + hooks
npx pnpm --filter @zero-vault/web test

# Worker API — 路由处理 + 存储层
npx pnpm --filter @zero-vault/worker-api test

# 浏览器扩展 — 表单检测、origin 匹配
npx pnpm --filter @zero-vault/extension test

# 共享包 — schema 校验
npx pnpm --filter @zero-vault/shared test
```

### 覆盖率

```sh
# 单个 workspace 覆盖率
npx pnpm --filter @zero-vault/web test -- --coverage

# 全量覆盖率（需在各 workspace 分别运行）
npx pnpm --filter @zero-vault/web test -- --coverage
npx pnpm --filter @zero-vault/worker-api test -- --coverage
npx pnpm --filter @zero-vault/extension test -- --coverage
npx pnpm --filter @zero-vault/shared test -- --coverage
```

覆盖率报告输出到各 workspace 的 `coverage/` 目录，格式为 lcov。

## 端到端测试

端到端测试使用 [Playwright](https://playwright.dev/)，在真实浏览器环境中验证完整用户流程。

### Web Vault E2E

测试 Vault 的完整用户流程：注册、登录、创建/编辑/删除条目、导入导出。

```sh
npx pnpm --filter @zero-vault/web test:e2e
```

- 开发服务器端口：3001
- 浏览器：Chromium (headless)
- 超时：30s per test

### Worker 同步 E2E

测试客户端与 Worker API 之间的同步流程：设备注册、密钥交换、增量同步、冲突检测。

```sh
npx pnpm --filter @zero-vault/web test:e2e:sync
```

- Web 服务器端口：3010
- Worker API 端口：8790
- 测试场景：首次同步、增量更新、冲突上报

### 浏览器扩展 E2E

测试扩展的注入、表单检测、origin 匹配和自动填充流程。

```sh
npx pnpm --filter @zero-vault/extension test:e2e
```

- 加载已构建的扩展到 Chromium
- 测试页面包含各种登录表单变体
- 验证跨 origin iframe 被阻止

### 运行全部 E2E

```sh
npx pnpm test:e2e
```

## CI/CD 流水线

项目使用 GitHub Actions 进行持续集成。流水线在每次 PR 和推送到 main 时触发。

### 工作流概览

| Job | 描述 | 依赖 |
|-----|------|------|
| `typecheck` | TypeScript 类型检查 | 无 |
| `lint` | ESLint + rustfmt 检查 | 无 |
| `test` | 全量 Vitest 单元测试 | 无 |
| `rust-test` | `cargo test` 加密核心 | 无 |
| `wasm-build` | 构建 crypto-core WASM 包 | `rust-test` |
| `build` | 构建所有 workspace | `typecheck` |
| `web-e2e` | Web Vault E2E 测试 | `build` |
| `web-e2e-sync` | Worker 同步 E2E 测试 | `build` |
| `extension-e2e` | 浏览器扩展 E2E 测试 | `build` |
| `audit` | `pnpm audit` + `cargo audit` | 无 |

### 流水线结构

```
┌─────────────┐   ┌──────┐   ┌───────────┐   ┌────────────┐
│  typecheck  │   │ lint │   │   test    │   │ rust-test  │
└──────┬──────┘   └──────┘   └───────────┘   └─────┬──────┘
       │                                            │
       │                                     ┌──────┴──────┐
       │                                     │ wasm-build  │
       │                                     └──────┬──────┘
       ▼                                            │
  ┌─────────┐                                       │
  │  build  │ ◄─────────────────────────────────────┘
  └────┬────┘
       │
       ├──────────────────┬──────────────────┐
       ▼                  ▼                  ▼
┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│  web-e2e   │  │ web-e2e-sync │  │extension-e2e │
└─────────────┘  └──────────────┘  └──────────────┘

┌───────────┐
│   audit   │  (独立运行，无依赖)
└───────────┘
```

### 运行本地 CI 检查

提交前运行完整检查：

```sh
npx pnpm typecheck
npx pnpm test
cargo test --manifest-path crates/crypto-core/Cargo.toml
```

## 编写新测试

### 单元测试模式

#### Vitest 基本结构

```ts
// src/lib/__tests__/vault.test.ts
import { describe, it, expect } from 'vitest'
import { encryptItem, decryptItem } from '../vault'

describe('vault item encryption', () => {
  it('should round-trip encrypt and decrypt', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32))
    const plaintext = { name: 'test', value: 'secret' }

    const encrypted = await encryptItem(plaintext, key)
    const decrypted = await decryptItem(encrypted, key)

    expect(decrypted).toEqual(plaintext)
  })

  it('should fail with wrong key', async () => {
    const key1 = crypto.getRandomValues(new Uint8Array(32))
    const key2 = crypto.getRandomValues(new Uint8Array(32))
    const plaintext = { name: 'test', value: 'secret' }

    const encrypted = await encryptItem(plaintext, key1)

    await expect(decryptItem(encrypted, key2)).rejects.toThrow()
  })
})
```

#### Mocking WASM 模块

在测试中 mock WASM 模块时，使用 Vitest 的 `vi.mock`：

```ts
import { vi, describe, it, expect } from 'vitest'

vi.mock('@zero-vault/crypto-core', () => ({
  encrypt: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  decrypt: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
  derive_key: vi.fn().mockResolvedValue(new Uint8Array(32)),
}))
```

如果需要测试真实的 WASM 调用（推荐用于加密相关测试），确保 WASM 文件已构建：

```sh
cd crates/crypto-core && wasm-pack build --target web
```

#### 测试加密原语

Rust 侧的加密测试应覆盖安全边界：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = generate_key();
        let plaintext = b"vault item data";
        let nonce = generate_nonce();

        let ciphertext = encrypt(&key, &nonce, plaintext).unwrap();
        let decrypted = decrypt(&key, &nonce, &ciphertext).unwrap();

        assert_eq!(plaintext.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn tampered_ciphertext_should_fail() {
        let key = generate_key();
        let plaintext = b"vault item data";
        let nonce = generate_nonce();

        let mut ciphertext = encrypt(&key, &nonce, plaintext).unwrap();
        ciphertext[0] ^= 0xff; // 篡改

        assert!(decrypt(&key, &nonce, &ciphertext).is_err());
    }

    #[test]
    fn wrong_key_should_fail() {
        let key1 = generate_key();
        let key2 = generate_key();
        let plaintext = b"vault item data";
        let nonce = generate_nonce();

        let ciphertext = encrypt(&key1, &nonce, plaintext).unwrap();

        assert!(decrypt(&key2, &nonce, &ciphertext).is_err());
    }
}
```

### E2E 测试模式

#### Page Object 模式

```ts
// tests/e2e/pages/vault.page.ts
import { type Page, type Locator } from '@playwright/test'

export class VaultPage {
  readonly page: Page
  readonly addItemButton: Locator
  readonly searchInput: Locator
  readonly itemList: Locator

  constructor(page: Page) {
    this.page = page
    this.addItemButton = page.getByRole('button', { name: '添加条目' })
    this.searchInput = page.getByPlaceholder('搜索...')
    this.itemList = page.getByRole('list', { name: '密码列表' })
  }

  async goto() {
    await this.page.goto('http://localhost:3001')
  }

  async addItem(name: string, username: string, password: string) {
    await this.addItemButton.click()
    await this.page.getByLabel('名称').fill(name)
    await this.page.getByLabel('用户名').fill(username)
    await this.page.getByLabel('密码').fill(password)
    await this.page.getByRole('button', { name: '保存' }).click()
  }

  async expectItemVisible(name: string) {
    await this.itemList.getByText(name).waitFor({ state: 'visible' })
  }
}
```

#### 使用 waitFor 模式

```ts
import { test, expect } from '@playwright/test'

test('should create and display vault item', async ({ page }) => {
  const vault = new VaultPage(page)
  await vault.goto()

  await vault.addItem('GitHub', 'user@example.com', 'secure-password')
  await vault.expectItemVisible('GitHub')
})
```

避免使用硬编码的 `page.waitForTimeout()`。优先使用：
- `locator.waitFor()` — 等待元素出现
- `expect(locator).toBeVisible()` — 断言可见性
- `page.waitForResponse()` — 等待 API 响应
- `page.waitForLoadState()` — 等待页面加载

### 安全测试模式

#### 信息泄漏测试

确保敏感数据不会泄漏到 DOM、URL 或网络请求中：

```ts
test('master password should not appear in DOM', async ({ page }) => {
  await page.goto('http://localhost:3001/login')
  await page.getByLabel('主密码').fill('my-secret-password')
  await page.getByRole('button', { name: '登录' }).click()

  // 检查 DOM 中不包含主密码
  const bodyText = await page.textContent('body')
  expect(bodyText).not.toContain('my-secret-password')

  // 检查网络请求中不包含主密码
  const requests: string[] = []
  page.on('request', (req) => requests.push(req.postData() || ''))

  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForLoadState('networkidle')

  for (const body of requests) {
    expect(body).not.toContain('my-secret-password')
  }
})
```

#### Wrong-key 测试

验证错误密钥无法解密数据：

```ts
test('decryption with wrong key should fail gracefully', async () => {
  const itemKey1 = generateItemKey()
  const itemKey2 = generateItemKey()

  const encrypted = await encryptVaultItem(testItem, itemKey1)

  await expect(decryptVaultItem(encrypted, itemKey2)).rejects.toThrow(
    /decryption failed|authentication/i
  )
})
```

## 覆盖率报告

### 配置

覆盖率使用 Vitest 内置的 v8 provider，输出 lcov 格式。

各 workspace 的 `vitest.config.ts` 中配置：

```ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
})
```

### 覆盖率阈值

| Workspace | 行覆盖率目标 | 分支覆盖率目标 |
|-----------|-------------|---------------|
| packages/shared | 90% | 85% |
| apps/web (lib) | 80% | 75% |
| apps/worker-api | 85% | 80% |
| apps/extension | 75% | 70% |

安全关键路径（加密、密钥派生、origin 匹配）要求 100% 行覆盖率。

### 查看报告

```sh
# 生成报告
npx pnpm --filter @zero-vault/web test -- --coverage

# 打开 HTML 报览
open apps/web/coverage/index.html
```

## 常见问题

### WASM 加载失败

**症状**：测试报错 `WebAssembly.compile(): Wasm code generation disallowed by embedder`

**原因**：Node.js 测试环境中默认不支持 `WebAssembly.compile()` 的异步编译。

**解决**：

1. 确保 WASM 已预构建：
   ```sh
   cd crates/crypto-core && wasm-pack build --target web
   ```

2. 在 `vitest.config.ts` 中配置 WASM 处理：
   ```ts
   export default defineConfig({
     test: {
       server: {
         deps: {
           inline: [/@zero-vault\/crypto-core/],
         },
       },
     },
   })
   ```

3. 对于不需要真实加密的测试，使用 mock：
   ```ts
   vi.mock('@zero-vault/crypto-core')
   ```

### 端口冲突

**症状**：E2E 测试报错 `EADDRINUSE: address already in use`

**默认端口分配**：

| 服务 | 端口 |
|------|------|
| Web Vault (dev) | 3000 |
| Web Vault (E2E) | 3001 |
| Worker API (E2E sync) | 8790 |
| Web Vault (E2E sync) | 3010 |

**解决**：

```sh
# 查找占用端口的进程
lsof -i :3001

# 终止进程
kill -9 <PID>
```

### 同步测试不稳定

**症状**：`test:e2e:sync` 偶尔超时或断言失败。

**常见原因**：
- Worker API 启动慢，客户端请求过早
- 本地 Miniflare 实例未完全初始化
- 测试间状态未清理

**解决**：

1. 使用 `webServer` 配置的 `reuseExistingServer` 避免重复启动：
   ```ts
   // playwright.config.ts
   webServer: [
     {
       command: 'pnpm dev:worker',
       port: 8790,
       reuseExistingServer: !process.env.CI,
     },
   ],
   ```

2. 在测试中等待服务就绪：
   ```ts
   await page.waitForResponse(
     (res) => res.url().includes('/api/health') && res.status() === 200
   )
   ```

3. 使用 `test.beforeEach` 清理状态：
   ```ts
   test.beforeEach(async ({ request }) => {
     await request.post('http://localhost:8790/api/test/reset')
   })
   ```

### Cargo test 失败

**症状**：`cargo test` 报错找不到 crate 或编译失败。

**解决**：

```sh
# 确保在项目根目录运行
cargo test --manifest-path crates/crypto-core/Cargo.toml

# 清理构建缓存
cargo clean --manifest-path crates/crypto-core/Cargo.toml

# 重新编译
cargo test --manifest-path crates/crypto-core/Cargo.toml
```

# 桌面端质量保障

Last updated: 2026-06-08

## PR 验收门槛

所有桌面端相关 PR 至少运行：

```sh
pnpm --filter @zero-vault/web typecheck
pnpm --filter @zero-vault/web test
pnpm --filter @zero-vault/shared test
cargo test --manifest-path crates/crypto-core/Cargo.toml
```

涉及桌面端工程后，还必须运行：

```sh
pnpm --filter @zero-vault/desktop typecheck
pnpm --filter @zero-vault/desktop test
pnpm --filter @zero-vault/desktop build
```

桌面端依赖 Worker API 的 `/auth/login/direct` 端点，Auth 相关变更必须运行：

```sh
pnpm --filter @zero-vault/worker-api typecheck
pnpm --filter @zero-vault/worker-api test
```

涉及共享包、API 协议或同步行为时，额外运行：

```sh
pnpm --filter @zero-vault/web test:e2e:sync
```

桌面端 E2E smoke 至少覆盖：

- 登录（OPAQUE）。
- 解锁。
- 查看凭据列表。
- 查看凭据详情。
- 新增凭据。
- 编辑凭据。
- 删除凭据。
- CSV 导入。
- 复制用户名或密码。
- 手动锁定。
- 手动同步。
- 离线读取已缓存密文。

## 文档与实现更新规则

当桌面端进入实现阶段，下列变更必须同步更新本文档集：

- 新增或改变桌面端技术栈。
- 新增 API 协议或改变 sync 行为。
- 改变加密参数、native crypto binding 或 key storage 策略。
- MVP 范围扩大到 Autofill Service、Credential Provider、Touch ID 解锁或自动更新。
- 引入新的持久化存储、analytics、crash reporting 或日志系统。
- 改变前端构建策略（如从静态导出切换到 Vite SPA）。

本文档优先级高于临时实现偏好。若实现需要违反本文档，必须先更新文档并说明安全和 Web 兼容影响。

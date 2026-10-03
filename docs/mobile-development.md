# Zero Vault 移动端开发规范

Last updated: 2026-07-27

Android 是当前唯一移动端实施范围。权威规范已拆分到 [Android 开发文档体系](android-dev/overview.md)。iOS、passkey、Wear OS 和浏览器扩展重构不在本阶段范围。

当前交付目标是给用户自有设备侧载和覆盖升级的个人签名 release APK；Play/AAB 是后续独立目标，不阻塞个人分发。最后已验证签名构建是 `0.1.1 / versionCode 18`；`0.1.2 / versionCode 19` 是当前候选。clear-state 服务端灾难恢复已于 `20260730T124911Z-e2e-local-91529-15360` 通过；强化双设备审批、同步、冲突、跨设备删除、撤销和恢复后旧设备失效已于 `20260730T125747Z-e2e-multidevice-api36-94573-25141` 通过。最终源码指纹的 API 36 instrumented、新个人 APK、真实 Chrome、服务器外 keystore 备份和真机安装/升级仍开放。完整门禁状态见 [总览](android-dev/overview.md)。

## 固定决策

- 工程保留在 `apps/mobile`，采用 React Native / Expo UI、Kotlin `VaultRepository` 和 Rust `crypto-core`。
- Android 8（API 26）为最低版本；API 26–33 使用 AutofillService，API 34+ 同时接入 Credential Provider。
- Room 保存密文和同步元数据；明文只在解锁后的短期内存中。
- JS 只持有 native vault session handle，密钥、OPAQUE state 和 Keystore key 不返回 JS。
- Android 不支持旧 `webcrypto-mvp` 密码库；先在 Web 完成显式迁移。
- 生产路径禁止 direct login、测试 crypto adapter、内存存储和静默安全降级。
- 自动 Android 测试只运行 API 36；API 26 仅保留为 `minSdk` 安装兼容声明。
- 分发使用长期个人 release keystore 签名的 APK；Play service account、AAB 和应用商店上传不作为门禁。
- UI 首次启动默认中文和浅色；设置提供 English 与浅色/深色/跟随系统三档。RN 应用语言与 Android 系统 locale 是独立边界。
- 核心认证、恢复和保险库页面使用统一翻译层；恢复码、用户名、密码、备注、卡片和自定义字段等用户数据不得进入翻译函数。全路由动态错误、原生资源、截断和冷启动语言保持仍须在 API 36 候选回归中验证，不能仅凭词条存在标记完成。
- 页面图标使用 Expo Symbols；应用/adaptive icon、native splash 淡出和 React Native 品牌加载动画使用仓库内品牌资源。
- 恢复码允许通过敏感剪贴板接口复制并请求 30 秒后清理；系统剪贴板历史不属于应用可完全保证的边界。
- 开发阶段暂时不启用截图限制，便于 UI 反馈；截图只允许合成数据。最终个人日常使用候选是否恢复敏感页面限制必须单独决定。

## 开发位置

本地只编辑、审查和同步。所有 mobile typecheck/test、Expo、Java、Gradle、Android SDK/NDK、Rust Android target、模拟器与 Maestro 操作必须通过 `pnpm mobile:remote:*` 在 `root@campus-server` 容器运行。详见 [远程开发规范](android-dev/remote-development.md) 和根目录 `AGENT.md`。

当前收口使用的远程入口如下；除 `artifacts` 外均先同步当前工作区：

```bash
pnpm mobile:remote:typecheck
pnpm mobile:remote:test:targeted
pnpm mobile:remote:e2e:local
pnpm mobile:remote:e2e:recovery
pnpm mobile:remote:e2e:multidevice
pnpm mobile:remote:browser-cert:device /path/to/chrome-base.apk
pnpm mobile:remote:build:personal
pnpm mobile:remote:upgrade-check <old-personal-run-id> <new-personal-run-id>
pnpm mobile:remote:artifacts <supported-run-id>
```

`e2e:local` 的离线重启门禁不切换飞行模式：独立账户注册后，由随机 token 授权的本地 HTTPS 代理一次性断开下一次 item-sync POST；prepare 保留 Room mutation 并杀死进程，resume 后成功 POST 数必须精确增加 1。`build:personal` 必须从最终 APK 验证 bundle API URL 只出现一次，并核对 APK 内实际 allowlist JSON digest；`upgrade-check` 必须先确认当前源码 fingerprint 与新 APK 构建 fingerprint 相同。

候选自动化只运行 API 36，不执行 API 26/29/33/34/35 矩阵；`minSdk 26` 仅表示安装兼容声明。发布给设备所有者使用前仍须完成独立加密 keystore 备份、目标设备 Chrome 签名证书 allowlist、真机首次安装和同签名覆盖升级；模拟器证据不能替代这些真机门禁。冷启动离线解锁目前只支持已启用强生物识别的设备，密码模式仍需要在线 OPAQUE 授权。

## 索引

- [架构](android-dev/architecture.md)
- [Native Bridge](android-dev/native-bridge.md)
- [认证、数据与同步](android-dev/data-auth-sync.md)
- [平台安全](android-dev/android-platform.md)
- [Autofill / Credential Provider](android-dev/autofill-credential-provider.md)
- [功能与 UI](android-dev/feature-parity-ui.md)
- [UI、国际化与主题](android-dev/ui-i18n-theme.md)
- [安全](android-dev/security.md)
- [实施阶段](android-dev/development-phases.md)
- [生产客户端计划与门禁](android-dev/production-client-plan.md)
- [质量与发布](android-dev/quality-release.md)
- [个人 APK 安装与升级](android-dev/personal-installation.md)

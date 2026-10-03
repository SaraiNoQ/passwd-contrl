# Android 平台安全

Last updated: 2026-07-25

> **实现状态：** Keystore wrapping、biometric gate、敏感剪贴板、backup/data-extraction 和 cleartext 禁止配置已有源码；2026-07-16 的历史快照曾通过相关 instrumented。当前及后续自动验证仅运行 API 36，`minSdk 26` 仍是安装兼容声明。开发阶段按项目所有者要求暂时不设置 `FLAG_SECURE`，以便截图反馈；这是一项已知开发风险，不是安全门禁通过。StrongBox 选择、真实设备系统锁屏/生物信息变化、完整业务生命周期和 release manifest 仍按发布门禁处理。

## Keystore 与生物识别

- 生成不可导出的 AES wrapping key；设备私钥、session token、wrapped vault key 只能以密文形式落盘。
- 生物识别用 `BiometricPrompt` 授权 key operation，不把 biometric 当作主密码或独立恢复方式。
- enrollment 变化、锁屏凭据移除或硬件 key invalidation 时进入 `KEY_INVALIDATED`，清除不可用包装材料并要求主密码/恢复/重新审批。
- 优先 StrongBox 是发布目标；当前实现是否实际选择 StrongBox 必须以代码审查和设备证据确认。任何 fallback 都不得回退到明文或 JS storage。

## 生命周期

进入后台、屏幕关闭、系统锁定或达到自动锁定时间时撤销 session handle。恢复码页面进入后台时还必须立即从当前界面清除一次性恢复码。进程死亡恢复只能加载密文和锁定态。所有 Activity、Service 和 Worker 共享锁状态的原生事实源。

当前 RN AppState/自动锁、Repository session 和系统服务访问路径已有代码，但屏幕关闭/系统锁定、进程死亡和所有组件一致性尚未通过 instrumented 测试。

## 数据泄漏防护

- 开发阶段敏感 Activity 暂不设置 `FLAG_SECURE`，截图和录屏可能捕获明文；只能使用合成数据调试，最终日常使用候选是否恢复该限制必须形成显式决策。Recents 仍应使用无敏感内容占位。
- 复制必须由用户触发，密码与恢复码剪贴板标记 sensitive，并在可行时定时清除；当前恢复码复制请求 30 秒后清理，但不能保证系统或第三方剪贴板历史同步删除。
- Android backup/data extraction rules 排除 Room、SecureStore、wrapped keys、session、缓存和日志。
- release 禁用网络 body、SQL、crypto 参数和明文日志；崩溃报告只允许错误码和匿名版本信息。

## 网络与组件

仅允许 HTTPS；config plugin 生成的 network security config 禁止 cleartext，并仅信任系统 CA。所有 exported component 明确声明用途并校验调用方。Autofill/Credential Provider 只通过 Repository 访问；intent、deep link 和 Binder 参数都视为不可信。最终生成 manifest 必须在每个 release 候选中审查。

包可见性按最小权限处理：原生模块只通过 manifest 的
`MAIN + LAUNCHER` intent query 发现用户可启动 App，不声明
Google Play 受限的 `QUERY_ALL_PACKAGES`。编辑器选择器因此只展示可启动 App；
Autofill 若无法读取目标 package 的当前单一签名则 fail closed，不以扩大包清单权限作为
降级方案。每个发布候选都必须检查合并后的 manifest，确认受限权限没有被传递依赖重新引入。

最低 API 26。每次升级 targetSdk 都要复查后台执行、通知、剪贴板、biometric、backup 和 Credential Manager 行为变化。

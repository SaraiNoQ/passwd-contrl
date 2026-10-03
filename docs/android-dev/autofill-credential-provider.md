# Autofill 与 Credential Provider

Last updated: 2026-07-26

> **实现状态：** `AutofillService`、API 30+ inline suggestion、API 34+ password-only Credential Provider、认证 Activity、target 校验和 native module manifest/resources 已有源码；config plugin 负责宿主安全属性和 personal-release allowlist。自动 Android 验证仅运行 API 36，`minSdk 26` 仍是安装兼容声明。系统服务直接取得独立系统进程中的 `VaultRepository`，不依赖 RN 进程存活。合成 fixture 可以验证调用链、RN 进程死亡和拒绝逻辑，但真实 Chrome package/certificate、真实 WebView/原生目标和系统 UI 仍必须由个人设备验收。当前证据见 [最终功能测评](final-functional-assessment.md)。

## 平台分工

- API 26–33：`AutofillService`。
- API 30+：Autofill inline suggestions，能力可用时启用。
- API 34+：继续保留 Autofill，同时实现 `CredentialProviderService` 密码 credential。
- v1 不实现 passkey、Accessibility Service、悬浮窗或自动提交。

## 匹配

Web 表单按规范化 HTTPS origin 匹配；原生 App 按 package name + signing certificate SHA-256 匹配 `androidAssociations`。证书变化、相似域名、HTTP、跨域 iframe 或缺少关联时默认不返回秘密。v1 不允许“忽略关联并选择其他条目”，以免绕过 origin/package 绑定。

Web 表单还要求调用浏览器或 WebView 的 package + signing certificate 位于生成资源 `zero_vault_privileged_callers.json`。该资源由 `ZERO_VAULT_ANDROID_PRIVILEGED_CALLERS_JSON` 在 prebuild 时生成；环境变量未提供时默认空 allowlist，所有 Web Autofill/Credential origin 都 fail closed，release/publish 脚本还会拒绝空 `apps`。正式 allowlist 必须由发布负责人核验真实受支持浏览器的 release package 与证书 SHA-256 后注入，并作为当前 APK 证据归档；`release.env.example` 的 `com.example.browser` 和全零证书只是格式占位，绝不是可发布值。不得猜测、复制测试证书或把 `userdebug` 证书当 release 证书。

当前源码已经移除 Google Play 受限的 `QUERY_ALL_PACKAGES`，改用 manifest
中的 `MAIN + LAUNCHER` intent query，只让用户可启动 App 对选择器和签名验证可见。
这与选择器本身“只枚举可启动 App”的功能边界一致。Credential Provider 直接使用系统
提供的 `CallingAppInfo.signingInfo`；Autofill 对无法通过最小可见性读取当前单一签名的目标
直接 fail closed，不扩大包清单权限。发布构建必须检查合并 manifest，并在 API 36 覆盖
Chrome、WebView、合成原生 fixture 和不可见/无 launcher package 的拒绝路径。

当前源码在登录条目编辑器提供“从已安装 App 选择”：

1. 原生层只枚举具有 launcher 入口、启用且导出的 App，排除 Zero Vault 自身并按 package 去重。
2. 原生层读取当前 APK signer；只有恰好一个 signer 时才计算 SHA-256。多 signer、无法读取 signer 或非法 package 按 fail closed 排除。
3. 不安全、含控制/双向文本字符或过长的 label 不直接展示，回退为 package name。
4. TypeScript bridge 对返回对象的键、数量、label、package 格式、重复 package 和 64 位大写十六进制摘要再次校验。
5. 用户选择后，编辑器自动写入 package name 与 signing certificate SHA-256，并合并同 package 的重复关联；保存时仍通过共享 schema 校验。

这个选择器降低手工录入错误，但不改变匹配规则，也不授予静默填充。手动录入仍保留给无法枚举的受控场景，发布签名证书必须由所有者核对。选择器使用当前 signer，不代表未来证书轮换自动受信任；签名变化后必须重新关联。API 36 自动化不能替代真实 App 选择、证书轮换或多 signer 真机验收。

API 26–27 的 `AssistStructure.ViewNode` 没有可验证的 `webScheme`，当前实现不会把仅有 `webDomain` 当成 HTTPS。因此 API 26–27 的浏览器/WebView Web 填充按设计 fail closed；这两个 API 仍可对精确 package + certificate 关联的原生 App 填充。API 28+ 才能在 trusted privileged caller 条件下接受明确 `https` 的 Web origin。

## Autofill 流程

1. Service 解析 `AssistStructure`，只提取必要字段和 Web domain，不记录表单值。
2. Repository 在锁定态仅返回 authentication dataset。
3. 用户通过系统认证 UI 解锁，Repository 创建短期 fill token。当前 native authentication Activity 只接受已启用的强生物识别；未启用或不可用时 fail closed。用户仍可先打开主 App，用主密码完成 OPAQUE 授权并解锁，再返回填充表单，但 v1 不从系统 surface 静默启动 RN 或收集主密码。
4. 再次验证当前 package/origin/signature 和字段仍有效。
5. 只把选中条目的 username/password 写入 `Dataset`，不自动提交。

## Credential Provider 流程

`onBeginGetCredential` 只处理 password option。候选元数据不能包含密码；选择 entry 后通过 PendingIntent 进行强生物识别和最终匹配，再返回 `PasswordCredential`。系统取消、超时、未配置生物识别或锁定解锁失败均返回无凭据，不静默打开 RN Activity。

## 验证矩阵

覆盖 Chrome、WebView、至少两个原生 App、多个账号、相似域名、签名变化、用户取消、进程死亡、锁定和无网络，并只在当前最新版 API 36 执行。Web 用例同时覆盖 allowlist 缺失、错误证书和正确证书。原生 App 用例还须覆盖选择器自动关联、重复选择、无法读取 signer、多 signer、卸载/重装、证书变化和手工录入错误。每个用例验证不泄漏、不自动提交、只在明确用户动作后填充。

候选回归必须同时保存合成 Autofill、Credential Provider、RN 进程死亡和拒绝分支的当前 fingerprint 证据。即使这些自动化全绿，也不能代表真实 Chrome allowlist、WebView/第二应用、证书变化和厂商系统选择器已经验收；个人真机 Chrome package/cert 始终是外部输入。

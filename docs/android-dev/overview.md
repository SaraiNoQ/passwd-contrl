# Android 开发总览

Last updated: 2026-07-27

Zero Vault Android 位于 `apps/mobile`，采用 **React Native / Expo UI + Kotlin 原生层 + Rust crypto-core**。最低支持 Android 8（API 26），包名为 `com.zerovault.mobile`。所有 Android 编译、测试、模拟器和产物验证只在 `campus-server` 的 `zero-vault-android-dev` 容器中执行；本机只用于编辑、审查和调用远程包装命令。

## 两个不同的终点

| 终点 | 含义 | 当前状态 |
| --- | --- | --- |
| A. 个人签名 APK | 设备所有者侧载、以同一长期签名密钥升级的完整个人客户端。 | v18 是最后签名基线，v19 是当前候选；clear-state 灾难恢复和强化双 AVD 核心流程已通过，最终指纹 instrumented 与 v19 构建待执行。 |
| B. Google Play 正式版本 | A 的能力与证据，加上 AAB、Play App Signing、政策、Console 和商店发布。 | 仓库内基础已开始：隔离 AAB/upload-key 流水线与公开账户删除路由已有源码；尚未生成 Play AAB、公开部署或进入 Console。 |

## 证据口径

“源码存在”“release 曾构建”“历史版本运行通过”和“当前源码运行通过”是不同结论。只有与待交付源码 fingerprint 匹配、成功同步、`stale=false`、退出码为 0 且报告 scope 覆盖目标旅程的远程产物，才能关闭运行门禁。`git diff --check`、静态审查、单元测试或包管理器升级都不能替代该证据。

当前 8-bit-inspired UI 已取得 API 36 编译、安装和编辑页黄金路径证据。`20260730T124911Z-e2e-local-91529-15360` 已通过 clear-state 服务端恢复、原密文解密、密码/恢复码轮换和旧密码拒绝；`20260730T125747Z-e2e-multidevice-api36-94573-25141` 已通过两个 API 36 AVD 的审批、密钥分发、双向同步、四种冲突动作、跨设备删除、撤销和恢复后旧设备失效。历史单设备运行还覆盖离线进程重启、强生物识别和 RN 进程死亡后的 Autofill/Credential Provider。上述范围仍不能外推为全路由视觉、真实 Chrome Autofill 或真机验收。

## 已验证制品与当前候选

| 项目 | 已验证事实 | 不代表 |
| --- | --- | --- |
| personal release | `20260727T013910Z-personal-release-66953-12503`，`versionName=0.1.1`、`versionCode=18` | 多设备、真实 Chrome Autofill 或真机流程已经通过。 |
| APK 完整性 | SHA-256 `a9935482e673b54c5c644b8d9667cc73bce802a227b7a1253b68cab66005bc51`；签名证书与 v17 不变 | Play App Signing、真机业务、Chrome 或无障碍已验收。 |
| v18 个人签名 APK | `20260727T013910Z-personal-release-66953-12503`，`0.1.1 / versionCode 18` | v18 SBOM 错误记录为 0.1.0；该问题已在 v19 候选生成门禁中修复，不能覆盖重打 v18。 |
| API 36 文件夹/协议 UI | `20260726T134540Z-e2e-editor-layout-10871-15186` | 只证明编辑器文件夹新建/选择、首页分组和网站协议选择局部旅程，不代表完整核心 E2E 或全路由 UI。 |
| API 36 核心 E2E | `20260725T195920Z-e2e-local-49500-27630`：productionClient、offlineProcessRestart、biometricStrongEnrollment、autofillAfterRnProcessDeath、credentialProviderAfterRnProcessDeath 均通过 | 真实 Chrome、第二台设备或物理设备行为已经通过。 |
| 当前候选静态/协议 | `20260726T204634Z-typecheck-52354-18464`、`20260726T204714Z-test-53041-11571` | typecheck 与完整测试通过，包含 OPAQUE Rust↔Serenity；不代表 Android 系统 UI 或真机。 |
| 当前候选原生门禁 | `20260726T204816Z-instrumented-api36-53738-32409` | API 36 instrumented 28/28；不代表真实设备 Keystore/生物识别。 |
| 当前候选双设备 | `20260730T125747Z-e2e-multidevice-api36-94573-25141` | 两个独立 API 36 AVD 的审批、key packet、双向同步、四种冲突、跨设备删除、撤销、恢复替换设备及旧设备失效通过。 |
| 当前候选灾难恢复 | `20260730T124911Z-e2e-local-91529-15360` | clear-state 服务端重建、密码/恢复码轮换、旧密码拒绝及原密文解密通过。 |
| 覆盖升级 | `20260727T014404Z-upgrade-check-api36-67982-14403`，API 36 v17→v18 同签名升级 | 真实用户数据上的全部业务状态已经逐项验收。 |

v18 是可追溯的**个人 APK 构建基线**。当前 `0.1.2 / versionCode 19` 候选已取得 clear-state 灾难恢复和强化双 AVD 核心证据，但最终源码指纹的 instrumented、聚合业务 E2E、签名 APK 与 v18→v19 覆盖升级仍须在冻结后执行。因此不能把候选源码结果写成 v18 制品证据，也不能提前声称 v19 已完成。

## 当前源码与待验证能力

源码包含 Rust/UniFFI、Kotlin Repository/Room/Keystore、OPAQUE 接线、设备绑定会话、三类 vault 条目、同步/恢复/备份、AutofillService、Credential Provider，以及中文/英文、三主题和新的 8-bit-inspired UI。该清单说明实现范围，不是运行通过声明。

Google Play 的仓库内基础也已建立：`mobile:remote:build:play` 使用独立
upload keystore、固定 bundletool、隔离签名容器，并验证 AAB 签名、生产 API、
调用方 allowlist、ABI/16 KiB、权限、SBOM、mapping 与 native symbols；Web
提供 `/account-deletion` 删除入口。该流水线尚未配置真实 Play upload key、
重建远程镜像或生成首个 AAB，网页也尚无公开部署证据，因此两项都只能记为
“源码完成、运行/外部验收待办”。

当前个人 APK 仍需完成：

- 为已经通过自动门禁的当前候选源码生成递增 `versionCode` 的个人签名 APK，并完成同 fingerprint 的制品校验与覆盖升级。
- 补齐尚未由当前候选运行覆盖的全历史、长时间运行/压缩和错误/取消分支；不得用双设备或恢复专项结果代替未覆盖旅程。
- 真实文件选择器/分享面板、备份导入导出、账户删除、大备份和长期压缩/内存边界。
- Chrome、WebView、至少一个原生 App 的 Autofill/Credential 正向与负向矩阵；真实 Chrome 关联不能用模拟器证书代替。
- 当前 UI 的中文/英文、浅色/深色/跟随系统、动态字体、TalkBack、小屏、旋转、键盘、冷启动和 8-bit 视觉验收。
- 设备所有者的真机首装/同签名升级、真实 API、Keystore/生物识别和校验和确认；个人 keystore 的校园服务器外加密备份。

`minSdk 26` 是安装兼容声明；自动化和 instrumented 测试只运行最新版 API 36。

## 当前 8-bit UI 范围

当前源码把像素标记、rail/signal/status block、2dp 边框、无模糊硬偏移投影、紧凑圆角和 4/8dp 节奏引入登录、注册、列表、详情、编辑器及导航等界面。它是“8-bit-inspired”的品牌语法，不是低分辨率游戏 UI：正文仍须可读，机器值使用等宽字体，功能图标使用 Expo Symbols，Android 系统界面保持原生外观。

这些新改动已通过 API 36 的编辑页局部黄金路径，但仍不得声称其在所有路由、三主题、双语、动态字体或辅助功能下正确；详见 [UI、国际化与主题](ui-i18n-theme.md)。

## 文档地图

- [架构与数据流](architecture.md)
- [远程开发](remote-development.md)
- [Native Bridge](native-bridge.md)
- [数据、认证与同步](data-auth-sync.md)
- [Android 平台安全](android-platform.md)
- [Autofill 与 Credential Provider](autofill-credential-provider.md)
- [功能对齐与 UI](feature-parity-ui.md)
- [UI、国际化与主题](ui-i18n-theme.md)
- [安全模型](security.md)
- [实施阶段](development-phases.md)
- [个人分发客户端实施计划](production-client-plan.md)
- [质量与个人分发](quality-release.md)
- [个人 APK 安装与升级](personal-installation.md)

跨端协议以 `docs/security-model.md`、`docs/sync-protocol.md`、`docs/device-trust.md` 和 `packages/shared` schema 为准。本页仅描述 Android 的实现边界和证据状态。

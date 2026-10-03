# Android 质量、个人分发与商店发布

Last updated: 2026-07-27

当前交付物是个人签名 APK；Google Play/AAB 是后续独立发布轨道。`0.1.1 / versionCode 18` 是最后已验证的签名构建，`0.1.2 / versionCode 19` 是当前候选。2026-07-30 已通过 clear-state 灾难恢复和强化双 AVD E2E；最终源码指纹的 API 36 instrumented、聚合业务 E2E、新 APK 与覆盖升级仍待执行。不得把源码验证延伸为 v18 制品、全路由、真实 Chrome、物理设备或 Play 通过。

## 证据判定规则

一次远程运行只有同时满足以下条件才有效：

1. 命令通过 `pnpm mobile:remote:*` 发起，并在执行前成功 rsync 到 `/root/dev/zero-vault`。
2. `sync.txt` 记录 commit、dirty、fingerprint 和同步时间，且 fingerprint 与被审查源码一致。
3. `exit-code.txt` 为 `0`，`stale.txt` 为 `stale=false`；预期 fail-closed 只能证明对应拒绝分支。
4. 命令、容器镜像、运行前后业务容器状态、日志、报告和 `SHA256SUMS` 完整可核验。
5. APK/AAB、instrumented、Maestro 或专项报告必须与命令 scope 一致；局部切片不得升级为整条旅程通过。
6. 源码在同步后变化时必须重跑；不得继续使用远端旧副本。

Android 工具链、typecheck、测试、Gradle、Rust Android target、模拟器和 Maestro 均只在 `campus-server` 容器执行。当前仅测试最新版 API 36；`minSdk 26` 只是兼容声明。

## v18 制品基线与 v19 候选源码证据

| 项目 | 当前证据 | 结论 |
| --- | --- | --- |
| 个人 release | `20260727T013910Z-personal-release-66953-12503` | v18 personal APK 构建基线；不是 v19、多设备或真机证据。 |
| 版本 | `applicationId=com.zerovault.mobile`、`versionName=0.1.0`、`versionCode=17` | 与 v16 使用同一长期个人签名证书。 |
| APK | SHA-256 `d57a8f48116d1fd92b439880677e22a70937e21bf661243e5d5bb1fdc6da9d50` | 已验证的制品摘要。 |
| 签名 | 证书 SHA-256 `6D9A1E53CD8F86D5F85EB49FC7C73972BC4398B8AED43F57ED010CEECDA8335D` | v2/v3、单 signer；不是 Play App Signing 证据。 |
| API 36 UI | `20260726T134540Z-e2e-editor-layout-10871-15186` | 文件夹新建/已有选择、首页分组和网站协议选择局部旅程通过；不代表完整核心 E2E 或全路由。 |
| API 36 静态/完整测试 | `20260726T204634Z-typecheck-52354-18464`、`20260726T204714Z-test-53041-11571` | typecheck 和 full test 通过；full test 包含 OPAQUE Rust↔Serenity 互操作。 |
| API 36 核心 E2E | `20260725T195920Z-e2e-local-49500-27630` | productionClient、offlineProcessRestart、biometricStrongEnrollment、autofillAfterRnProcessDeath、credentialProviderAfterRnProcessDeath 通过；不替代多设备、真实 Chrome 或真机。 |
| API 36 instrumented | `20260726T204816Z-instrumented-api36-53738-32409` | 当前候选 28/28；覆盖 Room、Keystore、Rust、SAF 备份与跨进程会话代际，不替代真机。 |
| API 36 双设备 E2E | `20260730T125747Z-e2e-multidevice-api36-94573-25141` | pending、审批、key packet、双向同步、四种冲突、跨设备删除、撤销、replacement recovery 和旧设备失效通过。 |
| v18 个人签名 APK | `20260727T013910Z-personal-release-66953-12503` | `0.1.1 / versionCode 18`；历史 SBOM 错记为 0.1.0，v19 流水线已增加版本一致性拒绝门禁。 |
| API 36 覆盖升级 | `20260727T014404Z-upgrade-check-api36-67982-14403` | v17→v18 同签名包管理器覆盖升级通过。 |
| clear-state 灾难恢复 | `20260730T124911Z-e2e-local-91529-15360` | 服务端重建、原密文解密、密码/恢复码轮换和旧密码拒绝通过。 |
| 强化双设备 | `20260730T125747Z-e2e-multidevice-api36-94573-25141` | 审批、同步、冲突、跨设备删除、撤销、恢复替换设备及旧设备失效通过。 |

v17→v18 已通过包管理器覆盖安装，但该检查不等同于在真实用户数据上逐项验证 Room、Keystore、离线解锁与业务状态。当前候选源码的新自动化结果尚未绑定到递增版本的个人 APK，也不证明全路由 UI、真实 Chrome Autofill 或物理设备行为。

## 当前未关闭的个人 APK 门禁

| 门禁 | 状态 | 必须取得的证据 |
| --- | --- | --- |
| native 调用链 | 当前候选 API 36 instrumented 28/28 通过 | 物理设备 Keystore/生物识别仍归真机门禁。 |
| 注册/登录/恢复 | clear-state 服务端重建通过 | 继续验证真实服务环境、全设备丢失真机演练及长期/错误分支。 |
| 单设备核心功能 | 当前 API 36 productionClient 与离线进程重启通过 | 继续覆盖全历史、四种冲突动作、错误/取消分支和真机持久化。 |
| 多设备 | 当前候选自动验证通过 | 两个独立 API 36 AVD 已完成审批、vault-key packet、双向同步、四种冲突动作和撤销；物理设备仍待验收。 |
| 本地/云备份 | 本地 SAF codec/stage 已通过 API 36 instrumented；云备份边界不变 | 仍需用真实系统选择器验证导出/取消/Activity 销毁和完整恢复旅程；大备份、长期压缩和内存边界仍开放。JS 只见 `operationId`/公开元数据，Repository/Rust AEAD 仍整包处理，不能视为流式加密。 |
| Autofill/Credential | 当前 API 36 已通过 RN 进程死亡后的合成目标旅程 | 真实 Chrome/WebView/第二 App、锁定认证、相似域名、签名变化、取消和无网络。 |
| UI/i18n/theme/8-bit | 当前编辑页局部验证 | 中文/英文 × 浅色/深色/跟随系统的全路由 API 36 巡检，动态字体、TalkBack、小屏、旋转、键盘、状态反馈和冷启动仍待完成。 |
| 真机 | 外部待办 | 首次安装、同签名覆盖升级、真实 API、Chrome cert、Keystore/StrongBox、生物信息变化和系统服务。 |
| 长期签名密钥 | 服务器上可构建，外部备份待办 | keystore、alias/password 与证书摘要在校园服务器之外的用户指定加密备份。 |
| 旧 Web vault | 外部前置 | 在 Web 显式迁移 `webcrypto-mvp` 到 `crypto-core`；Android 继续 fail closed。 |
| 候选 APK | 当前源码自动门禁已取得新证据，最后签名制品仍为 v18 | 生成 v19、完成制品检查和同签名覆盖升级后再更新交付基线。 |

## 远程执行顺序

依赖或 native 配置变化后先运行 `bootstrap`。功能开发收口时按受影响范围执行，避免用大量无关测试阻塞迭代；最终候选仍必须补齐完整核心门禁。

```sh
pnpm mobile:remote:bootstrap
pnpm mobile:remote:doctor
pnpm mobile:remote:typecheck
pnpm mobile:remote:test:targeted
pnpm mobile:remote:instrumented
pnpm mobile:remote:e2e:local
pnpm mobile:remote:e2e:multidevice
pnpm mobile:remote:build:personal
pnpm mobile:remote:artifacts <personal-release-run-id>
pnpm mobile:remote:upgrade-check <old-personal-run-id> <new-personal-run-id>
```

任何修复改变 fingerprint 后，从最早受影响门禁重跑。个人 APK 的最终 run id、SHA-256、证书摘要、版本号和安装说明必须成套交付。

## API 36 测试矩阵

| 层级 | 最小覆盖 | 证据边界 |
| --- | --- | --- |
| 静态/单元 | mobile/shared/Worker/Web、Rust/UniFFI、OPAQUE、主题/i18n/session | 不能替代 Android 运行。 |
| Instrumented | Room fresh/1→2、Keystore、生物识别、process death、background lock、backup、system services | 必须是当前 fingerprint。 |
| 单设备 E2E | 注册/登录、恢复码、CRUD、生成器/TOTP、搜索、历史、离线重启、恢复、账户删除 | 固定摘要、合成数据；失败也不得保存秘密。 |
| 多设备 E2E | pending/审批、key packet、push/pull、冲突、撤销 | 必须是两个独立数据目录/设备，不能数据库注入伪造。 |
| 系统填充 | Chrome、WebView、原生 App、锁定认证和负向矩阵 | 合成 fixture 只算切片。 |
| UI/8-bit | 全路由、中英双语、三主题、动态字体、TalkBack、小屏/旋转、图标/splash | 当前仅编辑页黄金路径有匹配运行证据。 |
| 个人 APK | R8、签名、双 ABI、16 KiB、SBOM、敏感字符串、API/allowlist 嵌入、覆盖升级 | 包管理器升级不等于业务升级。 |
| 真机 | 首装/升级、Chrome、生物识别、Keystore、分享/文件选择器 | 由设备所有者签收。 |

## 8-bit UI 验收

8-bit 只是一套视觉语言，不得损害可读性和无障碍：

- 2dp 边框、无模糊硬偏移阴影、像素 rail/signal/status block、紧凑圆角和 4/8dp 网格保持一致。
- 霞鹜文楷用于可读正文；等宽字体只用于指纹/恢复码等机器值，不强制像素字体。
- 功能图标使用 Expo Symbols；装饰像素块 `accessible={false}`，不能承载唯一含义。
- 所有颜色来自语义 palette；浅色、深色、跟随系统均有足够对比度，状态不能只靠颜色。
- 触控目标至少 48dp，并覆盖 pressed/focused/disabled/loading/success/error。
- 登录、注册、列表、详情、编辑器、设置、恢复、冲突、备份和系统入口逐页验收；Android 系统 UI 保持原生。

截图只能使用合成数据，不得归档真实恢复码或凭据。

## 个人签名与安装

长期 personal keystore 已用于 v18，签名证书与 v17 不变。构建容器只读挂载 `/root/dev/zero-vault-android-secrets`；仓库只保存 secret 契约，不保存 keystore 或密码。

debug 与 personal APK 签名不同，不能覆盖安装。卸载 debug 会清除 Room 和 Keystore，因此切换前必须验证恢复码或保留另一台可信设备。后续 personal APK 必须持续使用同一 key 且递增 `versionCode`。

当前仍需：

- 从个人设备取得真实 Chrome package/cert 并更新 allowlist。
- 把 keystore 和解锁材料备份到校园服务器之外。
- 在个人设备核对 APK SHA-256 后首次安装，并完成至少一次同签名覆盖升级和恢复演练。

## Google Play 独立门禁

个人 APK 的通过不等于可上架。正式商店版本至少需要：

| 项目 | 仓库内可完成 | 外部输入/阻塞 |
| --- | --- | --- |
| AAB 与签名 | `mobile:remote:build:play`、独立 upload-key、隔离签名及 bundletool/版本/16 KiB/ABI/权限/生产配置/SBOM 校验已有源码，尚未用真实凭据运行 | 独立 upload keystore、Play App Signing、Console app、upload 授权。官方参考：[发布](https://developer.android.com/studio/publish/)、[签名](https://developer.android.com/studio/publish/app-signing)。 |
| Android 技术要求 | 当前 `targetSdk 36`；AAB 独立验证 16 KiB、ABI、权限和包可见性 | 提交时核对最新政策。2026-08-31 target API 36 要求：[目标 API](https://support.google.com/googleplay/android-developer/answer/11926878)、[通用要求](https://support.google.com/googleplay/android-developer/answer/16561298)；16 KiB：[官方说明](https://developer.android.com/guide/practices/page-sizes)。 |
| 账户删除 | App 内删除流程及 Web `/account-deletion` 路由已有源码；服务端要求 5 分钟内由 Worker 创建的 OPAQUE 会话，且只有服务端明确成功后才清本地数据 | 公开 HTTPS 部署、端到端删除证据及 Console URL。要求见 [账户删除](https://support.google.com/googleplay/android-developer/answer/13327111)。 |
| 隐私与数据 | 已新增版本化源码事实清单 [`play-data-safety.v1.yaml`](play-data-safety.v1.yaml)，明确区分已见源码事实与 `open_questions`；它不是已提交表单或法律审核 | 生产服务商/日志审计、保留期、发布者和隐私联系信息、公开隐私政策 URL、Play Data safety 表单及法律/发布者确认。参考：[Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)、[隐私政策](https://support.google.com/googleplay/android-developer/answer/9859455)。 |
| 审核访问 | 已新增无真实凭据的英文模板 [`play-reviewer-instructions.en.md`](play-reviewer-instructions.en.md)，覆盖注册、CRUD/同步、双设备、Autofill、删除和恢复 | 替换全部占位符，提供公开可达、可重置的合成审核环境，并用提交 AAB 实测；凭据只放 Play Console 受保护字段。参考：[App access](https://support.google.com/googleplay/android-developer/answer/15748846)。 |
| 商店内容 | listing 文案、图标、feature graphic、截图、内容分级资料 | 开发者/支持身份和联系信息。 |
| 生产访问 | 测试轨道、pre-launch report、崩溃/ANR 监控 | 对适用的新个人账号，12 名测试者连续 14 天。参考：[生产访问要求](https://support.google.com/googleplay/android-developer/answer/14151465)。 |

当前 Android manifest 已移除 `QUERY_ALL_PACKAGES`，仅用 `MAIN + LAUNCHER` intent query 发现可启动 App；Autofill 在无法读取目标签名时 fail closed。每个发布候选都必须检查合并后的 manifest，确认传递依赖未重新引入受限权限，并按提交时政策复核包可见性。参考：[包可见性政策](https://support.google.com/googleplay/android-developer/answer/10158779)。

首次 Play 构建前须在服务器创建与 personal key 不同的
`/root/dev/zero-vault-play-secrets/upload.keystore` 和 mode 400/600 的
`release.env`，随后重跑 `mobile:remote:bootstrap` 固化 signer/bundletool，
再执行 `pnpm mobile:remote:build:play`。没有 `play-aab` run id、
`stale=false`、`exit-code=0` 和下载后双重 SHA-256 校验时，不得声称 AAB
已生成或可上传。

## 回滚

Android 默认不允许安装较低 `versionCode`，且回退 Room schema 可能破坏数据。个人分发回滚原则是“同一签名、提高 versionCode、从已审查源码重新构建修复版”，而不是安装旧 APK。

紧急情况下先锁定会话、停止传播候选、保留加密备份和证据，再发布更高 `versionCode` 的修复 APK。Play 轨道还需独立设计 staged rollout、halt、previous release 和数据迁移回滚流程。

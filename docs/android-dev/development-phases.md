# Android 实施阶段

Last updated: 2026-07-27

本文把两个不同目标分开管理：

- **目标 A：核心功能完整的个人 APK**。只在自己的设备侧载和同签名覆盖升级，是当前开发目标。
- **目标 B：正式 Google Play 上架**。需要 AAB、Play Console、公开政策材料和商店审核，是后续独立目标，不能反向阻塞目标 A。

“源码已实现”“release 能编译”“历史运行通过”和“当前运行通过”是四种不同状态。只有与待验证源码 fingerprint 匹配、`stale=false`、退出码 0 的远程证据才能关闭对应运行门禁。v18 是最后已验证的个人 APK 构建基线；2026-07-30 已取得 clear-state 灾难恢复和强化双设备证据，最终源码指纹的 instrumented、单设备聚合旅程和 v19 个人 APK 仍须在源码冻结后执行。真机证据仍属于外部验收。

## 当前进度

| 阶段 | 当前状态 | 证据与剩余工作 |
| --- | --- | --- |
| 1. 远程基础设施与文档 | 已完成 | Docker、rsync、防旧副本、指纹、日志和产物下载流程已建立；所有 Android 命令继续只在 `campus-server` 执行。 |
| 2. Expo 52→57 | 已完成 | Expo 57、React Native 0.86、JDK 17、SDK 36、NDK r27b 已进入远程环境。 |
| 3. 原生安全基础 | 自动回归通过，真机待验 | Rust/UniFFI/Kotlin/Room/Keystore 已进入 APK 调用链；`20260726T204816Z-instrumented-api36-53738-32409` 通过 28/28，完整测试还验证了 Rust↔Serenity OPAQUE 互操作。Recovery bootstrap 授权修复后的新增 native 回归仍须在最终候选上再跑一次；真实设备 Keystore/生物识别属于所有者验收。 |
| 4. 设备信任与只读同步 | 自动回归通过，真机待验 | `20260726T201932Z-e2e-multidevice-api36-51221-32507` 在两台独立 API 36 AVD 完成 pending→审批→vault-key packet→不同设备指纹→双向同步→四种冲突动作→撤销；真实设备生物识别仍须验收。 |
| 5. 核心 Vault | 已实现，最终聚合回归待跑 | 三类条目 CRUD、搜索、生成器、TOTP、离线队列、双向同步、历史和四种冲突动作已有源码；完整测试和双设备流程已通过。源码冻结后仍须运行一次单设备聚合黄金路径，确保各独立切片组合后无回归。 |
| 6. 管理与恢复 | clear-state 灾难恢复已通过 | `20260730T124911Z-e2e-local-91529-15360` 通过服务端重建 replacement device、密码/恢复码轮换、旧密码拒绝和原密文解密；强化双设备运行还证明恢复后旧批准设备失效。设备管理、历史、密码健康、账户删除、密文云备份、本地密文导出/恢复和 Web 加密包导入已有源码。真实文件选择器闭环及 52 MiB 整文件 JS 解析的内存风险未关闭。 |
| 7. 系统填充 | 部分验证 | Autofill 与 Credential Provider 的合成正向切片有历史证据；真实 Chrome、WebView、第二 App、签名变化、取消、锁定和负向矩阵未完成。 |
| 8. 个人 APK | v18 基线已验证，v19 候选待构建 | v18 个人 APK 与 API 36 v17→v18 同签名覆盖安装通过。真机首次安装/覆盖升级、真实 API/Chrome、服务器外 keystore 备份和 v19 完整黄金路径仍开放。 |
| 9. Play 上架 | 仓库内基础已开始，非当前目标 | 隔离 AAB/upload-key 流水线与 Web `/account-deletion` 已有源码但未运行/部署；Play App Signing、Console、隐私政策/Data safety、商店素材、审核访问、测试轨道和生产访问条件仍未完成。 |

## 当前可交付构建基线

- 个人 release：`20260727T013910Z-personal-release-66953-12503`（v18）
- `applicationId=com.zerovault.mobile`
- `versionName=0.1.0`
- `versionCode=17`
- APK SHA-256：`d57a8f48116d1fd92b439880677e22a70937e21bf661243e5d5bb1fdc6da9d50`
- 签名证书 SHA-256：`6D9A1E53CD8F86D5F85EB49FC7C73972BC4398B8AED43F57ED010CEECDA8335D`
- 证据状态：`stale=false`、退出码 0；签名 v2/v3、单 signer、API URL exact-once、embedded caller resource、SBOM、敏感字符串和 48 个 ELF 的 16 KiB 检查通过。

`20260727T014404Z-upgrade-check-api36-67982-14403` 在 API 36 上完成 v17→v18 同签名覆盖安装。它只证明包管理器兼容性，不证明 Room 数据、Keystore、生物识别、会话或业务状态在升级后仍可用。

v18 构建后的候选证据包括：`20260730T124911Z-e2e-local-91529-15360` 通过 clear-state 服务端灾难恢复；`20260730T125747Z-e2e-multidevice-api36-94573-25141` 通过强化双设备流程。两次运行均为 `stale=false`、退出码 0。最终个人 APK 前仍要在冻结源码上重跑 native instrumented 与单设备聚合旅程。

## 目标 A：个人 APK 收口顺序

1. 冻结本轮核心功能和 8-bit-inspired UI 范围，不再用非必要扩展打断黄金路径收口。
2. 在候选源码冻结后重跑 API 36 instrumented，覆盖 Recovery bootstrap 只能向预登记 replacement device 分发 vault key 的回归。
3. 运行单设备聚合黄金路径：注册/登录、恢复码、解锁、三类 CRUD、搜索、生成器/TOTP、离线 mutation、进程重启、恢复、同步错误可见性。
4. 保持已经通过的双设备 pending→审批→vault-key packet→解锁→双向同步→四种冲突动作→撤销脚本，涉及设备协议时再重跑。
5. 跑通真实文件选择器导出/导入/恢复；把 52 MiB 整文件读入 JS 的峰值内存风险改为 native 流式处理，或降低并明确经目标设备验证的上限。
6. 跑通 Autofill/Credential Provider 的真实浏览器/原生 App 黄金路径和负向矩阵。
7. 在 API 36 完成中文/英文、浅色/深色/跟随系统、8-bit UI、动态字体、TalkBack、小屏和旋转验收。
8. 由设备所有者完成真机首次安装、同签名覆盖升级、真实生物识别/Keystore、Chrome package/cert 和实际 API 可达性验收。
9. 将长期个人 keystore、alias/password 和证书摘要备份到校园服务器之外的用户指定加密位置。

## 8-bit UI 实施与验收

当前主流程已经出现像素标记、状态块、2dp 边框、无模糊硬投影和紧凑圆角，但它仍是**屏幕级部分实现**，不是统一完成的设计系统。

后续实现遵守：

- 采用 “8-bit-inspired” 而非强制低分辨率字体；正文继续使用霞鹜文楷，指纹/恢复码等机器值才使用等宽字体。
- 使用 4/8dp 网格、2dp 清晰边框、无 blur 的硬偏移阴影、方形/小圆角容器、像素 rail/signal/status block。
- 所有功能图标继续使用 Expo Symbols；像素块只作装饰并从无障碍树隐藏，不能替代标签。
- 颜色必须来自语义 palette，并同时覆盖浅色、深色、跟随系统；状态不能只靠颜色表达。
- 触控目标至少 48dp；pressed、focused、disabled、loading、success 和 error 都有可见且本地化的状态。
- 登录/注册、列表、详情、编辑器、设置、恢复、冲突、备份和系统入口保持同一视觉语法；Android 系统拥有的界面继续保持原生外观。

验收至少包含 API 36 下中英文 × 浅色/深色/跟随系统、动态字体、TalkBack、小屏/旋转、键盘遮挡、错误态和 loading 态截图/语义检查。当前 8-bit UI 只有文件夹/协议编辑与首页分组局部旅程取得匹配证据，其余路由和组合继续保持 pending。

## 目标 B：正式 Google Play 上架

以下是个人 APK 完成后的独立阶段：

1. 仓库已实现 `mobile:remote:build:play`、独立 upload-key 与隔离签名验证；仍须提供真实 Play key、重建远程镜像并取得首个成功 `play-aab` 证据。Android 官方说明新应用通过 Android App Bundle 发布并使用 Play App Signing：[发布准备](https://developer.android.com/studio/publish/)、[应用签名](https://developer.android.com/studio/publish/app-signing)。
2. 当前已 `targetSdk 36`；提交时仍须重新核对 Play 要求。Google 已公布从 2026-08-31 起新应用和更新需 target API 36：[目标 API 要求](https://support.google.com/googleplay/android-developer/answer/11926878)、[通用要求](https://support.google.com/googleplay/android-developer/answer/16561298)。
3. 当前 release 的 16 KiB ELF 检查已通过，但商店 AAB 仍须独立验证。target 35+ 的 16 KiB page-size 要求见 [Android 官方说明](https://developer.android.com/guide/practices/page-sizes)。
4. 当前 manifest 已移除 `QUERY_ALL_PACKAGES`，只查询 `MAIN + LAUNCHER` 可启动 App；发布门禁必须持续检查合并后的 manifest，并按 [包可见性政策](https://support.google.com/googleplay/android-developer/answer/10158779) 复核用途与可见范围。
5. Web `/account-deletion` 和 App 内删除已有源码；仍须公开部署并验证。另需建立公开隐私政策和 Data safety 声明：[账户删除](https://support.google.com/googleplay/android-developer/answer/13327111)、[Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)、[隐私政策](https://support.google.com/googleplay/android-developer/answer/9859455)。
6. 准备商店名称、说明、图标、feature graphic、截图、内容分级、目标受众、广告声明、支持联系方式，以及允许审核人员自助注册合成审核账号的可重置审核环境和英文操作说明：[App access](https://support.google.com/googleplay/android-developer/answer/15748846)。
7. 配置 Play Console、服务账号/上传授权、测试轨道、pre-launch report、崩溃/ANR 监控、分阶段发布和回滚。2023-11-13 后创建的个人开发者账号还需满足 12 名测试者连续 14 天的生产访问条件：[测试要求](https://support.google.com/googleplay/android-developer/answer/14151465)。

Play Console、公开网站、开发者账号、测试者、审核凭据和上传授权属于外部输入；AAB 生成、权限收敛、应用内删除、素材与自动化属于仓库内可完成工作。两类阻塞必须分别记录。

## Definition of Done

个人 APK 只有在核心黄金路径、受影响 native 门禁、API 36 UI/无障碍、真实设备首次安装与覆盖升级、真实浏览器关联、恢复演练和 keystore 外部备份全部完成后，才能称为“核心功能完整个人客户端”。

Play 版本只有在上述基础上再完成 AAB/Play 签名、政策材料、公开网页、审核访问、测试轨道和 Console 发布证据后，才能称为“正式商店版本”。两种 DoD 不得混用。

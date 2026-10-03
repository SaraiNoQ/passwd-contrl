# Android 客户端最终功能测评

Last updated: 2026-07-26

本文是 Zero Vault Android 个人签名 APK 的最终功能清单、证据索引和交付边界。它不以“有页面”或“能编译”代替功能通过，也不把 API 36 模拟器结果外推为真实手机、真实 Chrome 或 Google Play 验收。

## 判定口径

| 状态 | 含义 |
| --- | --- |
| 已实现 | 生产路径已有源码，不依赖测试加密替身或静默内存 fallback。 |
| 自动验证通过 | 与候选源码 fingerprint 匹配的 `campus-server` 运行以 `stale=false`、`exit-code=0` 结束，且报告覆盖该能力。 |
| 外部验收 | 需要项目所有者的真实设备、真实 API/浏览器证书、服务器外存储或第三方控制台，仓库自动化无法代替。 |
| 后续扩展 | 不属于当前个人 APK 核心完成定义，不阻塞侧载使用。 |

所有 Android、TypeScript、Rust Android、Gradle、模拟器和 Maestro 命令均在 `campus-server` 容器运行；本机仅编辑、同步、审查和下载制品。

## 功能测评矩阵

| 功能域 | 当前实现 | 候选自动化验收 |
| --- | --- | --- |
| 注册与登录 | Worker OPAQUE start/finish、Rust 客户端状态、设备绑定 bearer、等形错误和恢复后 auth epoch 已接线；生产路径 fail closed。 | typecheck/单元、单设备注册/普通登录/错误账号、恢复后登录。 |
| 设备信任 | 首台设备初始化、第二设备 pending、审批、vault-key packet、撤销及失效会话清理均已实现。 | 两个独立 API 36 AVD 完成 pending→审批→解锁→双向使用→撤销。 |
| Native 安全边界 | JS 只保存短期 vault session handle；vault key、设备私钥、OPAQUE 状态和 wrapping key留在 Rust/Kotlin/Keystore。 | Rust/UniFFI、Keystore、进程死亡、会话代际和备份排除 instrumented。 |
| 本地数据 | Room 保存密文条目、同步 cursor、pending mutation、冲突和元数据；v1/v2 schema JSON 与迁移链已纳入。 | fresh database、1→2 migration、重启和恢复后的数据读取。 |
| 三类条目 | 登录项、安全笔记、信用卡的创建、查看、修改和删除；登录项支持文件夹、HTTPS/HTTP、TOTP、Android App 关联和自定义字段。 | 单设备黄金路径覆盖三类 CRUD、协议选择、密码生成、TOTP 和删除。 |
| 文件夹与搜索 | 可选已有文件夹或输入新文件夹；首页按文件夹分组；搜索在解锁内存中执行。 | 文件夹新建/复用/分组、登录信息搜索和空结果。 |
| 历史 | 读取服务端版本历史，并把明确选择的历史版本写回本地同步队列。 | 登录项 revision 1→2→恢复 revision 1→重新同步。 |
| 同步与离线 | pull/push、幂等 mutation、待同步计数、用户可见成功/失败、离线队列、重启恢复和自动同步已实现。 | 单设备注入一次网络失败；离线修改、进程重启、重试和队列归零。 |
| 冲突 | 保留本地、采用云端、两者保留、稍后处理四种显式策略；不按时间戳静默覆盖。 | 双设备制造真实 revision 冲突并逐项确认最终值。 |
| Recovery v2 | 匿名恢复、旧恢复码失效、新密码/新恢复码、replacement device 和 auth epoch 轮换已实现。 | 单设备恢复后重新解锁、读取既有密文、删除条目和普通登录。 |
| 本地备份 | Android SAF 原生 stage/commit，JS 只持 operation id/公开元数据；导入前重新授权。 | codec/stage/取消/失效 operation instrumented；真实文件选择器由真机验收。 |
| 云备份 | 创建、列出、恢复和删除加密 Room 快照。 | 修改本地数据后恢复快照、重新解锁、确认恢复值并删除快照。 |
| 密码健康 | 在解锁内存中检查缺失、弱密码和重复密码，不上传密码或哈希。 | 生成的强密码进入本地分析且无风险提示。 |
| 账户管理 | 登出、设备列表/审批/撤销、恢复入口和终态账户删除。 | 黄金路径最后删除账户，再登录必须得到“邮箱未注册”。 |
| i18n | 默认中文、可切英文；业务文案走统一翻译层，用户数据不翻译。 | 中英切换、进程杀死后持久化，再恢复中文。 |
| 主题与视觉 | 默认浅色，浅色/深色/跟随系统三档；霞鹜文楷、Expo Symbols、启动动画和 8-bit-inspired 视觉已接入。 | 三档切换、深色跨进程持久化、恢复浅色；完整真机视觉/无障碍另行验收。 |
| AutofillService | API 26+ 服务、锁定认证 Activity、精确 Web origin 或 package+certificate 匹配，不依赖 RN 进程。 | API 36 合成 Web/App fixture、RN 进程死亡和负向匹配；真实 Chrome 另行验收。 |
| Credential Provider | API 34+ password-only provider、认证 entry 和同一 Repository 路径。 | API 36 合成目标在 RN 进程死亡后取凭据；真实系统选择器由真机验收。 |
| 个人 APK | release R8、长期个人签名、双 ABI、16 KiB、SBOM/字符串/manifest/生产配置检查。 | 候选 release 构建、SHA-256、签名证书、API 36 同签名覆盖升级。 |

## 候选回归证据

最终候选必须按以下顺序产生同一源码 fingerprint 的证据。任何功能修复都会使后续旧证据失效：

1. mobile/shared/Worker/Web typecheck。
2. 全工作区单元与协议测试，包括 Rust、OPAQUE 和备份/恢复负向用例。
3. API 36 instrumented：Room、Keystore、生物识别、进程死亡、系统服务和 SAF。
4. API 36 单设备完整黄金路径。
5. API 36 双设备审批、四种冲突和撤销。
6. 个人 release APK 的签名、R8、ABI、16 KiB、SBOM、manifest 和敏感字符串检查。
7. 上一版个人 APK 到候选版的同签名覆盖升级。

最终 run id、版本、APK SHA-256 和证书摘要在本轮回归及构建成功后写入本节和 [个人安装指南](personal-installation.md)。

当前源码已取得以下 `stale=false`、退出码 0 的独立证据：

- `20260726T204634Z-typecheck-52354-18464`：mobile/shared/Worker/Web typecheck。
- `20260726T204714Z-test-53041-11571`：mobile 80/80、shared 48/48、Worker 204/204、Web 188/188、Rust 18/18 与 29/29，并通过 Rust↔Serenity OPAQUE 互操作。
- `20260726T204816Z-instrumented-api36-53738-32409`：API 36 native 28/28。
- `20260730T125747Z-e2e-multidevice-api36-94573-25141`：两台独立 AVD 的审批、vault-key packet、双向同步、四种冲突、跨设备删除、撤销、恢复替换设备和旧设备失效。
- `20260730T124911Z-e2e-local-91529-15360`：Recovery v2 clear-state 服务端重建、替换设备密钥分发、密码/恢复码轮换、旧密码拒绝以及原密文解锁。

恢复旅程定位并修复了 Recovery bootstrap 无法向预登记 replacement device 分发 vault key 的真实缺陷，并新增 native 负向回归。升级后的 clear-state 灾难恢复与强化双设备流程已通过；最终冻结指纹仍须重跑 instrumented 和聚合 E2E，再生成 v19 个人 APK。

## 自动化完成后仍需所有者签收

以下项目不是可以通过继续编写模拟器脚本消除的“代码缺口”：

- 在目标手机核对 APK SHA-256，完成首次安装和同签名覆盖升级。
- 使用目标手机上的真实 API 地址完成注册、同步、离线重启和恢复。
- 取得目标手机当前 Chrome 的 package/certificate SHA-256，加入 personal allowlist 后验证真实网页填充。
- 验证系统锁屏、StrongBox/Keystore、生物信息变化、Autofill/Credential 系统 UI、分享和文件选择器。
- 把长期 personal keystore、alias/password 和证书摘要备份到校园服务器之外的加密介质，并演练恢复。

未完成这些项目时，可以称为“API 36 自动回归通过的个人 APK 候选”，不能称为“真实设备最终验收完成”。

## 不阻塞个人 APK 的后续扩展

- Google Play AAB、Play App Signing、Console、Data safety、商店素材、测试轨道和审核访问。
- iOS、passkey、Wear OS 和浏览器扩展重构。
- API 26/29 自动化矩阵；当前只维护 `minSdk 26` 兼容声明，自动验证按项目决定仅运行 API 36。
- 证书 pinning、企业 MDM 分发、多账号同时在线及高级组织策略。

## 维护规则

- 功能状态只在对应测试报告和源码 fingerprint 一致时更新。
- 新增核心功能时必须同时补单元、instrumented 或 Maestro 中最接近真实边界的一层。
- 调整 Room、Keystore、OPAQUE、同步协议或 config plugin 时，必须从 native/instrumented 层开始重跑。
- APK 每次递增 `versionCode`，始终使用同一 personal key；回滚通过更高版本号修复版完成。
- 远端镜像不是第二份长期源码，测试前必须 rsync；同步失败时禁止使用旧副本。

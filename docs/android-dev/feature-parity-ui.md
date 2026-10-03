# Android 功能对齐与 UI

Last updated: 2026-07-27

当前源码已覆盖个人密码管理客户端的核心功能面，但“代码存在”“自动回归通过”和“真实设备验收”必须分开。最后已验证的个人 APK 是 `0.1.1 / versionCode 18`；`0.1.2 / versionCode 19` 是当前候选。2026-07-30 的自动化已覆盖 clear-state 服务端灾难恢复、旧密码失效、跨设备删除和恢复后旧设备失效。最终源码指纹的 API 36 instrumented、单设备聚合旅程、新 APK、全路由视觉/无障碍、真实 Chrome Autofill 和真机仍须分别验收。

## 功能矩阵

| 能力 | Android 源码状态 | 当前缺口 |
| --- | --- | --- |
| OPAQUE 注册/登录 | 已实现；当前完整测试通过 Rust↔Serenity 互操作，APK 黄金路径覆盖注册/登录/恢复 | 最终聚合回归和真实 API/设备。 |
| 设备审批/key packet | 已实现并通过两台独立 API 36 AVD | 真实设备审批、密钥分发与撤销。 |
| Room/离线读取 | v1/v2 schema、Repository 和队列存在；当前 API 36 instrumented 通过 28/28 | Recovery 修复后的新增 native 回归、升级后真实数据保持和真机证据。 |
| Login/Note/Card CRUD | 已实现 | 当前 native adapter 下的增删改查、revision、删除墓碑、重启。 |
| 文件夹整理 | 已实现：编辑器支持选择已有文件夹或直接输入新名称，首页按文件夹分组 | 真机大量文件夹、超长名称、动态字体和中英文排序视觉验收。 |
| 搜索/生成器/TOTP | 已实现 | 锁定边界、时间边界和合成密文 E2E。 |
| 双向同步/冲突 | 已实现；两台 API 36 AVD 已通过 push/pull、四种冲突动作及撤销 | 最终单设备网络错误/离线聚合回归和真机。 |
| 历史/恢复 | 已实现 | 历史恢复重新入队；Recovery v2 全设备丢失、旧码/重放/轮换/超时续传。 |
| 本地/云备份 | 已实现 | 真实 DocumentPicker/分享面板、重新授权、原子恢复、负向矩阵；52 MiB 整文件 JS 解析内存风险。 |
| 密码健康/账户管理 | 已实现 | 纯本机计算与安全账户删除黄金路径。 |
| Autofill/Credential | 原生服务和历史合成正向切片存在 | 真实 Chrome/WebView/第二 App、锁定、相似域名、签名变化、取消、无网络。 |
| 中文/英文 | 翻译层与设置切换已实现 | 当前全路由、动态错误、截断、原生资源和冷启动保持；未覆盖项不能仅凭词条存在标记通过。 |
| 浅色/深色/系统 | 三档设置与持久化路径已实现 | 当前候选的快速切换、Activity/进程重建、系统变化和真机视觉。 |
| 8-bit-inspired UI | 已实现，编辑页局部验证 | 全路由三主题/双语/无障碍验收；当前证据仅覆盖 API 36 编译、安装和编辑页黄金路径。 |
| 图标/启动 | 已实现 | launcher mask、冷/慢启动、深浅主题、reduced motion 和无白闪。 |
| 恢复码复制 | 已实现；Recovery v2 已通过 clear-state 服务端重建、替换设备、轮换密码/恢复码、旧密码拒绝并解密原密文 | 真实设备剪贴板超时清理、后台清屏和系统历史边界。 |

## 路由与状态

Expo Router 当前提供：

- `login`、`register`、`device-approval`、`unlock`
- vault tabs、item detail/edit
- `sync-status`、`conflicts`、`devices`
- `recovery`、`recovery-code`
- `local-backup`、`cloud-backup`
- `password-health`、`account`、`settings`

tab 容器 header 已隐藏，UI 不应再显示 `(tabs)` 或英文 route slug。唯一顶层 `AppProvider` 持有 auth/vault 状态，业务屏幕不得重新建立独立事实源；Room/Repository 始终是密文和同步元数据的权威来源。

## 最后基线与当前证据边界

- v18 APK 的构建证据为 `20260727T013910Z-personal-release-66953-12503`，`versionName=0.1.1`、`versionCode=18`；其 SBOM 版本错误是生成时未校验 `package.json`，已在 v19 候选流水线中修正。
- 当前源码 `20260726T204634Z-typecheck-52354-18464` 通过；`20260726T204714Z-test-53041-11571` 通过 mobile 80/80、shared 48/48、Worker 204/204、Web 188/188、Rust 18/18 与 29/29。
- `20260726T134540Z-e2e-editor-layout-10871-15186` 只覆盖文件夹新建/已有选择、首页分组和网站协议选择；不是完整核心 E2E 或全路由 UI 证据。
- `20260727T014404Z-upgrade-check-api36-67982-14403` 证明 API 36 v17→v18 同签名包管理器升级；不证明真实用户数据、Room、Keystore 或会话状态。
- 历史 `20260726T204816Z-instrumented-api36-53738-32409` 通过 API 36 28/28；当前候选的 `20260730T125747Z-e2e-multidevice-api36-94573-25141` 通过强化双设备流程，`20260730T124911Z-e2e-local-91529-15360` 通过 clear-state 灾难恢复。最终冻结指纹仍须重跑 instrumented 与单设备聚合旅程。

## 交互与内容规则

- 默认中文，设置中可切 English；Android 系统拥有的界面仍按系统 locale。
- 默认浅色，并提供浅色/深色/跟随系统；主题只改变应用内语义 palette。
- 用户数据、恢复码、URL、用户名、备注和自定义字段永不翻译。
- 密码默认隐藏；显示、复制、填充、导出、恢复、删除和覆盖必须有明确动作与反馈。
- 触控目标至少 48dp，支持 TalkBack、动态字体、键盘、小屏和旋转；状态不能只靠颜色。
- 列表虚拟化；搜索在解锁内存或 native 安全索引中完成，不持久化明文搜索索引。
- 开发期暂不启用 `FLAG_SECURE`，截图只用合成数据。最终个人日用候选是否恢复敏感页限制需明确决定。
- 冷启动离线解锁目前只保证给已启用强生物识别的设备；密码模式冷启动仍需在线 OPAQUE，UI 不得承诺无条件离线解锁。

## 文件夹与网站字段

- 文件夹不是独立的明文服务端对象，而是加密条目中的一个字段。编辑器从当前已解锁条目中提取、去空白并去重后展示“已有文件夹”；点按建议会填入该名称。
- 用户仍可直接输入任意新名称。保存时会去除首尾空白，并由该条目自然建立新的逻辑文件夹；留空的条目统一显示在“未分类”。
- 首页按文件夹形成分区：命名文件夹按当前语言 locale 排序，“未分类”固定在最后；每个分区内部保留原条目顺序。搜索只显示包含匹配条目的分区。
- 网站协议使用固定选择器，只允许 `https://` 与 `http://`，默认 `https://`；输入框继续只接收 origin 的主机与可选端口，路径、查询、账号信息会被拒绝。
- 纯 TypeScript 回归覆盖建议去重、空白处理、分组、排序和搜索后分区；API 36 的 `editor-layout-api36.yml` 还覆盖新文件夹输入、首页分组、再次进入编辑器选择已有文件夹，以及协议切换。

## 8-bit-inspired UI

视觉目标是现代密码管理器中的 8-bit 品牌语法，而不是游戏化或牺牲可读性：

- 4/8dp 网格、2dp 边框、无模糊硬偏移投影、紧凑圆角。
- 像素 rail/signal/status block 仅建立层级和状态节奏。
- 正文继续使用霞鹜文楷，机器值用等宽字体；不强制像素字体。
- 功能图标使用 Expo Symbols；装饰像素块从无障碍树隐藏。
- 所有元素使用语义 palette，覆盖浅色、深色和系统模式。
- 登录/注册、列表、详情、编辑器、设置、恢复、冲突和备份保持一致；系统选择器和生物识别保持 Android 原生外观。

验收覆盖中英双语、三主题、pressed/focused/disabled/loading/error、动态字体、TalkBack、小屏、旋转和键盘。新 8-bit UI 已取得编辑页局部证据，但不能据此标记其他页面或全局验收完成。

## 个人 APK 与 Play 的边界

个人分发目标要求完整核心黄金路径、API 36 业务证据、真机首装/升级、真实 Chrome allowlist 和 keystore 外部备份。当前源码已关闭 clear-state 灾难恢复与强化双设备流程；最终指纹 instrumented、单设备聚合旅程、v19 APK 与外部门禁仍开放。自动化只运行 API 36；API 26 仅是 `minSdk` 安装兼容声明。

正式 Play 版本的隔离 AAB 流水线与 Web `/account-deletion` 路由已有源码，但尚未运行或公开部署。仍需 Play App Signing、真实 upload key、隐私政策/Data safety、商店素材、审核访问、测试轨道和 Console 发布。具体见 [生产客户端计划](production-client-plan.md) 与 [质量发布](quality-release.md)。

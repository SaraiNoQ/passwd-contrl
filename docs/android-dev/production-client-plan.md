# Android 生产完整客户端计划

Last updated: 2026-07-27

本计划同时记录两个终点，但当前只执行 **核心功能完整的个人签名 APK**。Google Play 上架作为后续独立轨道，不得用商店材料缺失阻塞个人设备可用版本，也不得把侧载可用误写为商店就绪。

## 两个完成定义

### A. 核心功能完整个人 APK

必须满足：

- 真实 OPAQUE 注册/登录/恢复、设备绑定 bearer、审批和 vault-key packet 通过。
- vault key、设备私钥、OPAQUE 状态和 Keystore wrapping key 不进入 JS；JS 只持有短期 session handle。
- Room 是密文和同步元数据的单一事实源；三类 CRUD、搜索、生成器、TOTP、历史、双向同步、离线重启和四种冲突动作通过。
- Recovery v2、设备管理、本地/云密文备份、密码健康和账户删除完成核心黄金路径。
- AutofillService 与 Credential Provider 在真实浏览器/原生 App 场景通过正向与负向矩阵。
- 中文/英文、浅色/深色/跟随系统、8-bit-inspired UI、图标、启动、动态字体和 TalkBack 通过 API 36 验收。
- 当前 fingerprint 的 native/instrumented、业务 E2E、个人签名 APK、包管理器升级及个人真机首装/升级均有证据。
- 长期个人 keystore 已在校园服务器之外加密备份。

### B. 正式 Google Play 版本

在 A 的基础上，还必须满足 AAB、Play App Signing、权限/政策收敛、隐私与 Data safety、公开账户删除网页、商店素材、审核访问、测试轨道、生产访问、监控、分阶段发布和回滚。Play Console、公开网站、测试者与上传授权属于外部输入。

## 最后已验证基线与当前源码

- 最后可核验构建：`20260727T013910Z-personal-release-66953-12503`（`0.1.1 / versionCode 18`）
- `versionName=0.1.0`、`versionCode=17`
- APK SHA-256：`d57a8f48116d1fd92b439880677e22a70937e21bf661243e5d5bb1fdc6da9d50`
- 签名证书 SHA-256：`6D9A1E53CD8F86D5F85EB49FC7C73972BC4398B8AED43F57ED010CEECDA8335D`
- `20260727T013910Z-personal-release-66953-12503` 已生成 `0.1.1 / versionCode 18`，`20260727T014404Z-upgrade-check-api36-67982-14403` 已验证 API 36 的 v17→v18 同签名包管理器升级。

v18 是**最后已验证的构建基线**，`0.1.2 / versionCode 19` 是当前候选。`20260730T124911Z-e2e-local-91529-15360` 已覆盖 clear-state 服务端重建、原密文解密、密码/恢复码轮换及旧密码失效；`20260730T125747Z-e2e-multidevice-api36-94573-25141` 已覆盖跨设备删除同步、恢复替换设备及旧批准设备失效。最终源码指纹的 instrumented、聚合 E2E、v19 构建/升级、真实 Chrome、真机与外部 keystore 备份仍未关闭。

## 已实现、部分完成与未完成

| 能力 | 当前判断 | 说明 |
| --- | --- | --- |
| Expo/RN/Kotlin/Rust 架构 | 已实现，候选原生门禁待最终指纹复跑 | 最后签名制品是 v18；v19 构建前须重跑 API 36 instrumented。 |
| OPAQUE 互操作 | 完整测试和 clear-state 恢复正向核心通过 | full test 已覆盖 Rust↔Serenity；恢复旅程已覆盖注册、服务端重建、密码重置、旧密码拒绝和原密文解密。真实服务环境与长期错误分支仍待验收。 |
| Keystore/生物识别/设备密钥 | 已实现，当前模拟器门禁通过 | 当前 API 36 instrumented 28/28；真机生物信息变化/StrongBox 仍开放。 |
| Room v1/v2 与迁移 | schema 与当前 instrumented 已完成 | v1/v2 JSON 已纳入，当前 API 36 instrumented 通过；真机数据保留和大备份/长期压缩边界仍开放。 |
| 设备审批与 key packet | 当前双 AVD 自动验证通过 | 两个独立 API 36 AVD 已完成 pending→approve→key packet→unlock→revoke；真机仍待验收。 |
| 三类 CRUD/同步/冲突 | 已实现，单设备核心与双设备冲突通过 | 双 AVD 已覆盖双向同步和四种冲突动作；全历史、长期运行与未覆盖错误/取消分支仍开放。 |
| 恢复/历史/备份/账户 | clear-state 灾难恢复通过 | 当前候选已覆盖同步哨兵、密码重置、新恢复码、旧密码拒绝、服务端重建和原密文解密。真实文件 picker、全设备丢失真机演练、大备份与长期压缩风险未关闭。 |
| Autofill/Credential | RN 进程死亡后的合成旅程通过 | 真实 Chrome/WebView/第二 App 与负向矩阵未完成。 |
| i18n/theme/8-bit UI | 已实现，局部运行验证 | 当前 UI 已编译、安装并完成 API 36 编辑页黄金路径；全路由、双语/三主题、无障碍和真机视觉仍未完成。 |
| personal APK | v18 构建与 v17→v18 升级完成；v19 候选门禁正在收口 | v19 尚未构建；真机业务、真实 Chrome、keystore 外部备份未完成。 |
| Play AAB/发布 | 仓库内基础已实现，未运行 | `mobile:remote:build:play`、隔离 upload-key 签名、bundletool/16 KiB/权限/SBOM 校验和 Web `/account-deletion` 已有源码；尚无真实 Play key、首个 AAB、公开网页部署或 Console 证据。 |

## 工作流依赖

```text
协议/会话
  → Rust/Keystore/Room/VaultRepository
  → AppProvider 与三类业务条目
  → 单设备同步/恢复/备份
  → 双设备审批/冲突/撤销
  → Autofill/Credential
  → UI/i18n/theme/8-bit 与无障碍
  → API 36 候选
  → 个人真机验收与 keystore 外部备份
  → [后续] AAB/Play 政策与商店发布
```

所有 Android 编译和测试必须先同步并在 `campus-server` 容器执行；本机只编辑、审查和下载产物。

## 实施阶段

### 1. 协议与 native 安全边界

- 用当前 fingerprint 重跑 Rust/Serenity OPAQUE、匿名注册/登录/恢复 transport 和并发串行状态。
- 重跑 Room 1→2、Keystore invalidation、生物识别、后台锁定、process death、backup exclusion。
- 验证 RN 不获得 vault key、设备私钥、OPAQUE 状态或 wrapping key。

完成条件：API 36 instrumented 与真实 APK 认证流程均通过。

当前自动化状态：完整测试已覆盖 OPAQUE Rust↔Serenity，API 36 instrumented 已在 `20260726T204816Z-instrumented-api36-53738-32409` 以 28/28 通过；真实手机仍属于外部验收。

### 2. 单设备核心流程

- 注册→恢复码→解锁。
- Login/Secure Note/Card 的创建、查看、编辑、删除。
- 搜索、密码生成器、TOTP、历史查看/恢复。
- 离线 mutation、杀进程、重新授权、精确一次恢复推送。
- 同步 pending/error 可见，前台周期拉取和锁定后停止均通过。

完成条件：`e2e:local` 在当前 fingerprint 形成完整摘要，而不是仅 editor-layout。

### 3. 多设备信任与冲突

- 设备 B pending；设备 A 批准并分发 key packet。
- B 解锁并拉取；A/B 双向写入。
- 保留本地、采用云端、两者保留、稍后处理四种冲突动作。
- 撤销设备后 bearer、key packet 和后续同步正确拒绝。

完成条件：两个独立 API 36 模拟器通过，不能用同进程 fixture 或数据库注入替代。

当前自动化状态：`20260726T201932Z-e2e-multidevice-api36-51221-32507` 已在两个独立 AVD 通过全部上述步骤；物理设备不在该证据范围。

### 4. 恢复、备份和账户

- Recovery v2 覆盖全设备丢失、旧码失效、重放、超时续传、auth epoch 轮换和 replacement device。
- Android Room 密文快照导出→系统选择→重新授权→原子恢复→锁定。
- Web `crypto-core-wasm` 加密包导入后重新入队；跨账户、错误密码、篡改、超限和旧格式 fail closed。
- 把 52 MiB `File.text()`→JS string→`JSON.parse` 改成 native 流式路径，或降低并实测上限。
- 密码健康保持纯本机；账户删除与远端数据清理语义一致。

### 5. Autofill 与 Credential Provider

- AutofillService 支持 API 26+；Credential Provider 支持 API 34+ password credential。
- Web 精确 HTTPS origin；App 精确 package + signing certificate SHA-256。
- 锁定时提供认证 entry，解锁后短期 reveal；RN 进程不存活时仍可工作。
- 在 API 36 验证 Chrome、WebView、至少一个原生 App、多账号、相似域名、签名变化、取消、无网络、RN 未启动。
- 真实 Chrome package/cert 必须来自个人设备，不能用模拟器证书替代。

### 6. UI、i18n、主题和 8-bit 视觉

- 默认中文，可手动切 English；用户数据永不翻译。
- 默认浅色，支持浅色/深色/跟随系统；不得通过 `Appearance.setColorScheme(...)` 触发 Activity 重建。
- 8-bit-inspired 采用 2dp 边框、无模糊硬投影、像素 rail/status/signal、紧凑圆角和 4/8dp 网格。
- 霞鹜文楷保留正文可读性，机器值使用等宽字体；功能图标使用 Expo Symbols。
- 装饰像素从无障碍树隐藏；触控至少 48dp；颜色不是唯一状态。
- API 36 逐页验收登录/注册、列表、详情、编辑器、设置、恢复、冲突、备份和系统入口的中英、三主题、动态字体、TalkBack、小屏/旋转和键盘。

当前 8-bit UI 只有编辑页局部黄金路径，不代表全路由和无障碍阶段完成。

### 7. 个人签名与真机

- 保留当前长期 personal key；每版递增 `versionCode`。
- 重新构建最终候选并交付 APK、SHA-256、证书摘要、版本和安装说明。
- 真机完成首次安装、同签名覆盖升级、真实 API、Chrome、Keystore/生物识别、文件选择器和恢复演练。
- 将 keystore、alias/password 和证书摘要备份到校园服务器外的加密位置。

debug 与 personal 签名不同，卸载 debug 会清除 Room/Keystore；切换前必须验证恢复码或保留另一台可信设备。

### 8. Google Play 后续轨道

- 仓库已提供 `pnpm mobile:remote:build:play`：构建 unsigned release AAB 后在不联网、只读、无额外 capability 的独立容器中用独立 upload key 签名，并验证 bundletool、版本、生产 API、调用方 allowlist、16 KiB、ABI、权限、SBOM、mapping 和 native symbols。它尚未用真实 Play 凭据运行，不能写成 AAB 已通过。
- 创建 Play App Signing/upload key、分阶段发布与回滚。参考 [Android 发布](https://developer.android.com/studio/publish/) 和 [应用签名](https://developer.android.com/studio/publish/app-signing)。
- 当前已经 target API 36；2026-08-31 起新应用和更新的要求见 [目标 API 政策](https://support.google.com/googleplay/android-developer/answer/11926878) 和 [通用要求](https://support.google.com/googleplay/android-developer/answer/16561298)。
- 对 AAB 独立验证 16 KiB page size；参考 [Android 官方说明](https://developer.android.com/guide/practices/page-sizes)。
- 当前 manifest 已移除 `QUERY_ALL_PACKAGES`，改用 `MAIN + LAUNCHER` intent query；Play 候选必须继续检查合并后的 manifest，确保依赖没有重新引入受限权限。包可见性边界仍应按 [包可见性政策](https://support.google.com/googleplay/android-developer/answer/10158779) 复核。
- App 内删除路径和 Web `/account-deletion` 已有源码；仍须部署到公开 HTTPS 域名、验证端到端删除，并把 URL 配入 Console：[账户删除要求](https://support.google.com/googleplay/android-developer/answer/13327111)。
- 版本化源码事实清单 [`play-data-safety.v1.yaml`](play-data-safety.v1.yaml) 已建立，但其中的 `open_questions` 尚未由服务运营方、发布者和法律审核关闭；仍须完成生产 SDK/服务商/日志审计、公开隐私政策和 Console Data safety 表单：[Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)、[隐私政策](https://support.google.com/googleplay/android-developer/answer/9859455)。
- 无真实凭据的英文审核模板 [`play-reviewer-instructions.en.md`](play-reviewer-instructions.en.md) 已建立；仍须替换全部占位符，提供允许审核人员使用合成数据的公开可达、可重置环境，并用提交 AAB 实测。共享密码或恢复码只放 Play Console 受保护字段，不进入仓库：[App access](https://support.google.com/googleplay/android-developer/answer/15748846)。
- 准备 listing、截图、feature graphic、内容分级、支持信息、测试轨道、pre-launch report 和 crash/ANR 监控。
- 若账号适用，完成 12 名测试者连续 14 天的生产访问要求：[官方说明](https://support.google.com/googleplay/android-developer/answer/14151465)。

## 当前最短收口路径

1. 保持当前候选已通过的 typecheck、full test、28/28 instrumented 和 API 36 专项 E2E；任何源码变化按影响范围重跑。
2. 以 `20260730T124911Z-e2e-local-91529-15360` 作为 clear-state 服务端灾难恢复证据，以 `20260730T125747Z-e2e-multidevice-api36-94573-25141` 作为强化双设备证据；未覆盖的全历史、错误/取消和长期运行仍须补齐。
3. 双设备审批、同步、四种冲突和撤销已由 `20260726T201932Z-e2e-multidevice-api36-51221-32507` 关闭 API 36 自动化门禁；真机仍待验收。
4. 完成真实 picker/备份闭环，并处理大备份、SAF 负向路径、长期压缩和内存风险。
5. Autofill/Credential 真实目标与负向矩阵。
6. 全路由 i18n/theme/8-bit/无障碍验收。
7. 完整业务冻结后生成更高 `versionCode` 的最终 personal APK，并再次完成 API 36 包管理器升级。
8. 设备所有者真机验收、真实 Chrome allowlist 和 keystore 外部备份。
9. 只有决定正式上架后，才配置独立 Play upload key、重建远程镜像并实际运行 AAB 流水线；随后完成公开网页、政策材料和 Console 轨道。

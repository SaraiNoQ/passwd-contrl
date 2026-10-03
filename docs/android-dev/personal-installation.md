# Android 个人安装与升级

Last updated: 2026-07-26

本文适用于不经应用商店、由项目所有者直接分发到自有 Android 设备的个人签名 APK。

## 当前检查候选制品

2026-07-27 的远程运行 `20260727T013910Z-personal-release-66953-12503` 生成了当前已验证个人 APK 基线：

- 包名：`com.zerovault.mobile`
- 版本：`0.1.0`（`versionCode=17`）
- APK：`artifacts/zero-vault-v0.1.1-v18.apk`
- APK SHA-256：`d57a8f48116d1fd92b439880677e22a70937e21bf661243e5d5bb1fdc6da9d50`
- 签名证书 SHA-256：`6D9A1E53CD8F86D5F85EB49FC7C73972BC4398B8AED43F57ED010CEECDA8335D`
- 证据状态：`stale=false`、退出码 0，服务器与本地校验均通过
- API host：`zero-vault-api.sarainosakura.workers.dev`

该 APK 针对其同步源码通过个人 release 门禁，`20260727T014404Z-upgrade-check-api36-67982-14403` 通过 v17→v18 同签名覆盖升级。v18 的 SBOM 版本字段错误记录为 0.1.0，因此只作为历史回退和升级基线；版本一致性门禁已修复，向所有者交付前必须为当前源码生成 `0.1.2 / versionCode 19`。

当前源码不声明 `QUERY_ALL_PACKAGES`，仅通过 `MAIN + LAUNCHER` intent query 发现用户可启动 App，并在可见范围内执行 package + certificate 关联校验；无法读取签名时 Autofill 会 fail closed。个人发布脚本还会检查合并后的 manifest，防止依赖重新引入该受限权限。

## 最近一次历史可安装制品（2026-07-16）

以下信息只用于追溯旧快照，不代表当前源码。每次
`pnpm mobile:remote:build:personal` 成功并通过
`pnpm mobile:remote:artifacts <personal-release-run-id>` 下载校验后，均应以该运行目录中的
`version.txt`、`signing-cert.txt`、`artifact-SHA256SUMS` 和 `INSTALL.txt`
为准；实际安装文件固定为 `zero-vault-personal-release.apk`。

- 包名：`com.zerovault.mobile`
- 版本：`0.1.0`（`versionCode=2`）
- APK：`artifacts/mobile-remote/20260716T181310Z-personal-release-15042-22547/zero-vault-personal-release.apk`
- APK SHA-256：`cdd9a5f547a89db0b6946245bd000fbb684e350fd632f0a90fa2fb25c2436e29`
- 签名证书 SHA-256：`6d9a1e53cd8f86d5f85eb49fc7c73972bc4398b8aed43f57ed010ceecda8335d`

安装前必须使用可信的 SHA-256 工具核对 APK；若结果不一致，不要安装。

## 分发前取得候选

所有构建、签名和 Android 检查仍在 campus-server 完成。本机只发起同步并下载已经校验的制品：

```bash
pnpm mobile:remote:build:personal
pnpm mobile:remote:artifacts <personal-release-run-id>
```

第一条命令的输出中会打印精确的 `personal-release` run id。第二条命令只接受受支持的精确 run id，并同时验证远端与下载后本地的 `SHA256SUMS`、`artifact-SHA256SUMS`、退出码和 `stale=false`。下载目录固定为：

```text
artifacts/mobile-remote/<personal-release-run-id>/
```

分发时只发送该目录中的 `zero-vault-personal-release.apk`；同时把
`artifact-SHA256SUMS`、`version.txt`、`signing-cert.txt` 和 `INSTALL.txt`
保留为该 APK 的验收依据。不要发送 keystore 或 `release.env`。

当前构建器不会把 `release.env` 中的配置值直接视为已进入 APK。签名完成后，它会在隔离 verifier 中重新打开最终 APK，要求 `assets/index.android.bundle` 恰好一个、完整生产 API URL 在 bundle 中恰好出现一次，并从 APK 内实际 JSON resources 计算规范化 allowlist 的 SHA-256，要求恰好一个 resource 与预期 digest 匹配。分发记录必须同时保留 `final-verification.txt` 和 `privileged-callers-SHA256`；缺少、重复或 digest 不匹配时不得安装。

v18 已按上述精确 run id 生成并拉取。当前候选新增证据为 `20260730T124911Z-e2e-local-91529-15360` 和 `20260730T125747Z-e2e-multidevice-api36-94573-25141`；它们分别覆盖 clear-state 灾难恢复与强化双设备流程，但不能直接升级为“v19 已完成”声明。v19 必须在最终源码指纹的 instrumented、聚合黄金路径、个人签名构建和 v18→v19 覆盖升级通过后交付。真实 Chrome/其他应用、系统填充负向矩阵和真机仍须外部验收。

## 首次安装

1. 通过可信的有线连接或端到端加密通道把 APK 复制到设备。
2. 在 Android 系统文件管理器中打开 APK。
3. 按系统提示，只为当前文件来源临时允许“安装未知应用”。
4. 确认包名和安装提示后完成安装，再关闭该来源的安装权限。
5. 启动 Zero Vault，确认能连接真实 API，再完成注册或设备审批。

安装记录至少写下：设备型号、Android 版本、APK run id、APK SHA-256、安装时间和结果。记录不得包含恢复码、口令、token 或真实密码库内容。

当前 UI 预期为首次启动默认中文和浅色；设置页可切换 English，并在浅色、深色、跟随系统之间选择。业务页面使用显式中英词条，恢复码、用户名、密码、备注、卡片和自定义字段等用户数据保持原样；全路由双语/三主题巡检仍未完成。Android 生物识别、文件选择器、系统设置和 Autofill/Credential Provider 选择器仍跟随设备系统语言，不保证与应用内手动语言相同。

如果设备上安装的是开发签名版本，它不能被个人 release 签名版本直接覆盖。卸载开发版会删除其本地数据；操作前必须确认恢复码可用，或仍有另一台可信设备能够审批和分发 vault key。

## 覆盖升级

后续 APK 必须同时满足：包名不变、使用同一把个人 release keystore 签名、`versionCode` 严格增加。

从 `0.1.1 (versionCode 18)` 开始，每个包含正式修改并交付检查的 APK 都同时递增 `versionName` 和 `versionCode`。同一个 `versionName/versionCode` 组合只对应一份已校验源码和一份签名 APK，不覆盖重打。

1. 不要卸载现有版本，也不要清除应用数据。
2. 核对新 APK 的 SHA-256 和发布记录。
3. 打开新 APK，选择“更新”。
4. 更新后确认账户、离线密文、解锁能力和 Autofill 设置仍然存在。

首次真机安装以及一次 `N -> N+1` 原地升级仍需在所有者设备上验收；服务器模拟器通过不能替代这两项检查。

在向手机发送新版本前，可先在唯一受支持的 API 36 远程模拟器验证 Android Package Manager 接受同签名升级：

```bash
pnpm mobile:remote:upgrade-check \
  <old-personal-release-run-id> \
  <new-personal-release-run-id>
```

命令会先同步当前源码，并在启动 API 36 模拟器前强制要求远程镜像 fingerprint 与新 APK 构建证据 `sync.txt` 中的 fingerprint 完全相同；旧 APK 可以作为历史升级起点，新 APK 必须由当前源码构建。随后才核对两个 APK 的校验和、包名、签名证书和递增 `versionCode`，干净安装旧版并用 `adb install -r` 覆盖为新版，确认安装后版本与应用 UID 保持一致。fingerprint 不匹配时必须重建新 APK。该命令不读取或证明真实设备的 Room、Keystore、登录状态或 Autofill 配置；这些仍必须由上面的真机步骤验收。

## 采集真实 Chrome allowlist

API 36 Play 模拟器证书只能用作模拟器证据：

```bash
pnpm mobile:remote:browser-cert
```

个人设备候选必须使用目标手机当前安装的 Chrome。无需在本机安装 Android SDK 或 `adb`：

1. 在目标手机上查看 Chrome 的版本号，并用可信的设备侧 APK 导出工具导出 Chrome 的 **base APK**。不要使用从网站下载的同名 APK，也不要导出 `.apks`/`.xapk` 容器。
2. 把导出的文件通过有线连接复制到源码目录之外，例如 `~/Downloads/chrome-base.apk`。
3. 运行：

   ```bash
   pnpm mobile:remote:browser-cert:device ~/Downloads/chrome-base.apk
   ```

4. 该命令会先同步源码，只把 APK 临时上传到专用远端证据目录，再由 campus-server 容器的固定 `apksigner` 和 `apkanalyzer` 验证包名必须为 `com.android.chrome`、签名者必须唯一，并提取版本、APK SHA-256 和证书 SHA-256。无论检查成功、失败或中断，包装脚本都会对专用路径执行清理；成功运行还会断言原始 APK 已从远端删除，并把远端记录的 APK SHA-256 与本机所选文件重新比对。结果自动下载到：

   ```text
   artifacts/mobile-remote/<browser-cert-device-run-id>/
   ```

5. 将 `browser-version.txt` 中的版本与手机设置页显示的 Chrome 版本核对一致。检查
   `privileged-callers-device.json` 后，通过 `ssh root@campus-server` 把
   `release-env-line.txt` 的整行替换到
   `/root/dev/zero-vault-android-secrets/release.env` 中同名配置；文件仍须保持 root 所有且权限 400 或 600。
6. 重新执行 `mobile:remote:build:personal`。不要继续分发证书不匹配的旧 APK。

导出文件本身不能证明来源；“设备设置页版本一致 + 服务器验证包名/证书 + 重建 APK”三项都完成后，才可把它作为该设备的 Chrome allowlist 输入。证书未知或不匹配时应保持拒绝，不得放宽为任意浏览器。

`release-env-line.txt` 不含签名私钥或密码，但它属于发布配置证据；不得将整个 `release.env` 复制回源码目录。

## 真机验收边界

API 36 模拟器、instrumented 测试和合成 fixture 不能替代以下个人设备验收：

- 连接真实 HTTPS API，完成注册或可信设备审批、vault key 分发、解锁、CRUD、离线重启、同步与恢复。
- 验证系统锁屏、生物识别解锁、生物信息变化和 Keystore 失效行为；StrongBox 只按目标设备实测结果声明。
- 使用目标设备实际 Chrome package/certificate allowlist 验证浏览器 Autofill。
- 完成个人签名 APK 首次安装，以及同一签名、较高 `versionCode` 的 `N -> N+1` 覆盖升级，并确认 Room、Keystore、离线数据和 Autofill 状态按预期保留。
- 验证中文/英文、浅色/深色/跟随系统、launcher/adaptive icon、冷启动 splash/品牌动画、恢复码复制与后台清屏。开发阶段截图限制暂时关闭，截图只能使用合成数据，不能保存恢复码或真实凭据。

冷启动离线解锁目前只适用于已在联网解锁后启用强生物识别的设备。仅使用主密码的设备在冷启动时仍需联网完成 OPAQUE 授权；不要把“本地已有密文”理解为任意模式都可离线解锁。

## 签名密钥备份

服务器当前保存个人 release keystore 和环境文件，但这不是独立备份。必须把二者复制到由所有者控制的加密离线介质或密码管理保险库，并验证能够恢复；不要把它们放入 Git、源码同步目录、聊天附件或 APK 制品目录。密钥遗失后无法用新密钥覆盖升级现有安装。

# Android 安全

Last updated: 2026-07-26

> **实现状态：** Keystore/biometric、Rust/UniFFI、device-bound session、Recovery v2、Room、原生 SAF 备份和系统填充代码已进入当前工作树。`0.1.1 / versionCode 18` 是最后签名 APK，`0.1.2 / versionCode 19` 是当前候选。clear-state 服务端灾难恢复与强化双 AVD 流程已于 2026-07-30 通过；最终源码指纹的 API 36 instrumented、真实 Chrome Autofill、真机与服务器外 keystore 备份仍开放。开发阶段按项目所有者要求暂时关闭截图限制，这是一项明确接受的临时风险。

## 密钥清单

| 材料 | 允许的位置 | 是否可导出 |
| --- | --- | --- |
| master password | RN secure input/call stack 后立即进入短期 native buffer | 否，使用后清零 |
| OPAQUE state | Rust native memory | 否 |
| vault key | Rust/native session memory；必要时 wrapped blob | 不以明文导出 |
| device private key | Keystore wrapping 后的 blob 或硬件 key | 否 |
| wrapping key | Android Keystore | 否 |
| bearer session | 平台 secure storage / Keystore 保护的存储 | 仅网络层短期使用 |
| item plaintext | 解锁后的短期内存 | 不持久化 |

## 信任边界与威胁

不信任 Worker/数据库、网络、JS bundle、远程调试、intent/Binder 输入、剪贴板、截图/录屏、备份、日志和其他 App。目标威胁包括丢失的锁定设备、恶意 Autofill 请求、相似域名、签名替换、root/调试环境、篡改密文、重放 mutation 和供应链依赖。

root/已解锁设备不能被承诺完全防护；App 应检测明显调试/完整性异常并提高认证强度，但不得把完整性服务当作唯一密钥保护。

开发阶段不设置 `FLAG_SECURE`，因此恢复码、密码和其他明文可能被系统或第三方截取。截图反馈必须只使用合成账户且不得归档敏感值；最终日常使用候选是否恢复敏感页面截图限制须在分发前明确决定。

## 日志规则

禁止口令、recovery code、key、token、明文条目、完整 ciphertext、origin、username、表单值和请求 body。允许版本、稳定错误码、耗时桶、匿名计数和 correlation id。release 构建做敏感字符串扫描。

## 本地备份边界

- Android SAF 文档内容不得跨越 Expo bridge。JS 只持有一次性的 `operationId` 和 `accountId`、`backupId`、`createdAt` 等公开元数据，不得取得备份 JSON、私有缓存路径或可复用文件句柄。
- 导入文件只暂存在 App 私有 `cache`，Android wrapper 和 crypto-core 包分别限制为 52 MiB 与 8 MiB，并以 64 KiB 缓冲复制；超限、格式不符、未知字段、账户不匹配和并发操作必须 fail closed。
- `operationId` 按备份类型一次性消费。恢复/导入无论成功或失败都删除已领取文件；用户取消、页面放弃、Activity 销毁和进程后续初始化也必须清理遗留暂存。
- Android wrapper 恢复前必须再次核对目标 `accountId`，不能把 UI 展示过的元数据当作授权依据。
- 私有缓存和一次性句柄减少了 JS/Hermes 中的密文副本与误用面，但不等于流式密码学。当前 Repository 与 Rust AEAD 仍会处理完整字符串，Kotlin wrapper 校验也会整包读取；峰值内存、超大合法包和内存清理仍是需测试与后续重构的边界。

## 个人分发安全门禁

- 无 direct login、test crypto、memory fallback 或 debug endpoint 可达路径。
- 候选 vault session 必须通过既有密文或版本化加密 verifier 的认证后才成为已解锁状态；空库在 verifier 落地前保持 fail closed。
- native/WASM 兼容向量、wrong-key/tamper、Keystore invalidation、backup exclusion、进程死亡通过。
- 使用长期个人 release keystore 签名；私钥位于服务器镜像之外且不进入仓库或 rsync，另需完成独立加密离线备份。
- 签名 release APK、mapping、SBOM 和校验和归档；依赖审计及 manifest/权限由人工复核并留存记录，不能假定构建包装器自动生成 permissions diff。
- Autofill 签名/origin 匹配测试与安全评审通过。

当前自动验证只覆盖 API 36；`minSdk 26` 仅是安装兼容声明。Play 签名、AAB、Play service account 和商店上传不属于个人 APK 分发门禁；真实设备的 HTTPS API、系统锁屏/生物识别与 Keystore 行为、Chrome 签名证书 allowlist、首次安装和同签名覆盖升级仍需真机证据。

当前任何一项都不能仅因实现代码或测试代码存在而视为通过；状态与证据要求见 [总览](overview.md#当前源码与待验证能力) 和 [质量与个人分发](quality-release.md#证据判定规则)。

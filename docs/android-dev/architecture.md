# Android 架构

Last updated: 2026-07-26

> **实现状态：** 下述分层已有 Worker/shared、Expo Module、Kotlin `VaultRepository`、Room/Keystore/biometric、生产 RN adapters 和系统服务代码。构建、测试和外部验收状态不在本架构页复制，统一以 [最终功能测评](final-functional-assessment.md) 和 [质量与个人分发](quality-release.md) 为准。

## 分层

```text
Expo Router screens
  -> AppProvider (唯一 Context/reducer)
  -> TypeScript ports/adapters
  -> ZeroVault Expo Module
  -> Kotlin VaultRepository
     -> Room (密文、revision、离线队列)
     -> Android Keystore / BiometricPrompt (密钥包装与授权)
     -> Rust crypto-core via UniFFI (KDF/AEAD/ECDH/恢复)
     -> Worker API (OPAQUE、bearer session、同步、设备)

AutofillService / CredentialProviderService
  -> Kotlin VaultRepository（不依赖 RN 进程）
```

## 核心约束

- Room 是本地密文、同步元数据、冲突标记和 mutation queue 的单一事实源。
- 明文条目仅存在于解锁后的短期 native/RN 内存；锁定、超时、进后台或进程销毁时清除。
- JS 只持有不可解释、短期、可撤销的 vault session handle。
- vault key、OPAQUE client state、设备私钥和 Keystore wrapping key 永不返回 JS。
- `VaultRepository` 同时服务 RN 和 Android 系统服务；系统服务不得等待 Metro、Hermes 或 React Context。
- 网络 DTO 在 `packages/shared` 定义，Kotlin 映射层必须拒绝未知版本或不完整密文。

## 读流程

1. UI 请求解锁，主密码只在输入组件/调用栈中短暂存在并立即交给 Expo Module；不得进入全局状态。
2. Repository 使用 Keystore/生物识别授权解包设备材料，再调用 Rust。
3. Rust 验证 AEAD 后，Repository 创建短期 session handle。
4. Repository 从 Room 读取密文并逐项解密；只返回当前页面需要的字段。
5. 后台或系统 Autofill 通过同一 Repository 查询，未解锁时只返回“需要认证”。

## 写与同步流程

1. UI 发送结构化 mutation，不直接构造 ciphertext。
2. Repository 调用 Rust 加密，事务写入 Room 的 item 与 mutation queue。
3. Sync worker 使用 bearer session 上传；成功后原子更新 server/item revision。
4. 冲突保留本地和远端密文引用，直到用户选择 keep-local、accept-remote、create-copy 或 skip。

依赖方向必须始终从 UI 指向 port，再指向原生实现；screen 不得直接调用 SQLite、Keystore、fetch 或 Rust FFI。

## 本地加密备份文档流程

Android 的本地导出与导入通过 Kotlin SAF（Storage Access Framework）完成，React Native 不再读取、拼接或保存完整备份 JSON：

1. 导出时 Kotlin Repository 生成加密快照和版本化 wrapper，再通过系统“创建文档”界面写入用户选择的 URI；JS 只收到是否保存、`backupId` 和 `createdAt`。
2. 导入时 Kotlin 通过系统“打开文档”界面把文件复制到 App 私有 `cache` 暂存区。Android wrapper 上限 52 MiB，crypto-core 导入包上限 8 MiB，复制缓冲区固定为 64 KiB。
3. 原生层严格验证 Android wrapper 的字段集合、格式版本、账户、UUID、时间戳和加密快照大小；JS 只收到一次性的 `operationId` 与公开元数据，不接触文件路径或完整密文。
4. 恢复或导入会按类型和 `operationId` 原子领取暂存文件，并在成功或失败后删除；取消、页面卸载、Activity 销毁及下次初始化也清理未消费文件，同一时刻只允许一个文档操作。
5. Android 备份恢复在调用 Repository 前再次核对 `accountId`，跨账户文件必须拒绝。

这里的“64 KiB 复制”只描述 SAF 与私有缓存之间的文件 I/O。当前 `VaultRepository`/Rust AEAD 接口仍以完整字符串处理加密包，Kotlin 解析 wrapper 也会把内容读入内存，因此尚不能宣称端到端流式加密或常量内存恢复。真正的流式 AEAD 需要新的分块格式、认证与回滚协议，不能仅靠文件复制缓冲区实现。

## 当前交付边界

- 交付物是由长期个人 keystore 签名、可在用户设备侧载和同签名覆盖升级的 APK；Play/AAB 不在范围内。
- 自动 Android 验证只运行 API 36；`minSdk 26` 仍是安装兼容声明，不代表维护旧系统测试矩阵。
- 模拟器 Chrome 证书不能替代真实设备证书，Autofill allowlist 必须以目标设备实际签名为准。

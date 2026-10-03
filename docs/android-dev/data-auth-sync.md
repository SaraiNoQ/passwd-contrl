# 数据、认证与同步

Last updated: 2026-07-26

> **实现状态：** Worker/shared 已有 mobile register/login finish、device-bound bearer、pending 权限、审批/key packet、Recovery v2、撤销和 cursor/item mutation；Android 已有 native 设备材料、Room queue/conflict 和 RN 页面/adapter。OPAQUE Rust↔Serenity 互操作已解除 fail-closed 开关，D1 migrations 已进入本地 Worker E2E。当前候选的单设备、多设备和恢复证据统一见 [最终功能测评](final-functional-assessment.md)，不在协议文档复制历史版本结论。

## 认证

Android 使用与 Web 相同 OPAQUE server record，但客户端状态由 Rust/native 保存。移动端采用独立 finish 响应并返回短期 bearer session；Web 仍使用 HttpOnly cookie，行为不变。主密码会在 RN 安全输入控件的 JS 生命周期中短暂存在，并立即交给 native；它不得持久化、记录、进入 Context 或发送给 Worker。OPAQUE state 和 export key 不进入 JS 或日志。

session token 经平台安全存储保护后保存，具有绝对过期时间；空闲过期和 native wrapping 行为仍需 instrumented 证据。401 清除 session 并锁定；登出同时撤销服务器 session 和本地材料。Bearer 请求仍遵守 CSRF/重放防护和 HTTPS，不把 token 放 URL。证书 pinning 尚未作为已实现能力，不得在发布说明中宣称。

## 设备初始化与审批

首次启动生成 device id 和 X25519 keypair；私钥由 Keystore wrapping key 保护。服务端只接收 public key、fingerprint 和设备标签；当前协议未把 Android attestation 声明为已实现。设备处于 pending 时可登录但不能访问 vault 路由或获取 vault key。已批准设备使用 ECDH packet 解开 vault key，随后建立短期 native vault session。

`VaultLogin.androidAssociations` 可选保存 Android package name 与 signing certificate SHA-256；该字段本身随条目密文同步，服务端不可见。

## Room 模型

- `vault_ciphertexts`: item id、type、ciphertext envelope、item revision、tombstone。
- `sync_cursors`: server revision、cursor、last success、schema version。
- `pending_mutations`: id、operation、base revision、encrypted payload、retry state。
- `sync_conflicts`: local/remote encrypted reference、server revision、resolution state。
- `device_state`: 非秘密设备元数据和 wrapped-key reference。

所有 item 与队列写入使用事务。Room migration 必须可从任一已发布 schema 升级；失败时保留数据库并阻止覆盖。

当前数据库版本为 2；2026-07-16 的历史快照曾在 API 33–36 远程矩阵通过 v1/v2 schema JSON、显式 1→2 migration 和 MigrationTestHelper。当前及后续自动 Android 验证仅运行 API 36，`minSdk 26` 仍是安装兼容声明。后续 schema 变化仍必须由远程 Gradle/KAPT 生成、同步回本地、审查并重新同步测试；业务离线重启和队列重放仍是独立门禁。

## 同步

当前代码包含 pull、pending mutation、幂等 mutation id、冲突记录/决议和可见的同步反馈。网络恢复、解锁后和用户手动操作均可触发同步；失败保留 Room 队列，不静默丢弃。冲突策略保持四种：keep local、accept remote、create copy、skip。

恢复和设备密钥包不得进入普通 item 队列。云备份只包含版本化密文数据库/导出包，并明确排除 Keystore key；新设备必须通过恢复码或设备审批重新取得 vault key。

Recovery v2 已实现全设备丢失时的信任重建协议：客户端本地解开 recovery packet，使用包内派生的 Ed25519 key 对一次性 challenge、OPAQUE 新 registration record、新设备公钥/key packet 和下一代 recovery packet 的规范 transcript 签名；Worker 在单个 D1 batch 中消费 challenge、递增 `auth_epoch`、撤销旧 session/设备/key packet、登记唯一 approved replacement device 并轮换恢复材料。finish 只返回提交结果，客户端随后以新口令走正常 OPAQUE 登录取得 device-bound bearer；恢复码和 vault key 不发送到服务端。

该协议已有 Worker/shared/Rust/native/RN 源码与负向测试。`20260730T124911Z-e2e-local-91529-15360` 已覆盖清空应用数据后从服务端重建 replacement device、同步并解密原条目、轮换密码/恢复码和旧密码失效；`20260730T125747Z-e2e-multidevice-api36-94573-25141` 已覆盖跨设备删除以及恢复后旧批准设备失效。真实生产 D1、所有设备同时丢失和真实手机恢复仍是外部验收。v1/旧 `webcrypto-mvp` 恢复材料只能在已有认证会话中显式迁移，不能走匿名 Recovery v2。详见 `docs/recovery.md`。

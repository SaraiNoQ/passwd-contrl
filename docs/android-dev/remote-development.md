# Android 远程开发

Last updated: 2026-07-27

Android 工具链只存在于校园服务器。规范入口同时写入根目录 `AGENT.md`，两处冲突时采用更严格规则。

## 固定位置

| 用途 | 值 |
| --- | --- |
| SSH | `ssh root@campus-server` |
| 源码镜像 | `/root/dev/zero-vault` |
| 产物与日志 | `/root/dev/zero-vault-artifacts/<UTC timestamp>-<command>-<pid>-<nonce>/` |
| Compose project | `zero-vault-android` |
| 容器 / 镜像 | `zero-vault-android-dev` / `zero-vault/android-dev:sdk57` |

## 常用命令

```sh
pnpm mobile:remote:bootstrap
pnpm mobile:remote:shell
pnpm mobile:remote:doctor
pnpm mobile:remote:upgrade
pnpm mobile:remote:typecheck
pnpm mobile:remote:test:ui
pnpm mobile:remote:test
pnpm mobile:remote:sbom
pnpm mobile:remote:browser-cert
pnpm mobile:remote:build:debug
pnpm mobile:remote:instrumented
pnpm mobile:remote:emulator
pnpm mobile:remote:e2e
pnpm mobile:remote:e2e:local
pnpm mobile:remote:build:personal
pnpm mobile:remote:artifacts <personal-release-run-id>
```

`e2e` 使用宿主机私有配置连接隔离的 HTTPS E2E Worker；`e2e:local` 在校园服务器容器内启动临时本地 Worker，覆盖 API 36 业务流程和冷重启离线流程，其中 “local” 不表示在开发者本机运行。`browser-cert` 只提取 API 36 模拟器浏览器证书，不能替代个人设备证书。

`test:ui` 只运行 UI/i18n/theme/session-guard 相关的移动端单元测试；`test:targeted` 在同一远程容器中追加 Web legacy recovery 的协议分流、失败回滚和字段保真测试，适合本轮快速反馈；完整 `test` 仍覆盖 workspace、Rust、UniFFI 与 Android ABI。`artifacts` 是只读下载例外，只接受一次成功且非 stale 的 `personal-release` 精确 run id，并在服务器和本地分别验证校验和；`shell` 是显式交互例外。其他命令都会先执行 `scripts/mobile-remote-sync.sh`。`shell` 不做隐式同步，进入前应先显式运行同步或其他远程命令。同步失败即停止；不得手工绕过后继续用旧副本。`bootstrap` 构建镜像并安装 workspace 依赖；镜像固定内置最新版 API 36 system image。`sbom` 使用 pnpm、Cargo 与 Gradle 自身的依赖清单生成 CycloneDX 1.5 JSON，不安装额外扫描器；personal APK 门禁会在同一证据目录自动重生成 release classpath SBOM。模拟器与 instrumented 测试唯一入口固定为 API 36，不安装或启动旧 API。`minSdk 26` 仅是安装兼容声明，不构成 API 26/29/33/34/35 测试要求。

修改 `apps/mobile/package.json` 后必须先运行远程 `bootstrap`。该命令允许服务器容器解析依赖，并把 `pnpm-lock.yaml` 回传本地源码来源；审查回传差异后，必须再通过下一条远程命令重新 rsync，不能直接把 bootstrap 前或 lockfile 回传前的证据当作当前快照通过。本地仍不得运行 pnpm mobile typecheck/test 或任何 Android 工具。

## 当前快照远程状态

截至 2026-07-27，当前候选源码已在远程容器取得以下 API 36 证据：

- `20260726T204634Z-typecheck-52354-18464`：typecheck 通过。
- `20260726T204714Z-test-53041-11571`：完整测试通过，包含 OPAQUE Rust↔Serenity 互操作。
- `20260726T204816Z-instrumented-api36-53738-32409`：instrumented 28/28。
- `20260726T201932Z-e2e-multidevice-api36-51221-32507`：两个独立 AVD 的审批、key packet、双向同步、四种冲突动作与撤销通过。
- `20260726T214820Z-e2e-local-61682-20376`：恢复连续性通过，覆盖注册、同步哨兵、恢复、密码重置、新恢复码和恢复后解密本地旧密文；该版本未清空原 Room，不能单独证明灾难恢复。
- `20260730T124911Z-e2e-local-91529-15360`：clear-state 服务端灾难恢复、原密文解密、密码/恢复码轮换和旧密码拒绝通过。
- `20260730T125747Z-e2e-multidevice-api36-94573-25141`：强化双设备审批/同步/冲突/跨设备删除/撤销、replacement recovery 与旧设备失效通过。

最后已验证的个人签名制品为 `0.1.1 / versionCode 18`；`0.1.2 / versionCode 19` 仍是候选，不能在签名构建和覆盖升级完成前写成已交付。真实 Chrome Autofill、物理设备 API/Keystore/生物识别、文件选择器和服务器外加密 keystore 备份仍需外部验收，大备份、SAF 负向路径、Autofill 负向矩阵和长期压缩仍是后续门禁。下一次远程命令仍须先重新同步并按影响范围运行；模拟器与 instrumented 只使用 API 36，不启动 API 26/29/33/34/35。

2026-07-15 的环境记录显示校园服务器到 Docker Hub 的 TLS 不可用。Dockerfile 因此使用 DaoCloud 公共代理并固定 Ubuntu 26.04 manifest digest；这是历史环境事实，重建前仍应由 `bootstrap` 结果重新确认。升级基础镜像时必须核验 digest，禁止使用浮动代理标签。

## 同步安全

同步只允许从本地仓库到专用镜像，且 `--delete-delay` 的目标必须保持为 `/root/dev/zero-vault`。排除 Git、`.env*`（保留 `.env.example`）、密钥/token、真实 vault、恢复码、production session、`node_modules`、Gradle/Cargo target、prebuild 目录、日志和模拟器数据。仓库根部受版本控制的 `.npmrc` 是依赖解析配置，会在确认不含内联 registry 凭据后同步；其他 `.npmrc` 继续排除。同步前还会清除专用镜像中遗留的 secret 文件或同名 symlink，避免 rsync exclude 把旧 secret 保护下来。

本地备份页面生成的文件名以 `vault-export-` 开头，匹配同步脚本的排除/远端清理规则。无论文件是否已经认证加密，真实备份都只能留在用户选择的个人存储位置，不得复制到仓库、`/root/dev/zero-vault`、`/root/dev/zero-vault-artifacts` 或测试日志；远程验证只能临时使用合成密码库并在流程结束销毁文件本体。

远程生成但要纳入源码的文件，先单独 rsync 回本地、审查 diff，再进行下一轮同步。当前 build/instrumented 包装器要求 Room `2.json` 存在、非空且声明 database version 2，才允许回传成功；首次生成会改变本地源码指纹，必须重新同步并重跑候选门禁。不得直接在远端维护长期分支。

同步脚本在传输前后计算本地源码指纹（Git commit、tracked diff 和 untracked 内容）；指纹变化或远端记录不匹配时命令 fail closed，禁止把旧镜像结果当作当前源码结果。同步与远程命令使用专用锁，防止两个任务同时删除镜像、覆盖 manifest/lockfile 或混写产物。证据目录追加 PID 与随机 nonce，避免同一秒内的同名重跑覆盖历史证据。

## 资源隔离

容器不挂载 Docker socket、不公开网络端口，只绑定专用源码镜像、产物目录、宿主机 `/root/dev/zero-vault-android-secrets`（容器内只读 `/run/zero-vault-secrets`）和 `zero-vault-*` 命名卷；Compose 限制 16 CPU、32 GiB 内存和 4 GiB shared memory，并只透传 `/dev/kvm`。不得改动或复用 `music-ai-*` 等其他项目的容器、卷和目录。每次运行前后都记录服务器容器状态用于干扰检查。

## 缓存与产物

Gradle、pnpm、Cargo registry、Rust target 和 API 36 AVD 使用 `zero-vault-*` 命名卷；产物目录绑定到容器 `/artifacts`。API 36 模拟器每次以 wipe-data、禁用 snapshot 的干净状态启动。每次运行至少生成 `sync.txt`、`command.sh`、`output.log`、`exit-code.txt`、`stale.txt`、`image-id.txt`、`containers-before.txt`、`containers-after.txt` 和 `SHA256SUMS`。运行前已有业务容器在结束时必须仍运行，带 healthcheck 的容器必须为 `healthy`；Android 构建不得干扰其他服务。命令特有 APK、测试报告和校验和也必须留在同一目录；SBOM 目录额外包含 CycloneDX JSON、依赖清单和独立 `SHA256SUMS`。完整判定规则见 [质量与个人分发](quality-release.md#证据判定规则)。personal release APK 没有有效签名配置时必须失败。

个人签名使用宿主机外置 `/root/dev/zero-vault-android-secrets/release.env` 和 `release.keystore`，两者不得通过 rsync。文件权限必须为 400 或 600；`release.env` 中的 keystore 路径必须写容器路径 `/run/zero-vault-secrets/release.keystore`，并提供负责人确认的真实 HTTPS API，以及经个人设备核验、`apps` 非空的 `ZERO_VAULT_ANDROID_PRIVILEGED_CALLERS_JSON`。环境变量契约见 `infra/android/release.env.example`，其中示例 package/全零 cert 不可分发。keystore 必须备份到服务器外的加密目的地。

可选 Play 轨道使用完全独立的宿主机目录
`/root/dev/zero-vault-play-secrets`、`upload.keystore` 和 `release.env`，不得复用
personal keystore，也不得挂载到开发容器。修改 Dockerfile 或固定 signer 后必须先
运行 `pnpm mobile:remote:bootstrap`；随后 `pnpm mobile:remote:build:play`
才会在隔离容器中签名并下载验证 AAB、mapping、native symbols 和 SBOM。
当前尚无真实 Play 凭据或成功 `play-aab` run，因此这只是可复现流水线，不是
商店构建证据。

完整业务 E2E 还需要宿主机私有文件 `/root/dev/zero-vault-android-secrets/e2e.env`（权限 400 或 600）。格式见 `infra/android/e2e.env.example`；目标必须是名称明确包含 `e2e`、`test`、`testing` 或 `staging` 的隔离 HTTPS Worker，并设置 `ZERO_VAULT_E2E_CONFIRM_DESTRUCTIVE=YES`。脚本会创建和恢复合成账户，缺少该确认时按门禁失败。

## 故障恢复

1. 先读最新 `output.log` 和 `exit-code.txt`。
2. 用 `docker compose -p zero-vault-android -f infra/android/compose.yml ps` 检查容器。
3. 用 `docker ps` 确认 `music-ai-*` 等既有业务仍健康。
4. 镜像问题可重跑 `bootstrap`；源码问题回本地修改后重新同步。
5. 磁盘不足只报告 `docker system df`、卷和镜像占用。未经确认禁止 `docker system prune` 或删除其他项目资源。

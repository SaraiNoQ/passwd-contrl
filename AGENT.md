# AGENT.md

## Tool usage policy

Prefer Claude Code native tools over Bash for source edits. If a Bash command is blocked or asks for permission because it writes files, rewrite the action using Write/Edit/MultiEdit instead of asking the user to approve the Bash command.

- Use Read/Grep/Glob for code inspection instead of Bash `cat`, `grep`, `find`, or `sed` when possible.
- Use Write/Edit/MultiEdit for creating or modifying source files.
- Do not use Bash heredocs such as `cat > file <<EOF`, `tee file <<EOF`, or shell redirection to write source files.
- Do not use `sed -i`, `perl -pi`, `python - <<EOF`, or `node - <<EOF` to modify source files unless explicitly requested.
- Use Bash mainly for project commands: typecheck, tests, builds, package manager commands, process inspection, and local server control.
- If a shell command would require manual approval, first try an equivalent native tool operation.

## Project Mission

Build a zero-knowledge password storage and autofill application. The first release targets Web Vault, Chrome/Edge browser extension, and encrypted cloud sync. Android, iOS, and macOS clients must reuse the same cryptographic model and Rust core where practical.

## Non-Negotiable Security Rules

- Never send, log, persist, or expose a user's master password.
- Never add a server-side path that can decrypt vault item contents.
- Never store imported browser CSV data, plaintext passwords, recovery codes, or derived keys in repo fixtures, logs, telemetry, screenshots, crash reports, or local temp files.
- Never silently autofill. Autofill requires an explicit user action after origin matching.
- Never fill hidden fields, invisible fields, cross-origin iframes, non-HTTPS pages, or fields whose purpose cannot be identified.
- Never implement custom cryptography when a maintained, reviewed primitive or protocol library is available.
- Treat any change to key derivation, encryption, sync conflict handling, import, recovery, or autofill as security-sensitive.

## Item-Level Sync Protocol Rules

- Each vault item must be encrypted with its own item key before sync.
- The `baseItemRevision` field must be included in every upsert for conflict detection.
- Conflicts must be resolved by the user, not automatically overwritten.
- The server must never receive plaintext item data, even during conflict resolution.
- Whole-envelope sync remains supported for backward compatibility but must not be the default for new vaults.

## Recovery Code Security Rules

- Recovery codes must be generated from 256 bits of cryptographically secure random data.
- Recovery codes must be base64url encoded.
- Recovery codes must never be sent to the server at any point (setup, storage, or recovery).
- Recovery packets must be encrypted with a key derived from the code via Argon2id.
- The server must store only the encrypted recovery packet.
- Users must be instructed to store recovery codes offline (paper, safe).

## Device Trust Security Rules

- Each device must generate its own X25519 ECDH keypair.
- The device private key must never leave the device.
- New device registration must require explicit approval from an existing trusted device.
- The server must store only the encrypted vault key per device, not the vault key itself.
- Device revocation must immediately remove the encrypted vault key from the server.
- Compromising one device's private key must not expose the vault key on other devices.

## Extension Phishing Protection Rules

- Fill only on exact HTTPS origin matches.
- Similar-origin domains must be classified as suspicious and blocked from auto-fill.
- The origin classification (exact, similar, suspicious) must be visible to the user before any fill action.
- Field visibility must be re-checked immediately before fill to guard against DOM mutations.
- Cross-origin iframe fills must be blocked regardless of field visibility.
- Extension permissions must be minimal; permission changes require review in `docs/autofill.md`.

## Required Review Updates

When changing security-sensitive behavior, update all relevant docs and tests:

- `docs/security-model.md`
- `docs/threat-model.md`
- `docs/autofill.md`
- `docs/import.md`
- `docs/sync-protocol.md`
- `docs/recovery.md`
- `docs/device-trust.md`
- Unit or integration tests that exercise the changed risk boundary

## Architecture Defaults

- Monorepo uses pnpm workspaces for TypeScript packages.
- `apps/web` is the Web Vault.
- `apps/worker-api` is the Cloudflare Worker sync API and must store encrypted blobs only.
- `apps/extension` is the Manifest V3 browser extension.
- `apps/desktop` is the macOS Desktop App (Tauri 2.x). See `docs/mac-dev/` for specs.
- `packages/shared` owns DTOs and validation schemas.
- `crates/crypto-core` owns KDF and AEAD primitives.

## Mandatory Android Remote Development

All Android/mobile build and verification work runs on the dedicated campus server. This is a hard project boundary, not a convenience:

- Local work is limited to source/document editing, diff review, and the provided SSH/rsync wrappers.
- Never install or run a local Android SDK, JDK, Gradle, NDK, Android Emulator, Android Rust target, Maestro, `expo run:android`, or mobile typecheck/test command.
- Connect with `ssh root@campus-server` and use only the project container `zero-vault-android-dev` managed by `infra/android/compose.yml`.
- Before every mobile compile or test, run the sync wrapper. If sync fails, stop; never verify an older remote copy.
- Remote source is an ephemeral mirror at `/root/dev/zero-vault`. Local Git remains the source of truth.
- Remote reports and binaries live outside the mirror at `/root/dev/zero-vault-artifacts`.
- Never sync `.env*` or `*.env` (except committed `*.env.example` templates), tokens, signing keys, recovery codes, real vaults, production sessions, dependency folders, build output, Cargo targets, or emulator user data.
- Rsync deletion is allowed only inside `/root/dev/zero-vault`; never reuse that command for another server path.
- Never run `docker system prune` automatically. Report disk pressure and request approval before any destructive cleanup.
- Starting with `0.1.1 (versionCode 18)`, every personal release APK that contains formal modifications and is distributed for inspection must increment both Expo `version` (Android `versionName`) and the remote `ZERO_VAULT_ANDROID_VERSION_CODE`. Never overwrite or rebuild a distributed version tuple with different source.
- Do not edit the same source independently on local and remote. Copy back any intentional remote-generated source before continuing locally.
- Run Android emulator and instrumented coverage only on the latest Android API supported by the pinned SDK (currently API 36). Do not run API 26, 29, 33, 34, or 35 compatibility matrices unless the user explicitly changes this rule; `minSdk 26` is an install-compatibility declaration, not a test requirement.
- Android distribution targets the user's own devices through a long-lived personal release keystore and signed APK. Play service accounts, AAB, internal tracks, and store upload are not completion gates.
- Keep the personal keystore outside Git and rsync, back it up encrypted offline, and reuse it for every upgrade. A debug APK cannot be upgraded in place to the differently signed personal APK; preserve a recovery code or another trusted approving device before uninstalling debug data.
- Personal-device installation uses the Android system package installer from a transferred APK; never require a local Android toolchain or `adb`.

Canonical commands are `pnpm mobile:remote:*`; see `docs/android-dev/remote-development.md`.
Root `pnpm test` and `pnpm typecheck` deliberately exclude `@zero-vault/mobile`; use the remote commands for mobile coverage.

## Desktop Development Documentation

macOS desktop development specs are in `docs/mac-dev/`:

| Document | Purpose |
| --- | --- |
| `docs/mac-dev/overview.md` | 项目概述、目标边界、框架选择分析 (Tauri vs Electron)、技术栈、文档索引 |
| `docs/mac-dev/architecture.md` | 架构设计、数据流、Tauri command 桥接模式、目录结构 |
| `docs/mac-dev/adapters.md` | adapter 模式：CryptoAdapter、SecureStore、CiphertextStore、ApiClient、SyncService |
| `docs/mac-dev/code-sharing.md` | 与 Web/shared 的代码复用规则和隔离边界 |
| `docs/mac-dev/macos-platform.md` | macOS 平台规范：Keychain、窗口管理、菜单栏、签名公证、安全特性、字体 |
| `docs/mac-dev/ui-interaction.md` | 信息架构、页面结构、交互规范、视觉风格 |
| `docs/mac-dev/sync-conflict.md` | 同步策略与冲突解决 |
| `docs/mac-dev/security.md` | 安全规范（继承 AGENT.md + 桌面端特有规则） |
| `docs/mac-dev/development-phases.md` | 开发阶段规划（Phase 0-7） |
| `docs/mac-dev/quality.md` | PR 验收门槛与文档更新规则 |

## Coding Standards

- TypeScript must be strict and use schema validation at external boundaries.
- Rust crypto code must include tamper, wrong-key, and nonce tests.
- Prefer explicit names over clever abstractions.
- Keep public APIs small and documented.
- Add comments only where they clarify a security boundary or non-obvious decision.

## Development Checks

The commands below are the generic non-Android checks. For any Android/mobile change, do not run them locally as a substitute for coverage; use the `pnpm mobile:remote:*` sequence above, which also runs the required shared/Worker/Web/Rust regressions inside the campus-server container.

Run before handing off changes:

```sh
npx pnpm typecheck
npx pnpm test
cargo test --manifest-path crates/crypto-core/Cargo.toml
```

If dependencies are not installed yet, run `npx pnpm install` and then retry. Do not bypass failing security tests.

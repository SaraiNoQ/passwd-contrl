# Recovery

Last updated: 2026-06-04

## Overview

Recovery codes allow a user to regain access to their vault without the master password. The recovery system is designed so that the server cannot decrypt the vault without the user's recovery code.

## Recovery Code Generation

1. The client generates 256 bits of cryptographically secure random data.
2. The random data is encoded as a base64url string (the "recovery code").
3. The recovery code is displayed to the user exactly once during setup.
4. The user is prompted to write the code on paper and store it offline.

The recovery code is never sent to the server at any point.

## Recovery Packet Creation

When the user sets up recovery:

1. The recovery code is fed through a KDF to derive a recovery key.
2. The recovery key encrypts the vault key, producing a recovery packet.
3. The recovery packet is sent to the server for storage.
4. The server stores only the encrypted recovery packet; it cannot decrypt it without the recovery key.

The recovery packet is bound to the user's account and stored alongside other encrypted server data.

### Dual-Runtime Recovery Crypto

The recovery KDF and cipher depend on the crypto runtime:

**`crypto-core-wasm` (Rust):**
- KDF: Argon2id v1.3 with domain-separation salt `"zero-vault-recovery-v1"`.
- Cipher: XChaCha20-Poly1305 with AAD `"zero-vault:recovery:v1"`.
- Source: `crates/crypto-core` `derive_recovery_key`, `encrypt_recovery_packet`, `decrypt_recovery_packet`.

**`webcrypto-mvp` (Web Crypto API, current Web Vault default for recovery):**
- KDF: PBKDF2-SHA256 with 600,000 iterations and salt `"zero-vault-recovery-salt"`.
- Cipher: AES-256-GCM with AAD `"zero-vault.recovery.v1"`.
- Source: `apps/web/lib/recovery.ts`.

The Web Vault currently uses the `webcrypto-mvp` path for recovery regardless of vault runtime. The Rust `crypto-core-wasm` recovery functions are available but not yet integrated into the Web Vault recovery flow.

## Recovery Flow

When a user needs to recover access:

1. The user enters their recovery code in the Web Vault.
2. The client derives the recovery key from the code via the active recovery KDF.
3. The client fetches the recovery packet from the server.
4. The client decrypts the recovery packet using the recovery key, recovering the vault key.
5. The vault is unlocked with the recovered vault key.
6. The user can optionally set a new master password, which re-wraps the vault key.

The server sees only the fetch request for the recovery packet. It never sees the recovery code or the derived recovery key.

## Security Properties

- **Server cannot decrypt:** The recovery packet is encrypted with a key derived from the recovery code. Without the code, the packet is indistinguishable from random data.
- **Code never transmitted:** The recovery code stays on the client. It is not sent during setup, storage, or recovery.
- **Offline storage recommended:** The code should be written on paper and stored in a physically secure location (safe, lockbox). Digital copies increase the risk of compromise.
- **Code rotation:** If a user suspects their recovery code has been compromised, they can generate a new one. This creates a new recovery packet and invalidates the old one.

## Backup Recommendation

Write the recovery code on paper. Store it in a physically secure location separate from the device. Do not store the code in:

- Email.
- Cloud storage.
- Notes apps.
- Screenshots.
- Password managers (the code is for recovering the password manager itself).

If the recovery code is lost and the master password is forgotten, the vault cannot be recovered. This is by design; there is no server-side backdoor.

# Device Trust

## Standalone browser extension (2026-10-03)

Extension login validates the claimed SHA-256 public-key fingerprint. For display, the device-list/self routes also derive 64-hex SHA-256 fingerprints from the actual public key rather than trusting registration metadata, so legacy registration routes cannot spoof the fingerprint shown for approval. Valid native SHA-256 fingerprints remain unchanged; legacy non-SHA installation identifiers remain compatible.

Each extension installation generates an X25519 keypair, UUID, random device credential and SHA-256 public-key fingerprint. Existing-account OPAQUE login registers it pending via `/auth/extension/login/finish`; a trusted Web/mobile device must approve and share the account vault key. The extension verifies the packet's recipient device ID and public key before decrypting. Its private key never travels to the server and is encrypted locally after approval. Connection setup is session-only until the local master password is set, so a browser restart during setup requires starting again. A fresh OPAQUE login with the persisted device credential renews an expired cloud session; local offline unlock uses only the local password. Revocation invalidates online access and clears volatile extension access on the next unauthorized response, while preexisting encrypted offline copies remain local.

Last updated: 2026-10-03

> Android/Worker code now contains Keystore-wrapped device material, device-bound bearer sessions, approval/key sharing, revocation and Recovery v2 replacement-device trust rebuilding, but they are not remotely integrated or verified on the current source snapshot.

## Overview

Device trust allows multiple devices to access the same vault without sending the master password or vault key to the server. Each device has its own keypair, and new devices require approval from an existing trusted device.

## Device Keypair Generation

When a device first registers:

1. The device generates an X25519 ECDH keypair.
2. The private key is stored locally on the device (e.g., in the OS keychain or encrypted local storage).
3. The public key is sent to the server as part of device registration.

The private key never leaves the device.

In the Android implementation, the device private key is stored only as a Keystore-wrapped blob and is never returned to React Native. Hardware-backed/StrongBox behavior still requires device evidence. A pending Android device may authenticate only to the restricted status/logout surface and cannot receive the encrypted vault key until an approved device shares it. Keystore invalidation requires recovery or re-approval; there is no plaintext fallback.

## Device Registration Flow

1. A new device (e.g., a new browser or phone) generates its X25519 keypair.
2. The device sends its public key and a device label (e.g., "Chrome on MacBook") to the server.
3. The server records the device as "pending approval."
4. An existing trusted device is notified of the pending request.

## Approval Flow

The server-side API implements register, approve, reject, and revoke endpoints (`/devices`, `/devices/:id/approve`, `/devices/:id/reject`, `/devices/:id/revoke`). The server stores device records with `status: pending | approved | rejected | revoked`.

**Rust crypto-core ECDH flow (integrated into Web Vault):**
1. The approving device performs X25519 ECDH with the new device's public key to derive a shared secret.
2. The approving device encrypts the vault key with the shared secret via HKDF + XChaCha20-Poly1305.
3. The encrypted vault key is sent to the server, associated with the new device's ID.
4. The new device can decrypt it with its private key (see `encrypt_for_device`, `decrypt_on_device` in `crates/crypto-core`).

**Joining an existing account from Web:**
1. Expand “连接已有账户” on the locked page and enter the account credentials plus a browser-local unlock password.
2. `/auth/web/login/finish` validates a persisted device credential and rotates its session, returning an HttpOnly cookie instead of a bearer token. Device credentials and private keys stay in IndexedDB.
3. Pending browser sessions can only read account/self status or log out. Compare the full browser fingerprint on the approving phone.
4. An unlocked trusted phone or browser approves the device with a structured X25519 encrypted vault-key packet. Approval and key installation are atomic on the server.
5. The browser decrypts its packet locally, wraps the shared vault key with its local password, and pulls item-level changes. A nonempty local vault is never replaced by this flow.

Existing Web accounts retain legacy cookie login compatibility. New joining browsers use device-bound cookies; revoked/rejected/missing devices invalidate them. Revocation stops server access and does not remotely erase previously downloaded offline data.

## Using a Trusted Device

Once trusted, a device can:

1. Fetch its encrypted vault key from the server.
2. Decrypt the vault key locally using its X25519 private key.
3. Unlock the vault without re-entering the master password.
4. Sync vault items using the standard sync protocol.

## Revocation

To revoke a device:

1. An existing trusted device initiates revocation for the target device ID.
2. The server deletes the encrypted vault key associated with that device.
3. The revoked device can no longer fetch or decrypt the vault key.
4. Any active sessions on the revoked device are invalidated.

Revocation does not require the revoked device to be online. The server-side deletion is immediate.

## Security Properties

- **Server cannot decrypt:** The server stores encrypted vault keys per device. Without the device's private key, the encrypted key is useless.
- **Per-device isolation:** Compromising one device's private key does not expose the vault key on other devices.
- **Approval required:** New devices cannot access the vault without explicit approval from an existing trusted device.
- **Immediate revocation:** Removing a device's access is a server-side operation that takes effect immediately.

## Open Considerations

- If all trusted devices are lost, Recovery v2 uses a one-time Ed25519 proof derived from the encrypted recovery packet to atomically revoke old trust and register one approved replacement device. The source path is implemented, but total-device-loss support remains a release gate until current-snapshot remote D1, replay/expiry, OPAQUE and end-to-end evidence exists.
- The approval flow currently requires one approving device. Multi-device approval (e.g., requiring 2 of 3 devices) is a potential future enhancement.
- Device labels are informational only and are not verified cryptographically.

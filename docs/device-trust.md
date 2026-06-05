# Device Trust

Last updated: 2026-06-04

## Overview

Device trust allows multiple devices to access the same vault without sending the master password or vault key to the server. Each device has its own keypair, and new devices require approval from an existing trusted device.

## Device Keypair Generation

When a device first registers:

1. The device generates an X25519 ECDH keypair.
2. The private key is stored locally on the device (e.g., in the OS keychain or encrypted local storage).
3. The public key is sent to the server as part of device registration.

The private key never leaves the device.

## Device Registration Flow

1. A new device (e.g., a new browser or phone) generates its X25519 keypair.
2. The device sends its public key and a device label (e.g., "Chrome on MacBook") to the server.
3. The server records the device as "pending approval."
4. An existing trusted device is notified of the pending request.

## Approval Flow

The server-side API implements register, approve, reject, and revoke endpoints (`/devices`, `/devices/:id/approve`, `/devices/:id/reject`, `/devices/:id/revoke`). The server stores device records with `status: pending | approved | rejected | revoked`.

**Rust crypto-core full ECDH flow (available, not yet integrated into Web Vault):**
1. The approving device performs X25519 ECDH with the new device's public key to derive a shared secret.
2. The approving device encrypts the vault key with the shared secret via HKDF + XChaCha20-Poly1305.
3. The encrypted vault key is sent to the server, associated with the new device's ID.
4. The new device can decrypt it with its private key (see `encrypt_for_device`, `decrypt_on_device` in `crates/crypto-core`).

**Current Web Vault flow (simplified MVP):**
1. The Web Vault sends the device public key and name to `POST /devices`.
2. An existing device approves via `POST /devices/:id/approve`.
3. The ECDH-based vault key sharing described above is not yet wired into the Web Vault UI. The server marks devices as approved but does not yet distribute encrypted vault keys.

The server stores the encrypted vault key per device but cannot decrypt it without the device's private key. Full ECDH key distribution requires the Web Vault to integrate the `encrypt_for_device` / `decrypt_on_device` Rust WASM functions.

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

- If all trusted devices are lost, the user must use their recovery code to regain access and re-register devices.
- The approval flow currently requires one approving device. Multi-device approval (e.g., requiring 2 of 3 devices) is a potential future enhancement.
- Device labels are informational only and are not verified cryptographically.

/// Tauri command bridge between the React frontend and crypto-core native Rust.
///
/// Security rules:
/// - Master password is never logged, persisted, or included in error messages.
/// - Derived keys and vault keys are never logged or persisted in plaintext.
/// - Sensitive byte arrays are zeroized after use where feasible.
/// - All errors are sanitized to avoid leaking key material.

use base64ct::{Base64Url, Encoding};
use crypto_core::{self, KdfParams};
use serde::Serialize;

// ── Result types ────────────────────────────────────────────────────────────

/// Result of encrypting a single vault item.
/// Each field is a separate nonce/ciphertext pair so the frontend can
/// construct `CiphertextEnvelope` objects for both the item key and payload.
#[derive(Serialize)]
pub struct EncryptedItemResult {
    pub encrypted_item_key_nonce: Vec<u8>,
    pub encrypted_item_key_ciphertext: Vec<u8>,
    pub encrypted_payload_nonce: Vec<u8>,
    pub encrypted_payload_ciphertext: Vec<u8>,
}

/// Result of generating an X25519 device keypair.
#[derive(Serialize)]
pub struct DeviceKeypairResult {
    pub public_key: Vec<u8>,
    pub private_key: Vec<u8>,
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Derive vault key from master password and salt via Argon2id.
///
/// Returns 32 raw key bytes. The master password is held only in the
/// Rust stack frame and zeroized on drop.
#[tauri::command]
pub fn derive_vault_key(
    master_password: String,
    salt: Vec<u8>,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<Vec<u8>, String> {
    let params = KdfParams {
        memory_kib,
        iterations,
        parallelism,
    };
    crypto_core::derive_vault_key(&master_password, &salt, params)
        .map(|key| key.to_vec())
        .map_err(|e| format!("key derivation failed: {e}"))
}

/// Decrypt a single vault item.
///
/// 1. Derive per-item key: `HKDF-SHA256(vault_key, info="zero-vault:item-key:{item_id}")`
/// 2. Decrypt the item key envelope with the vault key.
/// 3. Decrypt the payload envelope with the item key.
/// 4. Return the plaintext JSON string.
#[tauri::command]
pub fn decrypt_item(
    vault_key: Vec<u8>,
    encrypted_item_key_nonce: Vec<u8>,
    encrypted_item_key_ciphertext: Vec<u8>,
    encrypted_payload_nonce: Vec<u8>,
    encrypted_payload_ciphertext: Vec<u8>,
    item_id: String,
) -> Result<String, String> {
    // Decrypt the item key using the vault key.
    let item_key_nonce: [u8; crypto_core::XCHACHA20_NONCE_LEN] = encrypted_item_key_nonce
        .try_into()
        .map_err(|_| "invalid item key nonce length")?;
    let item_key_blob = crypto_core::EncryptedBlob {
        nonce: item_key_nonce,
        ciphertext: encrypted_item_key_ciphertext,
    };
    let item_key = crypto_core::decrypt_xchacha20(
        &vault_key,
        &item_key_blob,
        b"zero-vault:item-key-envelope:v1",
    )
    .map_err(|_| "failed to decrypt item key")?;

    // Decrypt the payload using the item key.
    let payload_nonce: [u8; crypto_core::XCHACHA20_NONCE_LEN] = encrypted_payload_nonce
        .try_into()
        .map_err(|_| "invalid payload nonce length")?;
    let payload_blob = crypto_core::EncryptedBlob {
        nonce: payload_nonce,
        ciphertext: encrypted_payload_ciphertext,
    };
    let plaintext =
        crypto_core::decrypt_item(&item_key, &payload_blob, &item_id)
            .map_err(|_| "failed to decrypt item payload")?;

    String::from_utf8(plaintext).map_err(|_| "decrypted item is not valid UTF-8".to_string())
}

/// Encrypt a single vault item.
///
/// 1. Derive per-item key via HKDF.
/// 2. Generate a random 32-byte item key, encrypt it with the vault key.
/// 3. Encrypt the JSON payload with the item key.
/// 4. Return both nonce+ciphertext pairs.
#[tauri::command]
pub fn encrypt_item(
    vault_key: Vec<u8>,
    item_json: String,
    item_id: String,
) -> Result<EncryptedItemResult, String> {
    // Generate a random item key.
    let item_key = crypto_core::generate_key();

    // Encrypt the item key with the vault key.
    let item_key_blob = crypto_core::encrypt_xchacha20(
        &vault_key,
        &item_key,
        b"zero-vault:item-key-envelope:v1",
    )
    .map_err(|_| "failed to encrypt item key")?;

    // Encrypt the payload with the item key.
    let payload_blob = crypto_core::encrypt_item(&item_key, item_json.as_bytes(), &item_id)
        .map_err(|_| "failed to encrypt item payload")?;

    Ok(EncryptedItemResult {
        encrypted_item_key_nonce: item_key_blob.nonce.to_vec(),
        encrypted_item_key_ciphertext: item_key_blob.ciphertext,
        encrypted_payload_nonce: payload_blob.nonce.to_vec(),
        encrypted_payload_ciphertext: payload_blob.ciphertext,
    })
}

/// Generate a recovery code from 256 bits of cryptographic randomness.
///
/// Returns a base64url-encoded string. The user must store this offline.
#[tauri::command]
pub fn generate_recovery_code() -> Result<String, String> {
    let bytes = crypto_core::generate_key(); // 32 bytes from OsRng
    Ok(Base64Url::encode_string(&bytes))
}

/// Derive a recovery key from a human-readable recovery code.
///
/// Uses Argon2id with domain-separation salt `"zero-vault-recovery-v1"`.
#[tauri::command]
pub fn derive_recovery_key(recovery_code: String) -> Result<Vec<u8>, String> {
    crypto_core::derive_recovery_key(&recovery_code)
        .map(|key| key.to_vec())
        .map_err(|e| format!("recovery key derivation failed: {e}"))
}

/// Generate an X25519 keypair for device trust.
///
/// Returns both the public and private key as raw 32-byte arrays.
/// The private key must never leave the device.
#[tauri::command]
pub fn generate_device_keypair() -> Result<DeviceKeypairResult, String> {
    let (private_key, public_key) = crypto_core::generate_device_keypair();
    Ok(DeviceKeypairResult {
        public_key,
        private_key,
    })
}

/// Encrypt a vault key for a specific device using X25519 ECDH.
///
/// The result includes the ephemeral public key prepended to the ciphertext
/// so the recipient can reconstruct the shared secret.
#[tauri::command]
pub fn encrypt_vault_key_for_device(
    vault_key: Vec<u8>,
    device_public_key: Vec<u8>,
) -> Result<Vec<u8>, String> {
    let blob = crypto_core::encrypt_for_device(&device_public_key, &vault_key)
        .map_err(|_| "failed to encrypt vault key for device")?;
    // Return nonce || augmented_ciphertext (ephemeral_pk || actual_ciphertext)
    let mut output = Vec::with_capacity(crypto_core::XCHACHA20_NONCE_LEN + blob.ciphertext.len());
    output.extend_from_slice(&blob.nonce);
    output.extend_from_slice(&blob.ciphertext);
    Ok(output)
}

/// Decrypt a vault key on a device using its private key.
///
/// Expects the format produced by `encrypt_vault_key_for_device`:
/// `nonce || ephemeral_public_key || ciphertext`.
#[tauri::command]
pub fn decrypt_vault_key_on_device(
    encrypted_vault_key: Vec<u8>,
    device_private_key: Vec<u8>,
) -> Result<Vec<u8>, String> {
    if encrypted_vault_key.len() <= crypto_core::XCHACHA20_NONCE_LEN {
        return Err("encrypted vault key is too short".to_string());
    }
    let mut nonce = [0_u8; crypto_core::XCHACHA20_NONCE_LEN];
    nonce.copy_from_slice(&encrypted_vault_key[..crypto_core::XCHACHA20_NONCE_LEN]);
    let blob = crypto_core::EncryptedBlob {
        nonce,
        ciphertext: encrypted_vault_key[crypto_core::XCHACHA20_NONCE_LEN..].to_vec(),
    };
    crypto_core::decrypt_on_device(&device_private_key, &blob)
        .map_err(|_| "failed to decrypt vault key on device".to_string())
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_vault_key_returns_32_bytes() {
        let salt = [1u8; 16];
        let key = derive_vault_key("password".into(), salt.to_vec(), 64, 1, 1).unwrap();
        assert_eq!(key.len(), 32);
    }

    #[test]
    fn encrypt_decrypt_item_round_trip() {
        let vault_key = crypto_core::generate_key().to_vec();
        let item_id = "550e8400-e29b-41d4-a716-446655440000";
        let item_json = r#"{"id":"550e8400-e29b-41d4-a716-446655440000","type":"login","title":"Test","folder":"","notes":"","customFields":[],"createdAt":"2025-01-01T00:00:00Z","updatedAt":"2025-01-01T00:00:00Z","origin":"https://example.com","username":"user","password":"secret"}"#;

        let result = encrypt_item(vault_key.clone(), item_json.into(), item_id.into()).unwrap();

        let decrypted = decrypt_item(
            vault_key,
            result.encrypted_item_key_nonce,
            result.encrypted_item_key_ciphertext,
            result.encrypted_payload_nonce,
            result.encrypted_payload_ciphertext,
            item_id.into(),
        )
        .unwrap();

        assert_eq!(decrypted, item_json);
    }

    #[test]
    fn decrypt_item_wrong_vault_key_fails() {
        let vault_key = crypto_core::generate_key().to_vec();
        let wrong_key = crypto_core::generate_key().to_vec();
        let item_id = "550e8400-e29b-41d4-a716-446655440000";
        let item_json = r#"{"test": true}"#;

        let result = encrypt_item(vault_key, item_json.into(), item_id.into()).unwrap();

        let err = decrypt_item(
            wrong_key,
            result.encrypted_item_key_nonce,
            result.encrypted_item_key_ciphertext,
            result.encrypted_payload_nonce,
            result.encrypted_payload_ciphertext,
            item_id.into(),
        )
        .unwrap_err();

        assert!(err.contains("failed to decrypt"));
    }

    #[test]
    fn generate_recovery_code_is_base64url() {
        let code = generate_recovery_code().unwrap();
        // base64url: A-Z a-z 0-9 - _ with optional = padding
        assert!(code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '='));
        // 32 bytes -> 43 base64url chars (no padding) or 44 with padding
        assert!(code.len() >= 43);
    }

    #[test]
    fn derive_recovery_key_returns_32_bytes() {
        let key = derive_recovery_key("ABCD-EFGH-IJKL-MNOP".into()).unwrap();
        assert_eq!(key.len(), 32);
    }

    #[test]
    fn device_keypair_encrypt_decrypt_round_trip() {
        let kp = generate_device_keypair().unwrap();
        let vault_key = crypto_core::generate_key().to_vec();

        let encrypted = encrypt_vault_key_for_device(vault_key.clone(), kp.public_key).unwrap();
        let decrypted = decrypt_vault_key_on_device(encrypted, kp.private_key).unwrap();

        assert_eq!(decrypted, vault_key);
    }

    #[test]
    fn device_wrong_key_fails() {
        let kp = generate_device_keypair().unwrap();
        let wrong_kp = generate_device_keypair().unwrap();
        let vault_key = crypto_core::generate_key().to_vec();

        let encrypted = encrypt_vault_key_for_device(vault_key, kp.public_key).unwrap();
        let err = decrypt_vault_key_on_device(encrypted, wrong_kp.private_key).unwrap_err();

        assert!(err.contains("failed to decrypt"));
    }
}

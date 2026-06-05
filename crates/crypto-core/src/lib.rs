use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use sha2::Sha256;
use thiserror::Error;
use wasm_bindgen::prelude::*;
use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};

pub const KEY_LEN: usize = 32;
pub const XCHACHA20_NONCE_LEN: usize = 24;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CryptoError {
    #[error("invalid argon2 parameters")]
    InvalidKdfParams,
    #[error("encryption failed")]
    EncryptFailed,
    #[error("decryption failed")]
    DecryptFailed,
    #[error("invalid key length")]
    InvalidKeyLength,
    #[error("invalid nonce length")]
    InvalidNonceLength,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncryptedBlob {
    pub nonce: [u8; XCHACHA20_NONCE_LEN],
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            memory_kib: 19456,
            iterations: 2,
            parallelism: 1,
        }
    }
}

pub fn generate_salt() -> [u8; 16] {
    let mut salt = [0_u8; 16];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn generate_key() -> [u8; KEY_LEN] {
    let mut key = [0_u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    key
}

pub fn derive_vault_key(
    master_password: &str,
    salt: &[u8],
    params: KdfParams,
) -> Result<[u8; KEY_LEN], CryptoError> {
    let argon_params = Params::new(
        params.memory_kib,
        params.iterations,
        params.parallelism,
        Some(KEY_LEN),
    )
    .map_err(|_| CryptoError::InvalidKdfParams)?;

    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);
    let mut key = [0_u8; KEY_LEN];
    argon
        .hash_password_into(master_password.as_bytes(), salt, &mut key)
        .map_err(|_| CryptoError::InvalidKdfParams)?;

    Ok(key)
}

pub fn encrypt_xchacha20(
    key: &[u8],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<EncryptedBlob, CryptoError> {
    if key.len() != KEY_LEN {
        return Err(CryptoError::InvalidKeyLength);
    }

    let mut nonce = [0_u8; XCHACHA20_NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);

    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            chacha20poly1305::aead::Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| CryptoError::EncryptFailed)?;

    Ok(EncryptedBlob { nonce, ciphertext })
}

pub fn decrypt_xchacha20(
    key: &[u8],
    blob: &EncryptedBlob,
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if key.len() != KEY_LEN {
        return Err(CryptoError::InvalidKeyLength);
    }

    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    cipher
        .decrypt(
            XNonce::from_slice(&blob.nonce),
            chacha20poly1305::aead::Payload {
                msg: &blob.ciphertext,
                aad,
            },
        )
        .map_err(|_| CryptoError::DecryptFailed)
}

// ---------------------------------------------------------------------------
// Item-level encryption: HKDF key derivation + per-item AAD
// ---------------------------------------------------------------------------

/// Derive an item key from vault key and item ID.
///
/// `item_key = HKDF-SHA256(vault_key, info="zero-vault:item-key:{item_id}", salt=empty)`
pub fn derive_item_key(vault_key: &[u8], item_id: &str) -> Result<[u8; KEY_LEN], CryptoError> {
    let info = format!("zero-vault:item-key:{item_id}");
    let hk = Hkdf::<Sha256>::new(Some(&[]), vault_key);
    let mut key = [0_u8; KEY_LEN];
    hk.expand(info.as_bytes(), &mut key)
        .map_err(|_| CryptoError::InvalidKeyLength)?;
    Ok(key)
}

/// Encrypt a single item with its own key and item-scoped AAD.
///
/// AAD = `"zero-vault:item:{item_id}:v1"`
pub fn encrypt_item(
    item_key: &[u8],
    plaintext: &[u8],
    item_id: &str,
) -> Result<EncryptedBlob, CryptoError> {
    let aad = format!("zero-vault:item:{item_id}:v1");
    encrypt_xchacha20(item_key, plaintext, aad.as_bytes())
}

/// Decrypt a single item.
///
/// AAD = `"zero-vault:item:{item_id}:v1"`
pub fn decrypt_item(
    item_key: &[u8],
    blob: &EncryptedBlob,
    item_id: &str,
) -> Result<Vec<u8>, CryptoError> {
    let aad = format!("zero-vault:item:{item_id}:v1");
    decrypt_xchacha20(item_key, blob, aad.as_bytes())
}

// ---------------------------------------------------------------------------
// Recovery code crypto: Argon2id with fixed domain-separation salt
// ---------------------------------------------------------------------------

const RECOVERY_SALT: &[u8] = b"zero-vault-recovery-v1";

/// Derive a recovery key from a human-readable recovery code.
///
/// `recovery_key = Argon2id(code, salt="zero-vault-recovery-v1", default_params)`
pub fn derive_recovery_key(recovery_code: &str) -> Result<[u8; KEY_LEN], CryptoError> {
    derive_vault_key(recovery_code, RECOVERY_SALT, KdfParams::default())
}

/// Encrypt a vault key with a recovery key.
///
/// The plaintext is the vault key; the AAD is `"zero-vault:recovery:v1"`.
pub fn encrypt_recovery_packet(
    recovery_key: &[u8],
    vault_key: &[u8],
) -> Result<EncryptedBlob, CryptoError> {
    encrypt_xchacha20(recovery_key, vault_key, b"zero-vault:recovery:v1")
}

/// Decrypt a vault key from a recovery packet.
pub fn decrypt_recovery_packet(
    recovery_key: &[u8],
    blob: &EncryptedBlob,
) -> Result<Vec<u8>, CryptoError> {
    decrypt_xchacha20(recovery_key, blob, b"zero-vault:recovery:v1")
}

// ---------------------------------------------------------------------------
// Device trust crypto: X25519 ECDH + XChaCha20-Poly1305
// ---------------------------------------------------------------------------

/// Generate an X25519 keypair for device trust.
///
/// Returns `(private_key_32_bytes, public_key_32_bytes)`.
pub fn generate_device_keypair() -> (Vec<u8>, Vec<u8>) {
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&secret);
    (secret.to_bytes().to_vec(), public.as_bytes().to_vec())
}

/// Encrypt a vault key for a specific device using X25519 ECDH.
///
/// Derives a shared secret via ECDH, then HKDF-sha256 into a 32-byte key,
/// and encrypts the vault key with XChaCha20-Poly1305.
///
/// AAD = `"zero-vault:device-share:v1"`
pub fn encrypt_for_device(
    device_public_key: &[u8],
    vault_key: &[u8],
) -> Result<EncryptedBlob, CryptoError> {
    if device_public_key.len() != KEY_LEN {
        return Err(CryptoError::InvalidKeyLength);
    }

    let mut pk_bytes = [0_u8; KEY_LEN];
    pk_bytes.copy_from_slice(device_public_key);
    let peer_public = PublicKey::from(pk_bytes);

    let ephemeral_secret = EphemeralSecret::random_from_rng(OsRng);
    let ephemeral_public = PublicKey::from(&ephemeral_secret);

    let shared_secret = ephemeral_secret.diffie_hellman(&peer_public);

    // HKDF the shared secret into an encryption key, mixing in the ephemeral public key
    // so the recipient can identify which ephemeral was used.
    let mut ikm = Vec::with_capacity(KEY_LEN + KEY_LEN);
    ikm.extend_from_slice(shared_secret.as_bytes());
    ikm.extend_from_slice(ephemeral_public.as_bytes());

    let hk = Hkdf::<Sha256>::new(Some(b"zero-vault:device-share:v1"), &ikm);
    let mut derived_key = [0_u8; KEY_LEN];
    hk.expand(b"enc", &mut derived_key)
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    // Encrypt the vault key. AAD includes the ephemeral public key for domain separation.
    let mut aad = Vec::with_capacity(32 + b"zero-vault:device-share:v1".len());
    aad.extend_from_slice(b"zero-vault:device-share:v1:");
    aad.extend_from_slice(ephemeral_public.as_bytes());

    let blob = encrypt_xchacha20(&derived_key, vault_key, &aad)?;

    // Prepend the ephemeral public key to the blob nonce+ciphertext so the
    // recipient can reconstruct the shared secret. We store it in the nonce
    // field by using a larger conceptual envelope. For simplicity and
    // compatibility with EncryptedBlob, we encode: ephemeral_pk || nonce || ciphertext
    // as the ciphertext field, and keep the nonce as-is.

    // Actually, let's restructure: we'll return a modified blob where the ciphertext
    // is prefixed with the ephemeral public key. The nonce stays random.
    let mut augmented_ciphertext = Vec::with_capacity(KEY_LEN + blob.ciphertext.len());
    augmented_ciphertext.extend_from_slice(ephemeral_public.as_bytes());
    augmented_ciphertext.extend_from_slice(&blob.ciphertext);

    Ok(EncryptedBlob {
        nonce: blob.nonce,
        ciphertext: augmented_ciphertext,
    })
}

/// Decrypt a vault key on a device using its private key.
///
/// Reverses `encrypt_for_device` by extracting the ephemeral public key from
/// the ciphertext prefix, computing the ECDH shared secret, and decrypting.
pub fn decrypt_on_device(
    device_private_key: &[u8],
    blob: &EncryptedBlob,
) -> Result<Vec<u8>, CryptoError> {
    if device_private_key.len() != KEY_LEN {
        return Err(CryptoError::InvalidKeyLength);
    }
    if blob.ciphertext.len() < KEY_LEN {
        return Err(CryptoError::DecryptFailed);
    }

    let mut sk_bytes = [0_u8; KEY_LEN];
    sk_bytes.copy_from_slice(device_private_key);
    let secret = StaticSecret::from(sk_bytes);

    // Extract ephemeral public key from the prefix of ciphertext
    let mut epk_bytes = [0_u8; KEY_LEN];
    epk_bytes.copy_from_slice(&blob.ciphertext[..KEY_LEN]);
    let ephemeral_public = PublicKey::from(epk_bytes);

    let shared_secret = secret.diffie_hellman(&ephemeral_public);

    let mut ikm = Vec::with_capacity(KEY_LEN + KEY_LEN);
    ikm.extend_from_slice(shared_secret.as_bytes());
    ikm.extend_from_slice(ephemeral_public.as_bytes());

    let hk = Hkdf::<Sha256>::new(Some(b"zero-vault:device-share:v1"), &ikm);
    let mut derived_key = [0_u8; KEY_LEN];
    hk.expand(b"enc", &mut derived_key)
        .map_err(|_| CryptoError::InvalidKeyLength)?;

    let mut aad = Vec::with_capacity(32 + b"zero-vault:device-share:v1".len());
    aad.extend_from_slice(b"zero-vault:device-share:v1:");
    aad.extend_from_slice(ephemeral_public.as_bytes());

    let inner_blob = EncryptedBlob {
        nonce: blob.nonce,
        ciphertext: blob.ciphertext[KEY_LEN..].to_vec(),
    };

    decrypt_xchacha20(&derived_key, &inner_blob, &aad)
}

// ---------------------------------------------------------------------------
// WASM bindings
// ---------------------------------------------------------------------------

#[wasm_bindgen(js_name = generateSalt)]
pub fn wasm_generate_salt() -> Vec<u8> {
    generate_salt().to_vec()
}

#[wasm_bindgen(js_name = generateKey)]
pub fn wasm_generate_key() -> Vec<u8> {
    generate_key().to_vec()
}

#[wasm_bindgen(js_name = deriveVaultKey)]
pub fn wasm_derive_vault_key(
    master_password: &str,
    salt: &[u8],
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<Vec<u8>, JsValue> {
    derive_vault_key(
        master_password,
        salt,
        KdfParams {
            memory_kib,
            iterations,
            parallelism,
        },
    )
    .map(|key| key.to_vec())
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = encryptXChaCha20)]
pub fn wasm_encrypt_xchacha20(
    key: &[u8],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let blob = encrypt_xchacha20(key, plaintext, aad)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let mut output = Vec::with_capacity(XCHACHA20_NONCE_LEN + blob.ciphertext.len());
    output.extend_from_slice(&blob.nonce);
    output.extend_from_slice(&blob.ciphertext);
    Ok(output)
}

#[wasm_bindgen(js_name = decryptXChaCha20)]
pub fn wasm_decrypt_xchacha20(
    key: &[u8],
    nonce_and_ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, JsValue> {
    if nonce_and_ciphertext.len() <= XCHACHA20_NONCE_LEN {
        return Err(JsValue::from_str("ciphertext envelope is too short"));
    }

    let mut nonce = [0_u8; XCHACHA20_NONCE_LEN];
    nonce.copy_from_slice(&nonce_and_ciphertext[..XCHACHA20_NONCE_LEN]);
    let blob = EncryptedBlob {
        nonce,
        ciphertext: nonce_and_ciphertext[XCHACHA20_NONCE_LEN..].to_vec(),
    };

    decrypt_xchacha20(key, &blob, aad).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = deriveItemKey)]
pub fn wasm_derive_item_key(vault_key: &[u8], item_id: &str) -> Result<Vec<u8>, JsValue> {
    derive_item_key(vault_key, item_id)
        .map(|key| key.to_vec())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = encryptItem)]
pub fn wasm_encrypt_item(
    item_key: &[u8],
    plaintext: &[u8],
    item_id: &str,
) -> Result<Vec<u8>, JsValue> {
    let blob = encrypt_item(item_key, plaintext, item_id)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let mut output = Vec::with_capacity(XCHACHA20_NONCE_LEN + blob.ciphertext.len());
    output.extend_from_slice(&blob.nonce);
    output.extend_from_slice(&blob.ciphertext);
    Ok(output)
}

#[wasm_bindgen(js_name = decryptItem)]
pub fn wasm_decrypt_item(
    item_key: &[u8],
    nonce_and_ciphertext: &[u8],
    item_id: &str,
) -> Result<Vec<u8>, JsValue> {
    if nonce_and_ciphertext.len() <= XCHACHA20_NONCE_LEN {
        return Err(JsValue::from_str("ciphertext envelope is too short"));
    }

    let mut nonce = [0_u8; XCHACHA20_NONCE_LEN];
    nonce.copy_from_slice(&nonce_and_ciphertext[..XCHACHA20_NONCE_LEN]);
    let blob = EncryptedBlob {
        nonce,
        ciphertext: nonce_and_ciphertext[XCHACHA20_NONCE_LEN..].to_vec(),
    };

    decrypt_item(item_key, &blob, item_id).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = deriveRecoveryKey)]
pub fn wasm_derive_recovery_key(recovery_code: &str) -> Result<Vec<u8>, JsValue> {
    derive_recovery_key(recovery_code)
        .map(|key| key.to_vec())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = encryptRecoveryPacket)]
pub fn wasm_encrypt_recovery_packet(
    recovery_key: &[u8],
    vault_key: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let blob = encrypt_recovery_packet(recovery_key, vault_key)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let mut output = Vec::with_capacity(XCHACHA20_NONCE_LEN + blob.ciphertext.len());
    output.extend_from_slice(&blob.nonce);
    output.extend_from_slice(&blob.ciphertext);
    Ok(output)
}

#[wasm_bindgen(js_name = decryptRecoveryPacket)]
pub fn wasm_decrypt_recovery_packet(
    recovery_key: &[u8],
    nonce_and_ciphertext: &[u8],
) -> Result<Vec<u8>, JsValue> {
    if nonce_and_ciphertext.len() <= XCHACHA20_NONCE_LEN {
        return Err(JsValue::from_str("ciphertext envelope is too short"));
    }

    let mut nonce = [0_u8; XCHACHA20_NONCE_LEN];
    nonce.copy_from_slice(&nonce_and_ciphertext[..XCHACHA20_NONCE_LEN]);
    let blob = EncryptedBlob {
        nonce,
        ciphertext: nonce_and_ciphertext[XCHACHA20_NONCE_LEN..].to_vec(),
    };

    decrypt_recovery_packet(recovery_key, &blob)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = generateDeviceKeypair)]
pub fn wasm_generate_device_keypair() -> Vec<u8> {
    let (private_key, public_key) = generate_device_keypair();
    let mut combined = Vec::with_capacity(KEY_LEN + KEY_LEN);
    combined.extend_from_slice(&private_key);
    combined.extend_from_slice(&public_key);
    combined
}

#[wasm_bindgen(js_name = encryptForDevice)]
pub fn wasm_encrypt_for_device(
    device_public_key: &[u8],
    vault_key: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let blob = encrypt_for_device(device_public_key, vault_key)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let mut output = Vec::with_capacity(XCHACHA20_NONCE_LEN + blob.ciphertext.len());
    output.extend_from_slice(&blob.nonce);
    output.extend_from_slice(&blob.ciphertext);
    Ok(output)
}

#[wasm_bindgen(js_name = decryptOnDevice)]
pub fn wasm_decrypt_on_device(
    device_private_key: &[u8],
    nonce_and_ciphertext: &[u8],
) -> Result<Vec<u8>, JsValue> {
    if nonce_and_ciphertext.len() <= XCHACHA20_NONCE_LEN {
        return Err(JsValue::from_str("ciphertext envelope is too short"));
    }

    let mut nonce = [0_u8; XCHACHA20_NONCE_LEN];
    nonce.copy_from_slice(&nonce_and_ciphertext[..XCHACHA20_NONCE_LEN]);
    let blob = EncryptedBlob {
        nonce,
        ciphertext: nonce_and_ciphertext[XCHACHA20_NONCE_LEN..].to_vec(),
    };

    decrypt_on_device(device_private_key, &blob)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_same_key_for_same_password_and_salt() {
        let salt = [7_u8; 16];
        let first = derive_vault_key("master password", &salt, KdfParams::default()).unwrap();
        let second = derive_vault_key("master password", &salt, KdfParams::default()).unwrap();

        assert_eq!(first, second);
    }

    #[test]
    fn encrypts_and_decrypts_round_trip() {
        let key = generate_key();
        let aad = b"vault-item:123";
        let blob = encrypt_xchacha20(&key, b"secret", aad).unwrap();
        let plaintext = decrypt_xchacha20(&key, &blob, aad).unwrap();

        assert_eq!(plaintext, b"secret");
    }

    #[test]
    fn nonce_is_random_between_encryptions() {
        let key = generate_key();
        let first = encrypt_xchacha20(&key, b"secret", b"aad").unwrap();
        let second = encrypt_xchacha20(&key, b"secret", b"aad").unwrap();

        assert_ne!(first.nonce, second.nonce);
        assert_ne!(first.ciphertext, second.ciphertext);
    }

    #[test]
    fn rejects_wrong_key() {
        let key = generate_key();
        let wrong_key = generate_key();
        let blob = encrypt_xchacha20(&key, b"secret", b"aad").unwrap();

        assert_eq!(
            decrypt_xchacha20(&wrong_key, &blob, b"aad").unwrap_err(),
            CryptoError::DecryptFailed
        );
    }

    #[test]
    fn rejects_tampered_ciphertext() {
        let key = generate_key();
        let mut blob = encrypt_xchacha20(&key, b"secret", b"aad").unwrap();
        blob.ciphertext[0] ^= 1;

        assert_eq!(
            decrypt_xchacha20(&key, &blob, b"aad").unwrap_err(),
            CryptoError::DecryptFailed
        );
    }

    // --- Item-level encryption tests ---

    #[test]
    fn derive_item_key_is_deterministic() {
        let vault_key = generate_key();
        let first = derive_item_key(&vault_key, "item-abc-123").unwrap();
        let second = derive_item_key(&vault_key, "item-abc-123").unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn derive_item_key_differs_for_different_ids() {
        let vault_key = generate_key();
        let key_a = derive_item_key(&vault_key, "item-aaa").unwrap();
        let key_b = derive_item_key(&vault_key, "item-bbb").unwrap();
        assert_ne!(key_a, key_b);
    }

    #[test]
    fn encrypt_decrypt_item_round_trip() {
        let vault_key = generate_key();
        let item_id = "cred-42";
        let item_key = derive_item_key(&vault_key, item_id).unwrap();
        let blob = encrypt_item(&item_key, b"super-secret-password", item_id).unwrap();
        let plaintext = decrypt_item(&item_key, &blob, item_id).unwrap();
        assert_eq!(plaintext, b"super-secret-password");
    }

    #[test]
    fn decrypt_item_rejects_wrong_key() {
        let vault_key = generate_key();
        let item_id = "cred-42";
        let item_key = derive_item_key(&vault_key, item_id).unwrap();
        let wrong_key = generate_key();
        let blob = encrypt_item(&item_key, b"secret", item_id).unwrap();

        assert_eq!(
            decrypt_item(&wrong_key, &blob, item_id).unwrap_err(),
            CryptoError::DecryptFailed
        );
    }

    #[test]
    fn decrypt_item_rejects_tampered_ciphertext() {
        let vault_key = generate_key();
        let item_id = "cred-42";
        let item_key = derive_item_key(&vault_key, item_id).unwrap();
        let mut blob = encrypt_item(&item_key, b"secret", item_id).unwrap();
        blob.ciphertext[0] ^= 0xff;

        assert_eq!(
            decrypt_item(&item_key, &blob, item_id).unwrap_err(),
            CryptoError::DecryptFailed
        );
    }

    #[test]
    fn decrypt_item_rejects_wrong_aad() {
        let vault_key = generate_key();
        let item_id = "cred-42";
        let item_key = derive_item_key(&vault_key, item_id).unwrap();
        let blob = encrypt_item(&item_key, b"secret", item_id).unwrap();

        // Decrypting with a different item_id changes the AAD
        assert_eq!(
            decrypt_item(&item_key, &blob, "cred-99").unwrap_err(),
            CryptoError::DecryptFailed
        );
    }

    // --- Recovery code crypto tests ---

    #[test]
    fn derive_recovery_key_is_deterministic() {
        let first = derive_recovery_key("ABCD-EFGH-IJKL-MNOP").unwrap();
        let second = derive_recovery_key("ABCD-EFGH-IJKL-MNOP").unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn encrypt_decrypt_recovery_packet_round_trip() {
        let recovery_code = "ABCD-EFGH-IJKL-MNOP";
        let recovery_key = derive_recovery_key(recovery_code).unwrap();
        let vault_key = generate_key();

        let blob = encrypt_recovery_packet(&recovery_key, &vault_key).unwrap();
        let decrypted = decrypt_recovery_packet(&recovery_key, &blob).unwrap();
        assert_eq!(decrypted, vault_key.to_vec());
    }

    #[test]
    fn wrong_recovery_code_fails() {
        let recovery_key_correct = derive_recovery_key("ABCD-EFGH-IJKL-MNOP").unwrap();
        let recovery_key_wrong = derive_recovery_key("XXXX-XXXX-XXXX-XXXX").unwrap();
        let vault_key = generate_key();

        let blob = encrypt_recovery_packet(&recovery_key_correct, &vault_key).unwrap();
        assert_eq!(
            decrypt_recovery_packet(&recovery_key_wrong, &blob).unwrap_err(),
            CryptoError::DecryptFailed
        );
    }

    #[test]
    fn tampered_recovery_packet_fails() {
        let recovery_key = derive_recovery_key("ABCD-EFGH-IJKL-MNOP").unwrap();
        let vault_key = generate_key();

        let mut blob = encrypt_recovery_packet(&recovery_key, &vault_key).unwrap();
        blob.ciphertext[0] ^= 0xff;

        assert_eq!(
            decrypt_recovery_packet(&recovery_key, &blob).unwrap_err(),
            CryptoError::DecryptFailed
        );
    }

    // --- Device trust crypto tests ---

    #[test]
    fn device_keypair_encrypt_decrypt_round_trip() {
        let (private_key, public_key) = generate_device_keypair();
        let vault_key = generate_key();

        let blob = encrypt_for_device(&public_key, &vault_key).unwrap();
        let decrypted = decrypt_on_device(&private_key, &blob).unwrap();
        assert_eq!(decrypted, vault_key.to_vec());
    }

    #[test]
    fn device_wrong_private_key_fails() {
        let (_private_key, public_key) = generate_device_keypair();
        let (wrong_private_key, _wrong_public_key) = generate_device_keypair();
        let vault_key = generate_key();

        let blob = encrypt_for_device(&public_key, &vault_key).unwrap();
        assert!(
            decrypt_on_device(&wrong_private_key, &blob).is_err()
        );
    }

    #[test]
    fn device_tampered_ciphertext_fails() {
        let (private_key, public_key) = generate_device_keypair();
        let vault_key = generate_key();

        let mut blob = encrypt_for_device(&public_key, &vault_key).unwrap();
        // Tamper with the encrypted portion (after the 32-byte ephemeral public key prefix)
        if blob.ciphertext.len() > KEY_LEN + 1 {
            blob.ciphertext[KEY_LEN + 1] ^= 0xff;
        }

        assert!(
            decrypt_on_device(&private_key, &blob).is_err()
        );
    }
}

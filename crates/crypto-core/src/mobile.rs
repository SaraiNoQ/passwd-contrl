use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use ed25519_dalek::{Signer, SigningKey};
use generic_array::{ArrayLength, GenericArray};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use opaque_ke::ciphersuite::CipherSuite;
use opaque_ke::errors::InternalError;
use opaque_ke::ksf::Ksf;
use opaque_ke::{
    ClientLogin, ClientLoginFinishParameters, ClientRegistration,
    ClientRegistrationFinishParameters, CredentialResponse, Identifiers, RegistrationResponse,
};
use rand_core::{OsRng, RngCore};
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use thiserror::Error;
use zeroize::Zeroizing;

use crate::{
    decrypt_item, decrypt_on_device, decrypt_recovery_packet, decrypt_xchacha20,
    derive_recovery_key, derive_vault_key, encrypt_item, encrypt_recovery_packet,
    encrypt_for_device, encrypt_xchacha20, generate_device_keypair, generate_key, CryptoError,
    EncryptedBlob, KdfParams, KEY_LEN, XCHACHA20_NONCE_LEN,
};

const POLY1305_TAG_LEN: usize = 16;
const MIN_MEMORY_KIB: u32 = 8 * 1024;
const MAX_MEMORY_KIB: u32 = 256 * 1024;
const MAX_ITERATIONS: u32 = 10;
const MAX_PARALLELISM: u32 = 8;
const SESSION_IDLE_TTL: Duration = Duration::from_secs(60 * 60);
const OPAQUE_STATE_TTL: Duration = Duration::from_secs(10 * 60);
const RECOVERY_PROOF_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_OPAQUE_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_RECOVERY_TRANSCRIPT_BYTES: usize = 64 * 1024;
const MAX_BACKUP_BYTES: usize = 8 * 1024 * 1024;
const CRYPTO_CORE_BACKUP_AAD: &[u8] = b"zero-vault.local-vault.v1";
const MAX_MOBILE_BACKUP_BYTES: usize = 32 * 1024 * 1024;
const MOBILE_BACKUP_AAD_PREFIX: &[u8] = b"zero-vault:mobile-backup:v2\0";
const RECOVERY_V2_CODE_LEN: usize = 32;
const RECOVERY_V2_SALT_LEN: usize = 16;
const RECOVERY_V2_AUTH_SALT_LEN: usize = 32;
const RECOVERY_V2_PLAINTEXT_LEN: usize = 1 + KEY_LEN + RECOVERY_V2_AUTH_SALT_LEN;
const RECOVERY_V2_CIPHERTEXT_LEN: usize = RECOVERY_V2_PLAINTEXT_LEN + POLY1305_TAG_LEN;
const RECOVERY_V2_PACKET_LEN: usize =
    RECOVERY_V2_SALT_LEN + XCHACHA20_NONCE_LEN + RECOVERY_V2_CIPHERTEXT_LEN;
const RECOVERY_V2_VERSION: u8 = 2;
const RECOVERY_V2_AAD: &[u8] = b"zero-vault:recovery-packet:v2";
const RECOVERY_V2_SIGNING_INFO: &[u8] = b"zero-vault/recovery-signing/v2";
const RECOVERY_V2_FINISH_PREFIX: &[u8] = b"zero-vault/recovery-finish/v2\0";
const DEVICE_VAULT_KEY_PACKET_LEN: usize = XCHACHA20_NONCE_LEN + KEY_LEN + KEY_LEN + POLY1305_TAG_LEN;

struct SessionEntry {
    key: Zeroizing<[u8; KEY_LEN]>,
    last_used: Instant,
}

struct OpaqueStateEntry {
    state: Zeroizing<Vec<u8>>,
    password: Zeroizing<Vec<u8>>,
    client_identifier: Zeroizing<Vec<u8>>,
    server_identifier: Zeroizing<Vec<u8>>,
    created_at: Instant,
}

struct RecoveryProofEntry {
    signing_seed: Zeroizing<[u8; 32]>,
    session_handle: String,
    created_at: Instant,
}

type SessionMap = HashMap<String, SessionEntry>;
type OpaqueStateMap = HashMap<String, OpaqueStateEntry>;
type RecoveryProofMap = HashMap<String, RecoveryProofEntry>;

static SESSIONS: OnceLock<Mutex<SessionMap>> = OnceLock::new();
static OPAQUE_LOGIN_STATES: OnceLock<Mutex<OpaqueStateMap>> = OnceLock::new();
static OPAQUE_REGISTRATION_STATES: OnceLock<Mutex<OpaqueStateMap>> = OnceLock::new();
static RECOVERY_PROOFS: OnceLock<Mutex<RecoveryProofMap>> = OnceLock::new();

#[uniffi::export]
pub fn mobile_protocol_version() -> u32 {
    2
}

/// Stable identifiers cross FFI; details and sensitive inputs never do.
#[derive(Debug, Error, uniffi::Error)]
pub enum MobileCryptoError {
    #[error("ZV_CRYPTO_INVALID_KDF_PARAMS")]
    InvalidKdfParams,
    #[error("ZV_CRYPTO_INVALID_INPUT")]
    InvalidInput,
    #[error("ZV_CRYPTO_INVALID_ENVELOPE")]
    InvalidEnvelope,
    #[error("ZV_CRYPTO_AUTHENTICATION_FAILED")]
    AuthenticationFailed,
    #[error("ZV_CRYPTO_INVALID_SESSION")]
    InvalidSession,
    #[error("ZV_CRYPTO_OPAQUE_STATE_EXPIRED")]
    OpaqueStateExpired,
    #[error("ZV_CRYPTO_RECOVERY_PROOF_EXPIRED")]
    RecoveryProofExpired,
    #[error("ZV_CRYPTO_INTERNAL")]
    Internal,
}

#[derive(uniffi::Record)]
pub struct MobileEncryptedItem {
    pub encrypted_item_key: Vec<u8>,
    pub encrypted_payload: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct MobileDeviceKeyPair {
    /// This is returned only to Kotlin so it can be immediately Keystore-wrapped.
    pub private_key: Vec<u8>,
    pub public_key: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct MobileNewVault {
    pub session_handle: String,
    pub encrypted_vault_key: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct MobileOpaqueStart {
    pub state_handle: String,
    pub request: String,
}

#[derive(uniffi::Record)]
pub struct MobileOpaqueLoginFinish {
    pub finish_login_request: String,
}

#[derive(uniffi::Record)]
pub struct MobileOpaqueRegistrationFinish {
    pub registration_record: String,
    pub server_static_public_key: String,
}

#[derive(uniffi::Record)]
pub struct MobileTotp {
    pub code: String,
    pub valid_for_seconds: u32,
}

#[derive(uniffi::Record)]
pub struct MobileRecoveryV2Open {
    pub session_handle: String,
    pub recovery_proof_handle: String,
    pub signing_public_key: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct MobileRecoveryV2Rotation {
    pub recovery_code: String,
    pub encrypted_recovery_packet: Vec<u8>,
    pub signing_public_key: Vec<u8>,
}

struct SerenityCipherSuite;

impl CipherSuite for SerenityCipherSuite {
    type OprfCs = opaque_ke::Ristretto255;
    type KeyExchange = opaque_ke::TripleDh<opaque_ke::Ristretto255, Sha512>;
    type Ksf = SerenityKsf;
}

struct SerenityKsf {
    argon: Argon2<'static>,
}

impl Default for SerenityKsf {
    fn default() -> Self {
        Self {
            argon: Argon2::new(
                Algorithm::Argon2id,
                Version::V0x13,
                Params::new(1 << 16, 3, 4, None).expect("fixed OPAQUE KSF parameters are valid"),
            ),
        }
    }
}

impl Ksf for SerenityKsf {
    fn hash<L: ArrayLength<u8>>(
        &self,
        input: GenericArray<u8, L>,
    ) -> Result<GenericArray<u8, L>, InternalError> {
        let mut output = GenericArray::default();
        self.argon
            .hash_password_into(&input, &[0; argon2::RECOMMENDED_SALT_LEN], &mut output)
            .map_err(|_| InternalError::KsfError)?;
        Ok(output)
    }
}

fn sessions() -> &'static Mutex<SessionMap> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn opaque_login_states() -> &'static Mutex<OpaqueStateMap> {
    OPAQUE_LOGIN_STATES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn opaque_registration_states() -> &'static Mutex<OpaqueStateMap> {
    OPAQUE_REGISTRATION_STATES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn recovery_proofs() -> &'static Mutex<RecoveryProofMap> {
    RECOVERY_PROOFS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn boundary<T>(
    operation: impl FnOnce() -> Result<T, MobileCryptoError>,
) -> Result<T, MobileCryptoError> {
    catch_unwind(AssertUnwindSafe(operation)).unwrap_or(Err(MobileCryptoError::Internal))
}

fn map_crypto_error(error: CryptoError) -> MobileCryptoError {
    match error {
        CryptoError::InvalidKdfParams => MobileCryptoError::InvalidKdfParams,
        CryptoError::InvalidKeyLength | CryptoError::InvalidNonceLength => {
            MobileCryptoError::InvalidInput
        }
        CryptoError::DecryptFailed | CryptoError::EncryptFailed => {
            MobileCryptoError::AuthenticationFailed
        }
    }
}

fn parse_envelope(bytes: &[u8]) -> Result<EncryptedBlob, MobileCryptoError> {
    if bytes.len() < XCHACHA20_NONCE_LEN + POLY1305_TAG_LEN {
        return Err(MobileCryptoError::InvalidEnvelope);
    }
    let mut nonce = [0_u8; XCHACHA20_NONCE_LEN];
    nonce.copy_from_slice(&bytes[..XCHACHA20_NONCE_LEN]);
    Ok(EncryptedBlob {
        nonce,
        ciphertext: bytes[XCHACHA20_NONCE_LEN..].to_vec(),
    })
}

fn envelope(blob: EncryptedBlob) -> Vec<u8> {
    let mut output = Vec::with_capacity(XCHACHA20_NONCE_LEN + blob.ciphertext.len());
    output.extend_from_slice(&blob.nonce);
    output.extend_from_slice(&blob.ciphertext);
    output
}

fn new_handle<T>(existing: &HashMap<String, T>) -> String {
    loop {
        let mut random = [0_u8; 16];
        OsRng.fill_bytes(&mut random);
        let handle = random.iter().map(|byte| format!("{byte:02x}")).collect();
        if !existing.contains_key(&handle) {
            return handle;
        }
    }
}

fn remove_expired_sessions(entries: &mut SessionMap, now: Instant) {
    entries.retain(|_, session| now.duration_since(session.last_used) < SESSION_IDLE_TTL);
}

fn remove_expired_opaque_states(entries: &mut OpaqueStateMap, now: Instant) {
    entries.retain(|_, state| now.duration_since(state.created_at) < OPAQUE_STATE_TTL);
}

fn remove_expired_recovery_proofs(entries: &mut RecoveryProofMap, now: Instant) {
    entries.retain(|_, proof| now.duration_since(proof.created_at) < RECOVERY_PROOF_TTL);
}

fn remove_recovery_proofs_for_session(session_handle: &str) -> Result<(), MobileCryptoError> {
    recovery_proofs()
        .lock()
        .map_err(|_| MobileCryptoError::Internal)?
        .retain(|_, proof| proof.session_handle != session_handle);
    Ok(())
}

fn insert_recovery_proof(
    session_handle: String,
    signing_seed: Zeroizing<[u8; 32]>,
) -> Result<String, MobileCryptoError> {
    let mut entries = recovery_proofs()
        .lock()
        .map_err(|_| MobileCryptoError::Internal)?;
    let now = Instant::now();
    remove_expired_recovery_proofs(&mut entries, now);
    let handle = new_handle(&entries);
    entries.insert(
        handle.clone(),
        RecoveryProofEntry {
            signing_seed,
            session_handle,
            created_at: now,
        },
    );
    Ok(handle)
}

fn take_recovery_proof(handle: &str) -> Result<RecoveryProofEntry, MobileCryptoError> {
    let mut entries = recovery_proofs()
        .lock()
        .map_err(|_| MobileCryptoError::Internal)?;
    remove_expired_recovery_proofs(&mut entries, Instant::now());
    entries
        .remove(handle)
        .ok_or(MobileCryptoError::RecoveryProofExpired)
}

fn insert_session(key: Zeroizing<[u8; KEY_LEN]>) -> Result<String, MobileCryptoError> {
    let mut entries = sessions().lock().map_err(|_| MobileCryptoError::Internal)?;
    let now = Instant::now();
    remove_expired_sessions(&mut entries, now);
    let handle = new_handle(&entries);
    entries.insert(
        handle.clone(),
        SessionEntry {
            key,
            last_used: now,
        },
    );
    Ok(handle)
}

fn with_session<T>(
    session_handle: &str,
    operation: impl FnOnce(&[u8; KEY_LEN]) -> Result<T, MobileCryptoError>,
) -> Result<T, MobileCryptoError> {
    let mut entries = sessions().lock().map_err(|_| MobileCryptoError::Internal)?;
    let now = Instant::now();
    remove_expired_sessions(&mut entries, now);
    let session = entries
        .get_mut(session_handle)
        .ok_or(MobileCryptoError::InvalidSession)?;
    session.last_used = now;
    operation(&*session.key)
}

fn validate_opaque_input(password: &str, client: &str, server: &str) -> Result<(), MobileCryptoError> {
    if password.is_empty()
        || password.len() > 1024
        || client.is_empty()
        || client.len() > 320
        || server.is_empty()
        || server.len() > 256
    {
        return Err(MobileCryptoError::InvalidInput);
    }
    Ok(())
}

fn insert_opaque_state(
    states: &Mutex<OpaqueStateMap>,
    state: Vec<u8>,
    password: String,
    client_identifier: String,
    server_identifier: String,
) -> Result<String, MobileCryptoError> {
    let mut entries = states.lock().map_err(|_| MobileCryptoError::Internal)?;
    let now = Instant::now();
    remove_expired_opaque_states(&mut entries, now);
    let handle = new_handle(&entries);
    entries.insert(
        handle.clone(),
        OpaqueStateEntry {
            state: Zeroizing::new(state),
            password: Zeroizing::new(password.into_bytes()),
            client_identifier: Zeroizing::new(client_identifier.into_bytes()),
            server_identifier: Zeroizing::new(server_identifier.into_bytes()),
            created_at: now,
        },
    );
    Ok(handle)
}

fn take_opaque_state(
    states: &Mutex<OpaqueStateMap>,
    handle: &str,
) -> Result<OpaqueStateEntry, MobileCryptoError> {
    let mut entries = states.lock().map_err(|_| MobileCryptoError::Internal)?;
    remove_expired_opaque_states(&mut entries, Instant::now());
    entries
        .remove(handle)
        .ok_or(MobileCryptoError::OpaqueStateExpired)
}

/// Start an RFC 9807 login using the exact Serenity Ristretto255/SHA-512 suite.
#[uniffi::export]
pub fn mobile_opaque_start_login(
    password: String,
    client_identifier: String,
    server_identifier: String,
) -> Result<MobileOpaqueStart, MobileCryptoError> {
    boundary(|| {
        validate_opaque_input(&password, &client_identifier, &server_identifier)?;
        let mut rng = OsRng;
        let started = ClientLogin::<SerenityCipherSuite>::start(&mut rng, password.as_bytes())
            .map_err(|_| MobileCryptoError::Internal)?;
        let request = URL_SAFE_NO_PAD.encode(started.message.serialize());
        let state_handle = insert_opaque_state(
            opaque_login_states(),
            started.state.serialize().to_vec(),
            password,
            client_identifier,
            server_identifier,
        )?;
        Ok(MobileOpaqueStart {
            state_handle,
            request,
        })
    })
}

#[uniffi::export]
pub fn mobile_opaque_finish_login(
    state_handle: String,
    login_response: String,
) -> Result<MobileOpaqueLoginFinish, MobileCryptoError> {
    boundary(|| {
        if state_handle.is_empty() || login_response.len() > MAX_OPAQUE_MESSAGE_BYTES * 2 {
            return Err(MobileCryptoError::InvalidInput);
        }
        let entry = take_opaque_state(opaque_login_states(), &state_handle)?;
        let response_bytes = URL_SAFE_NO_PAD
            .decode(login_response)
            .map_err(|_| MobileCryptoError::InvalidEnvelope)?;
        if response_bytes.len() > MAX_OPAQUE_MESSAGE_BYTES {
            return Err(MobileCryptoError::InvalidEnvelope);
        }
        let state = ClientLogin::<SerenityCipherSuite>::deserialize(entry.state.as_slice())
            .map_err(|_| MobileCryptoError::InvalidEnvelope)?;
        let identifiers = Identifiers {
            client: Some(entry.client_identifier.as_slice()),
            server: Some(entry.server_identifier.as_slice()),
        };
        let ksf = SerenityKsf::default();
        let params = ClientLoginFinishParameters::new(None, identifiers, Some(&ksf));
        let mut rng = OsRng;
        let finished = state
            .finish(
                &mut rng,
                entry.password.as_slice(),
                CredentialResponse::deserialize(&response_bytes)
                    .map_err(|_| MobileCryptoError::InvalidEnvelope)?,
                params,
            )
            .map_err(|_| MobileCryptoError::AuthenticationFailed)?;
        let finish_login_request = URL_SAFE_NO_PAD.encode(finished.message.serialize());
        Ok(MobileOpaqueLoginFinish {
            finish_login_request,
        })
    })
}

#[uniffi::export]
pub fn mobile_opaque_start_registration(
    password: String,
    client_identifier: String,
    server_identifier: String,
) -> Result<MobileOpaqueStart, MobileCryptoError> {
    boundary(|| {
        validate_opaque_input(&password, &client_identifier, &server_identifier)?;
        let mut rng = OsRng;
        let started =
            ClientRegistration::<SerenityCipherSuite>::start(&mut rng, password.as_bytes())
                .map_err(|_| MobileCryptoError::Internal)?;
        let request = URL_SAFE_NO_PAD.encode(started.message.serialize());
        let state_handle = insert_opaque_state(
            opaque_registration_states(),
            started.state.serialize().to_vec(),
            password,
            client_identifier,
            server_identifier,
        )?;
        Ok(MobileOpaqueStart {
            state_handle,
            request,
        })
    })
}

#[uniffi::export]
pub fn mobile_opaque_finish_registration(
    state_handle: String,
    registration_response: String,
) -> Result<MobileOpaqueRegistrationFinish, MobileCryptoError> {
    boundary(|| {
        if state_handle.is_empty() || registration_response.len() > MAX_OPAQUE_MESSAGE_BYTES * 2 {
            return Err(MobileCryptoError::InvalidInput);
        }
        let entry = take_opaque_state(opaque_registration_states(), &state_handle)?;
        let response_bytes = URL_SAFE_NO_PAD
            .decode(registration_response)
            .map_err(|_| MobileCryptoError::InvalidEnvelope)?;
        let state = ClientRegistration::<SerenityCipherSuite>::deserialize(entry.state.as_slice())
            .map_err(|_| MobileCryptoError::InvalidEnvelope)?;
        let identifiers = Identifiers {
            client: Some(entry.client_identifier.as_slice()),
            server: Some(entry.server_identifier.as_slice()),
        };
        let ksf = SerenityKsf::default();
        let params = ClientRegistrationFinishParameters::new(identifiers, Some(&ksf));
        let mut rng = OsRng;
        let finished = state
            .finish(
                &mut rng,
                entry.password.as_slice(),
                RegistrationResponse::deserialize(&response_bytes)
                    .map_err(|_| MobileCryptoError::InvalidEnvelope)?,
                params,
            )
            .map_err(|_| MobileCryptoError::AuthenticationFailed)?;
        Ok(MobileOpaqueRegistrationFinish {
            registration_record: URL_SAFE_NO_PAD.encode(finished.message.serialize()),
            server_static_public_key: URL_SAFE_NO_PAD.encode(finished.server_s_pk.serialize()),
        })
    })
}

#[uniffi::export]
pub fn mobile_opaque_cancel(state_handle: String) -> Result<(), MobileCryptoError> {
    boundary(|| {
        if state_handle.is_empty() {
            return Err(MobileCryptoError::InvalidInput);
        }
        let removed_login = opaque_login_states()
            .lock()
            .map_err(|_| MobileCryptoError::Internal)?
            .remove(&state_handle);
        let removed_registration = opaque_registration_states()
            .lock()
            .map_err(|_| MobileCryptoError::Internal)?
            .remove(&state_handle);
        if removed_login.is_none() && removed_registration.is_none() {
            return Err(MobileCryptoError::OpaqueStateExpired);
        }
        Ok(())
    })
}

/// Derive a candidate vault key and return only an opaque process-local handle.
#[uniffi::export]
pub fn mobile_unlock_vault(
    master_password: String,
    salt: Vec<u8>,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<String, MobileCryptoError> {
    boundary(|| {
        if master_password.is_empty()
            || master_password.len() > 1024
            || !(16..=64).contains(&salt.len())
        {
            return Err(MobileCryptoError::InvalidInput);
        }
        if !(MIN_MEMORY_KIB..=MAX_MEMORY_KIB).contains(&memory_kib)
            || !(1..=MAX_ITERATIONS).contains(&iterations)
            || !(1..=MAX_PARALLELISM).contains(&parallelism)
        {
            return Err(MobileCryptoError::InvalidKdfParams);
        }
        let password = Zeroizing::new(master_password);
        let key = Zeroizing::new(
            derive_vault_key(
                password.as_str(),
                &salt,
                KdfParams {
                    memory_kib,
                    iterations,
                    parallelism,
                },
            )
            .map_err(map_crypto_error)?,
        );
        insert_session(key)
    })
}

/// Opens the Web crypto-core backup envelope without exposing its derived key.
/// The returned plaintext is consumed and wiped by the Kotlin repository; it is
/// never exported by the Expo Module to JavaScript.
#[uniffi::export]
pub fn mobile_decrypt_crypto_core_backup(
    master_password: String,
    salt: Vec<u8>,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    encrypted_snapshot: Vec<u8>,
) -> Result<Vec<u8>, MobileCryptoError> {
    boundary(|| {
        if master_password.is_empty()
            || master_password.len() > 1024
            || salt.len() != 16
            || encrypted_snapshot.len() < XCHACHA20_NONCE_LEN + POLY1305_TAG_LEN
            || encrypted_snapshot.len() > MAX_BACKUP_BYTES
        {
            return Err(MobileCryptoError::InvalidInput);
        }
        if !(MIN_MEMORY_KIB..=MAX_MEMORY_KIB).contains(&memory_kib)
            || !(1..=MAX_ITERATIONS).contains(&iterations)
            || !(1..=MAX_PARALLELISM).contains(&parallelism)
        {
            return Err(MobileCryptoError::InvalidKdfParams);
        }
        let password = Zeroizing::new(master_password);
        let key = Zeroizing::new(
            derive_vault_key(
                password.as_str(),
                &salt,
                KdfParams { memory_kib, iterations, parallelism },
            )
            .map_err(map_crypto_error)?,
        );
        let encrypted = parse_envelope(&encrypted_snapshot)?;
        decrypt_xchacha20(key.as_ref(), &encrypted, CRYPTO_CORE_BACKUP_AAD)
            .map_err(map_crypto_error)
    })
}

#[uniffi::export]
pub fn mobile_open_device_vault(
    device_private_key: Vec<u8>,
    encrypted_vault_key: Vec<u8>,
) -> Result<String, MobileCryptoError> {
    boundary(|| {
        if encrypted_vault_key.len() != DEVICE_VAULT_KEY_PACKET_LEN {
            return Err(MobileCryptoError::InvalidEnvelope);
        }
        let private_key = Zeroizing::new(device_private_key);
        let packet = parse_envelope(&encrypted_vault_key)?;
        let vault_key = Zeroizing::new(
            decrypt_on_device(private_key.as_slice(), &packet).map_err(map_crypto_error)?,
        );
        let key: [u8; KEY_LEN] = vault_key
            .as_slice()
            .try_into()
            .map_err(|_| MobileCryptoError::AuthenticationFailed)?;
        insert_session(Zeroizing::new(key))
    })
}

#[uniffi::export]
pub fn mobile_generate_device_keypair() -> Result<MobileDeviceKeyPair, MobileCryptoError> {
    boundary(|| {
        let (private_key, public_key) = generate_device_keypair();
        Ok(MobileDeviceKeyPair {
            private_key,
            public_key,
        })
    })
}

#[uniffi::export]
pub fn mobile_create_vault_for_device(
    device_public_key: Vec<u8>,
) -> Result<MobileNewVault, MobileCryptoError> {
    boundary(|| {
        if device_public_key.len() != KEY_LEN {
            return Err(MobileCryptoError::InvalidInput);
        }
        let vault_key = Zeroizing::new(generate_key());
        let encrypted_vault_key = envelope(
            encrypt_for_device(&device_public_key, vault_key.as_ref()).map_err(map_crypto_error)?,
        );
        let session_handle = insert_session(Zeroizing::new(*vault_key))?;
        Ok(MobileNewVault {
            session_handle,
            encrypted_vault_key,
        })
    })
}

#[uniffi::export]
pub fn mobile_share_vault_key(
    session_handle: String,
    device_public_key: Vec<u8>,
) -> Result<Vec<u8>, MobileCryptoError> {
    boundary(|| {
        if device_public_key.len() != KEY_LEN {
            return Err(MobileCryptoError::InvalidInput);
        }
        with_session(&session_handle, |vault_key| {
            encrypt_for_device(&device_public_key, vault_key)
                .map(envelope)
                .map_err(map_crypto_error)
        })
    })
}

#[uniffi::export]
pub fn mobile_encrypt_item(
    session_handle: String,
    plaintext: Vec<u8>,
    item_id: String,
) -> Result<MobileEncryptedItem, MobileCryptoError> {
    boundary(|| {
        if session_handle.is_empty()
            || item_id.is_empty()
            || item_id.len() > 256
            || plaintext.len() > 1024 * 1024
        {
            return Err(MobileCryptoError::InvalidInput);
        }
        let plaintext = Zeroizing::new(plaintext);
        with_session(&session_handle, |vault_key| {
            let item_key = Zeroizing::new(generate_key());
            let wrap_aad = format!("zero-vault:item-key-wrap:{item_id}");
            let wrapped = encrypt_xchacha20(vault_key, item_key.as_ref(), wrap_aad.as_bytes())
                .map_err(map_crypto_error)?;
            let payload = encrypt_item(item_key.as_ref(), plaintext.as_slice(), &item_id)
                .map_err(map_crypto_error)?;
            Ok(MobileEncryptedItem {
                encrypted_item_key: envelope(wrapped),
                encrypted_payload: envelope(payload),
            })
        })
    })
}

#[uniffi::export]
pub fn mobile_decrypt_item(
    session_handle: String,
    encrypted_item_key: Vec<u8>,
    encrypted_payload: Vec<u8>,
    item_id: String,
) -> Result<Vec<u8>, MobileCryptoError> {
    boundary(|| {
        if session_handle.is_empty() || item_id.is_empty() || item_id.len() > 256 {
            return Err(MobileCryptoError::InvalidInput);
        }
        let wrapped_item_key = parse_envelope(&encrypted_item_key)?;
        let payload = parse_envelope(&encrypted_payload)?;
        with_session(&session_handle, |vault_key| {
            let wrap_aad = format!("zero-vault:item-key-wrap:{item_id}");
            let item_key = Zeroizing::new(
                decrypt_xchacha20(vault_key, &wrapped_item_key, wrap_aad.as_bytes())
                    .map_err(map_crypto_error)?,
            );
            if item_key.len() != KEY_LEN {
                return Err(MobileCryptoError::AuthenticationFailed);
            }
            let plaintext = Zeroizing::new(
                decrypt_item(item_key.as_slice(), &payload, &item_id).map_err(map_crypto_error)?,
            );
            Ok(plaintext.to_vec())
        })
    })
}

fn mobile_backup_aad(account_id: &str, backup_id: &str) -> Result<Vec<u8>, MobileCryptoError> {
    if account_id.is_empty() || account_id.len() > 256 || backup_id.len() != 36 {
        return Err(MobileCryptoError::InvalidInput);
    }
    let mut aad = Vec::with_capacity(MOBILE_BACKUP_AAD_PREFIX.len() + account_id.len() + backup_id.len() + 1);
    aad.extend_from_slice(MOBILE_BACKUP_AAD_PREFIX);
    aad.extend_from_slice(account_id.as_bytes());
    aad.push(0);
    aad.extend_from_slice(backup_id.as_bytes());
    Ok(aad)
}

#[uniffi::export]
pub fn mobile_encrypt_backup(
    session_handle: String,
    account_id: String,
    backup_id: String,
    plaintext: Vec<u8>,
) -> Result<Vec<u8>, MobileCryptoError> {
    boundary(|| {
        if plaintext.is_empty() || plaintext.len() > MAX_MOBILE_BACKUP_BYTES {
            return Err(MobileCryptoError::InvalidInput);
        }
        let aad = mobile_backup_aad(&account_id, &backup_id)?;
        let plaintext = Zeroizing::new(plaintext);
        with_session(&session_handle, |vault_key| {
            encrypt_xchacha20(vault_key, plaintext.as_slice(), &aad)
                .map(envelope)
                .map_err(map_crypto_error)
        })
    })
}

#[uniffi::export]
pub fn mobile_decrypt_backup(
    session_handle: String,
    account_id: String,
    backup_id: String,
    encrypted_backup: Vec<u8>,
) -> Result<Vec<u8>, MobileCryptoError> {
    boundary(|| {
        if encrypted_backup.len() < XCHACHA20_NONCE_LEN + POLY1305_TAG_LEN ||
            encrypted_backup.len() > MAX_MOBILE_BACKUP_BYTES + XCHACHA20_NONCE_LEN + POLY1305_TAG_LEN
        {
            return Err(MobileCryptoError::InvalidInput);
        }
        let aad = mobile_backup_aad(&account_id, &backup_id)?;
        let encrypted = parse_envelope(&encrypted_backup)?;
        with_session(&session_handle, |vault_key| {
            decrypt_xchacha20(vault_key, &encrypted, &aad).map_err(map_crypto_error)
        })
    })
}

fn decode_recovery_code_v2(value: &str) -> Result<Zeroizing<Vec<u8>>, MobileCryptoError> {
    if value.len() != 43 || value.contains('=') {
        return Err(MobileCryptoError::InvalidInput);
    }
    let decoded = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(value)
            .map_err(|_| MobileCryptoError::InvalidInput)?,
    );
    if decoded.len() != RECOVERY_V2_CODE_LEN || URL_SAFE_NO_PAD.encode(decoded.as_slice()) != value {
        return Err(MobileCryptoError::InvalidInput);
    }
    Ok(decoded)
}

fn derive_recovery_key_v2(
    recovery_code: &[u8],
    salt: &[u8; RECOVERY_V2_SALT_LEN],
) -> Result<Zeroizing<[u8; KEY_LEN]>, MobileCryptoError> {
    let params = Params::new(65_536, 3, 4, Some(KEY_LEN))
        .map_err(|_| MobileCryptoError::Internal)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0_u8; KEY_LEN]);
    argon
        .hash_password_into(recovery_code, salt, key.as_mut())
        .map_err(|_| MobileCryptoError::Internal)?;
    Ok(key)
}

fn derive_recovery_signing_seed(
    vault_key: &[u8; KEY_LEN],
    auth_salt: &[u8; RECOVERY_V2_AUTH_SALT_LEN],
) -> Result<Zeroizing<[u8; 32]>, MobileCryptoError> {
    let hkdf = Hkdf::<Sha256>::new(Some(auth_salt), vault_key);
    let mut seed = Zeroizing::new([0_u8; 32]);
    hkdf.expand(RECOVERY_V2_SIGNING_INFO, seed.as_mut())
        .map_err(|_| MobileCryptoError::Internal)?;
    Ok(seed)
}

fn encrypt_recovery_packet_v2(
    recovery_key: &[u8; KEY_LEN],
    salt: &[u8; RECOVERY_V2_SALT_LEN],
    nonce: &[u8; XCHACHA20_NONCE_LEN],
    vault_key: &[u8; KEY_LEN],
    auth_salt: &[u8; RECOVERY_V2_AUTH_SALT_LEN],
) -> Result<Vec<u8>, MobileCryptoError> {
    let mut plaintext = Zeroizing::new([0_u8; RECOVERY_V2_PLAINTEXT_LEN]);
    plaintext[0] = RECOVERY_V2_VERSION;
    plaintext[1..1 + KEY_LEN].copy_from_slice(vault_key);
    plaintext[1 + KEY_LEN..].copy_from_slice(auth_salt);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(recovery_key));
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: plaintext.as_ref(),
                aad: RECOVERY_V2_AAD,
            },
        )
        .map_err(|_| MobileCryptoError::Internal)?;
    if ciphertext.len() != RECOVERY_V2_CIPHERTEXT_LEN {
        return Err(MobileCryptoError::Internal);
    }
    let mut packet = Vec::with_capacity(RECOVERY_V2_PACKET_LEN);
    packet.extend_from_slice(salt);
    packet.extend_from_slice(nonce);
    packet.extend_from_slice(&ciphertext);
    Ok(packet)
}

fn decrypt_recovery_packet_v2(
    recovery_key: &[u8; KEY_LEN],
    packet: &[u8],
) -> Result<Zeroizing<Vec<u8>>, MobileCryptoError> {
    if packet.len() != RECOVERY_V2_PACKET_LEN {
        return Err(MobileCryptoError::InvalidEnvelope);
    }
    let nonce = &packet[RECOVERY_V2_SALT_LEN..RECOVERY_V2_SALT_LEN + XCHACHA20_NONCE_LEN];
    let ciphertext = &packet[RECOVERY_V2_SALT_LEN + XCHACHA20_NONCE_LEN..];
    let cipher = XChaCha20Poly1305::new(Key::from_slice(recovery_key));
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                XNonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: RECOVERY_V2_AAD,
                },
            )
            .map_err(|_| MobileCryptoError::AuthenticationFailed)?,
    );
    if plaintext.len() != RECOVERY_V2_PLAINTEXT_LEN || plaintext[0] != RECOVERY_V2_VERSION {
        return Err(MobileCryptoError::AuthenticationFailed);
    }
    Ok(plaintext)
}

/// Open a v2 recovery packet without exposing the vault key or signing seed across FFI.
#[uniffi::export]
pub fn mobile_open_recovery_v2(
    recovery_code: String,
    encrypted_recovery_packet: Vec<u8>,
) -> Result<MobileRecoveryV2Open, MobileCryptoError> {
    boundary(|| {
        let recovery_code = Zeroizing::new(recovery_code);
        let recovery_code_bytes = decode_recovery_code_v2(recovery_code.as_str())?;
        if encrypted_recovery_packet.len() != RECOVERY_V2_PACKET_LEN {
            return Err(MobileCryptoError::InvalidEnvelope);
        }
        let mut salt = [0_u8; RECOVERY_V2_SALT_LEN];
        salt.copy_from_slice(&encrypted_recovery_packet[..RECOVERY_V2_SALT_LEN]);
        let recovery_key = derive_recovery_key_v2(recovery_code_bytes.as_slice(), &salt)?;
        let plaintext = decrypt_recovery_packet_v2(
            &*recovery_key,
            &encrypted_recovery_packet,
        )?;
        let mut vault_key = Zeroizing::new([0_u8; KEY_LEN]);
        vault_key.copy_from_slice(&plaintext[1..1 + KEY_LEN]);
        let mut auth_salt = Zeroizing::new([0_u8; RECOVERY_V2_AUTH_SALT_LEN]);
        auth_salt.copy_from_slice(&plaintext[1 + KEY_LEN..]);
        let signing_seed = derive_recovery_signing_seed(&*vault_key, &*auth_salt)?;
        let signing_public_key = SigningKey::from_bytes(&*signing_seed)
            .verifying_key()
            .to_bytes()
            .to_vec();
        let session_handle = insert_session(vault_key)?;
        let recovery_proof_handle = match insert_recovery_proof(
            session_handle.clone(),
            signing_seed,
        ) {
            Ok(handle) => handle,
            Err(error) => {
                if let Ok(mut entries) = sessions().lock() {
                    entries.remove(&session_handle);
                }
                return Err(error);
            }
        };
        Ok(MobileRecoveryV2Open {
            session_handle,
            recovery_proof_handle,
            signing_public_key,
        })
    })
}

/// Generate the next crash-safe recovery material for initial bootstrap or rotation.
#[uniffi::export]
pub fn mobile_prepare_recovery_rotation(
    session_handle: String,
) -> Result<MobileRecoveryV2Rotation, MobileCryptoError> {
    boundary(|| {
        if session_handle.is_empty() {
            return Err(MobileCryptoError::InvalidInput);
        }
        with_session(&session_handle, |vault_key| {
            let mut recovery_code = Zeroizing::new([0_u8; RECOVERY_V2_CODE_LEN]);
            let mut salt = [0_u8; RECOVERY_V2_SALT_LEN];
            let mut nonce = [0_u8; XCHACHA20_NONCE_LEN];
            let mut auth_salt = Zeroizing::new([0_u8; RECOVERY_V2_AUTH_SALT_LEN]);
            OsRng.fill_bytes(recovery_code.as_mut());
            OsRng.fill_bytes(&mut salt);
            OsRng.fill_bytes(&mut nonce);
            OsRng.fill_bytes(auth_salt.as_mut());
            let recovery_key = derive_recovery_key_v2(recovery_code.as_ref(), &salt)?;
            let encrypted_recovery_packet = encrypt_recovery_packet_v2(
                &*recovery_key,
                &salt,
                &nonce,
                vault_key,
                &*auth_salt,
            )?;
            let signing_seed = derive_recovery_signing_seed(vault_key, &*auth_salt)?;
            let signing_public_key = SigningKey::from_bytes(&*signing_seed)
                .verifying_key()
                .to_bytes()
                .to_vec();
            Ok(MobileRecoveryV2Rotation {
                recovery_code: URL_SAFE_NO_PAD.encode(recovery_code.as_ref()),
                encrypted_recovery_packet,
                signing_public_key,
            })
        })
    })
}

/// Sign the canonical Worker challenge once. The proof handle is consumed on every attempt.
#[uniffi::export]
pub fn mobile_sign_recovery_finish(
    recovery_proof_handle: String,
    transcript: Vec<u8>,
) -> Result<Vec<u8>, MobileCryptoError> {
    boundary(|| {
        if recovery_proof_handle.is_empty() {
            return Err(MobileCryptoError::InvalidInput);
        }
        let transcript = Zeroizing::new(transcript);
        let proof = take_recovery_proof(&recovery_proof_handle)?;
        if transcript.len() > MAX_RECOVERY_TRANSCRIPT_BYTES
            || !transcript.starts_with(RECOVERY_V2_FINISH_PREFIX)
        {
            return Err(MobileCryptoError::InvalidInput);
        }
        with_session(&proof.session_handle, |_| Ok(()))?;
        Ok(SigningKey::from_bytes(&*proof.signing_seed)
            .sign(transcript.as_slice())
            .to_bytes()
            .to_vec())
    })
}

#[uniffi::export]
pub fn mobile_recovery_discard_proof(
    recovery_proof_handle: String,
) -> Result<(), MobileCryptoError> {
    boundary(|| {
        if recovery_proof_handle.is_empty() {
            return Err(MobileCryptoError::InvalidInput);
        }
        recovery_proofs()
            .lock()
            .map_err(|_| MobileCryptoError::Internal)?
            .remove(&recovery_proof_handle);
        Ok(())
    })
}

#[uniffi::export]
pub fn mobile_cancel_recovery(
    recovery_proof_handle: String,
    session_handle: String,
) -> Result<(), MobileCryptoError> {
    boundary(|| {
        if recovery_proof_handle.is_empty() || session_handle.is_empty() {
            return Err(MobileCryptoError::InvalidInput);
        }
        recovery_proofs()
            .lock()
            .map_err(|_| MobileCryptoError::Internal)?
            .remove(&recovery_proof_handle);
        remove_recovery_proofs_for_session(&session_handle)?;
        sessions()
            .lock()
            .map_err(|_| MobileCryptoError::Internal)?
            .remove(&session_handle);
        Ok(())
    })
}

#[uniffi::export]
/// Legacy v1 packet support for an already-authenticated migration only.
pub fn mobile_generate_recovery_packet(
    session_handle: String,
    recovery_code: String,
) -> Result<Vec<u8>, MobileCryptoError> {
    boundary(|| {
        if recovery_code.len() < 32 || recovery_code.len() > 256 {
            return Err(MobileCryptoError::InvalidInput);
        }
        let recovery_code = Zeroizing::new(recovery_code);
        let recovery_key = Zeroizing::new(
            derive_recovery_key(recovery_code.as_str()).map_err(map_crypto_error)?,
        );
        with_session(&session_handle, |vault_key| {
            encrypt_recovery_packet(recovery_key.as_ref(), vault_key)
                .map(envelope)
                .map_err(map_crypto_error)
        })
    })
}

#[uniffi::export]
/// Legacy v1 packet support for an already-authenticated migration only.
pub fn mobile_restore_recovery_packet(
    recovery_code: String,
    encrypted_recovery_packet: Vec<u8>,
) -> Result<String, MobileCryptoError> {
    boundary(|| {
        if recovery_code.len() < 32 || recovery_code.len() > 256 {
            return Err(MobileCryptoError::InvalidInput);
        }
        let recovery_code = Zeroizing::new(recovery_code);
        let recovery_key = Zeroizing::new(
            derive_recovery_key(recovery_code.as_str()).map_err(map_crypto_error)?,
        );
        let packet = parse_envelope(&encrypted_recovery_packet)?;
        let vault_key = Zeroizing::new(
            decrypt_recovery_packet(recovery_key.as_ref(), &packet).map_err(map_crypto_error)?,
        );
        let key: [u8; KEY_LEN] = vault_key
            .as_slice()
            .try_into()
            .map_err(|_| MobileCryptoError::AuthenticationFailed)?;
        insert_session(Zeroizing::new(key))
    })
}

#[uniffi::export]
pub fn mobile_generate_recovery_code() -> Result<String, MobileCryptoError> {
    boundary(|| {
        let mut bytes = Zeroizing::new([0_u8; 32]);
        OsRng.fill_bytes(bytes.as_mut());
        Ok(URL_SAFE_NO_PAD.encode(bytes.as_ref()))
    })
}

#[uniffi::export]
pub fn mobile_session_is_valid(session_handle: String) -> Result<bool, MobileCryptoError> {
    boundary(|| {
        if session_handle.is_empty() {
            return Ok(false);
        }
        let mut entries = sessions().lock().map_err(|_| MobileCryptoError::Internal)?;
        remove_expired_sessions(&mut entries, Instant::now());
        Ok(entries.contains_key(&session_handle))
    })
}

#[uniffi::export]
pub fn mobile_lock_vault(session_handle: String) -> Result<(), MobileCryptoError> {
    boundary(|| {
        if session_handle.is_empty() {
            return Err(MobileCryptoError::InvalidInput);
        }
        let removed = {
            sessions()
                .lock()
                .map_err(|_| MobileCryptoError::Internal)?
                .remove(&session_handle)
        };
        remove_recovery_proofs_for_session(&session_handle)?;
        removed.ok_or(MobileCryptoError::InvalidSession)?;
        Ok(())
    })
}

#[uniffi::export]
pub fn mobile_lock_all_vaults() -> Result<(), MobileCryptoError> {
    boundary(|| {
        sessions()
            .lock()
            .map_err(|_| MobileCryptoError::Internal)?
            .clear();
        opaque_login_states()
            .lock()
            .map_err(|_| MobileCryptoError::Internal)?
            .clear();
        opaque_registration_states()
            .lock()
            .map_err(|_| MobileCryptoError::Internal)?
            .clear();
        recovery_proofs()
            .lock()
            .map_err(|_| MobileCryptoError::Internal)?
            .clear();
        Ok(())
    })
}

#[uniffi::export]
pub fn mobile_generate_password(
    length: u32,
    include_upper: bool,
    include_lower: bool,
    include_digits: bool,
    include_symbols: bool,
) -> Result<String, MobileCryptoError> {
    boundary(|| {
        const UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
        const DIGITS: &[u8] = b"0123456789";
        const SYMBOLS: &[u8] = b"!@#$%^&*()-_=+[]{}:,.?";
        let classes: Vec<&[u8]> = [
            (include_upper, UPPER),
            (include_lower, LOWER),
            (include_digits, DIGITS),
            (include_symbols, SYMBOLS),
        ]
        .into_iter()
        .filter_map(|(enabled, class)| enabled.then_some(class))
        .collect();
        if classes.is_empty() || length < classes.len() as u32 || !(4..=256).contains(&length) {
            return Err(MobileCryptoError::InvalidInput);
        }
        let alphabet: Vec<u8> = classes.iter().flat_map(|class| class.iter().copied()).collect();
        let mut output = Vec::with_capacity(length as usize);
        for class in classes {
            output.push(class[random_index(class.len())?]);
        }
        while output.len() < length as usize {
            output.push(alphabet[random_index(alphabet.len())?]);
        }
        for index in (1..output.len()).rev() {
            let swap = random_index(index + 1)?;
            output.swap(index, swap);
        }
        String::from_utf8(output).map_err(|_| MobileCryptoError::Internal)
    })
}

fn random_index(upper: usize) -> Result<usize, MobileCryptoError> {
    let upper = u32::try_from(upper).map_err(|_| MobileCryptoError::InvalidInput)?;
    if upper == 0 {
        return Err(MobileCryptoError::InvalidInput);
    }
    let zone = u32::MAX - (u32::MAX % upper);
    loop {
        let value = OsRng.next_u32();
        if value < zone {
            return Ok((value % upper) as usize);
        }
    }
}

#[derive(Clone, Copy)]
enum TotpAlgorithm {
    Sha1,
    Sha256,
    Sha512,
}

#[uniffi::export]
pub fn mobile_generate_totp(
    secret_or_uri: String,
    timestamp_seconds: u64,
) -> Result<MobileTotp, MobileCryptoError> {
    boundary(|| {
        let (secret, algorithm, digits, period) = parse_totp_input(&secret_or_uri)?;
        let counter = timestamp_seconds / u64::from(period);
        let counter_bytes = counter.to_be_bytes();
        let digest = match algorithm {
            TotpAlgorithm::Sha1 => hmac_sha1(&secret, &counter_bytes)?,
            TotpAlgorithm::Sha256 => hmac_sha256(&secret, &counter_bytes)?,
            TotpAlgorithm::Sha512 => hmac_sha512(&secret, &counter_bytes)?,
        };
        let offset = usize::from(digest[digest.len() - 1] & 0x0f);
        if offset + 4 > digest.len() {
            return Err(MobileCryptoError::Internal);
        }
        let binary = (u32::from(digest[offset] & 0x7f) << 24)
            | (u32::from(digest[offset + 1]) << 16)
            | (u32::from(digest[offset + 2]) << 8)
            | u32::from(digest[offset + 3]);
        let modulo = 10_u32.pow(digits);
        let code = format!("{:0width$}", binary % modulo, width = digits as usize);
        Ok(MobileTotp {
            code,
            valid_for_seconds: period - (timestamp_seconds % u64::from(period)) as u32,
        })
    })
}

fn hmac_sha1(key: &[u8], message: &[u8]) -> Result<Vec<u8>, MobileCryptoError> {
    let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(key)
        .map_err(|_| MobileCryptoError::InvalidInput)?;
    mac.update(message);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> Result<Vec<u8>, MobileCryptoError> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key)
        .map_err(|_| MobileCryptoError::InvalidInput)?;
    mac.update(message);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn hmac_sha512(key: &[u8], message: &[u8]) -> Result<Vec<u8>, MobileCryptoError> {
    let mut mac = <Hmac<Sha512> as Mac>::new_from_slice(key)
        .map_err(|_| MobileCryptoError::InvalidInput)?;
    mac.update(message);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn parse_totp_input(
    value: &str,
) -> Result<(Zeroizing<Vec<u8>>, TotpAlgorithm, u32, u32), MobileCryptoError> {
    if value.is_empty() || value.len() > 4096 {
        return Err(MobileCryptoError::InvalidInput);
    }
    let (secret, algorithm, digits, period) = if let Some(uri) = value.strip_prefix("otpauth://") {
        let (path, query) = uri.split_once('?').ok_or(MobileCryptoError::InvalidInput)?;
        if !path.starts_with("totp/") || path.len() <= 5 {
            return Err(MobileCryptoError::InvalidInput);
        }
        let mut params = HashMap::new();
        for pair in query.split('&') {
            let (key, raw_value) = pair.split_once('=').ok_or(MobileCryptoError::InvalidInput)?;
            let key = percent_decode(key)?;
            if params.insert(key, percent_decode(raw_value)?).is_some() {
                return Err(MobileCryptoError::InvalidInput);
            }
        }
        let secret = params.remove("secret").ok_or(MobileCryptoError::InvalidInput)?;
        let algorithm = match params.remove("algorithm").as_deref().unwrap_or("SHA1") {
            "SHA1" => TotpAlgorithm::Sha1,
            "SHA256" => TotpAlgorithm::Sha256,
            "SHA512" => TotpAlgorithm::Sha512,
            _ => return Err(MobileCryptoError::InvalidInput),
        };
        let digits = params
            .remove("digits")
            .map(|digits| digits.parse::<u32>())
            .transpose()
            .map_err(|_| MobileCryptoError::InvalidInput)?
            .unwrap_or(6);
        let period = params
            .remove("period")
            .map(|period| period.parse::<u32>())
            .transpose()
            .map_err(|_| MobileCryptoError::InvalidInput)?
            .unwrap_or(30);
        (secret, algorithm, digits, period)
    } else {
        (value.to_owned(), TotpAlgorithm::Sha1, 6, 30)
    };
    if !(6..=8).contains(&digits) || !(15..=120).contains(&period) {
        return Err(MobileCryptoError::InvalidInput);
    }
    Ok((
        Zeroizing::new(decode_base32_secret(&secret)?),
        algorithm,
        digits,
        period,
    ))
}

fn percent_decode(value: &str) -> Result<String, MobileCryptoError> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let high = hex_value(bytes[index + 1])?;
                let low = hex_value(bytes[index + 2])?;
                output.push((high << 4) | low);
                index += 3;
            }
            b'%' => return Err(MobileCryptoError::InvalidInput),
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(output).map_err(|_| MobileCryptoError::InvalidInput)
}

fn hex_value(value: u8) -> Result<u8, MobileCryptoError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(MobileCryptoError::InvalidInput),
    }
}

fn decode_base32_secret(value: &str) -> Result<Vec<u8>, MobileCryptoError> {
    let normalized = value.trim().trim_end_matches('=');
    if normalized.is_empty() || normalized.len() > 2048 || normalized.contains('=') {
        return Err(MobileCryptoError::InvalidInput);
    }
    let mut accumulator = 0_u32;
    let mut bits = 0_u8;
    let mut output = Vec::with_capacity(normalized.len() * 5 / 8);
    for byte in normalized.bytes() {
        let value = match byte.to_ascii_uppercase() {
            b'A'..=b'Z' => byte.to_ascii_uppercase() - b'A',
            b'2'..=b'7' => byte - b'2' + 26,
            _ => return Err(MobileCryptoError::InvalidInput),
        };
        accumulator = (accumulator << 5) | u32::from(value);
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            output.push((accumulator >> bits) as u8);
            accumulator &= (1_u32 << bits) - 1;
        }
    }
    if output.len() < 10 || (bits > 0 && accumulator != 0) {
        return Err(MobileCryptoError::InvalidInput);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{derive_item_key, encrypt_item as core_encrypt_item};
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use std::io::{BufRead, BufReader, Write};
    use std::path::Path;
    use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

    #[test]
    fn session_encrypts_decrypts_then_lock_invalidates_handle() {
        let password = "correct horse battery staple";
        let salt = vec![7_u8; 16];
        let handle = mobile_unlock_vault(password.into(), salt, 8192, 1, 1).unwrap();
        let encrypted = mobile_encrypt_item(
            handle.clone(),
            br#"{"title":"secret"}"#.to_vec(),
            "item-1".into(),
        )
        .unwrap();
        assert_eq!(
            mobile_decrypt_item(
                handle.clone(),
                encrypted.encrypted_item_key,
                encrypted.encrypted_payload,
                "item-1".into(),
            )
            .unwrap(),
            br#"{"title":"secret"}"#,
        );
        mobile_lock_vault(handle.clone()).unwrap();
        assert!(matches!(
            mobile_decrypt_item(handle, vec![0; 40], vec![0; 40], "item-1".into()),
            Err(MobileCryptoError::InvalidSession)
        ));
    }

    #[test]
    fn backup_authentication_binds_account_and_object_id() {
        let handle = insert_session(Zeroizing::new([9_u8; KEY_LEN])).unwrap();
        let account_id = "11111111-1111-4111-8111-111111111111";
        let backup_id = "22222222-2222-4222-8222-222222222222";
        let encrypted = mobile_encrypt_backup(
            handle.clone(),
            account_id.into(),
            backup_id.into(),
            b"encrypted-envelope snapshot".to_vec(),
        )
        .unwrap();
        assert_eq!(
            mobile_decrypt_backup(
                handle.clone(),
                account_id.into(),
                backup_id.into(),
                encrypted.clone(),
            )
            .unwrap(),
            b"encrypted-envelope snapshot",
        );

        let mut tampered = encrypted.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(matches!(
            mobile_decrypt_backup(handle.clone(), account_id.into(), backup_id.into(), tampered),
            Err(MobileCryptoError::AuthenticationFailed)
        ));
        assert!(matches!(
            mobile_decrypt_backup(
                handle.clone(),
                account_id.into(),
                "33333333-3333-4333-8333-333333333333".into(),
                encrypted.clone(),
            ),
            Err(MobileCryptoError::AuthenticationFailed)
        ));
        assert!(matches!(
            mobile_decrypt_backup(
                handle,
                "44444444-4444-4444-8444-444444444444".into(),
                backup_id.into(),
                encrypted,
            ),
            Err(MobileCryptoError::AuthenticationFailed)
        ));
    }

    #[test]
    fn device_and_recovery_packets_open_sessions() {
        let pair = mobile_generate_device_keypair().unwrap();
        let vault_key = Zeroizing::new(generate_key());
        let device_packet = envelope(crate::encrypt_for_device(&pair.public_key, vault_key.as_ref()).unwrap());
        let device_handle = mobile_open_device_vault(pair.private_key, device_packet).unwrap();
        let recovery_code = mobile_generate_recovery_code().unwrap();
        let recovery_packet =
            mobile_generate_recovery_packet(device_handle, recovery_code.clone()).unwrap();
        let restored = mobile_restore_recovery_packet(recovery_code, recovery_packet).unwrap();
        assert!(mobile_session_is_valid(restored).unwrap());
    }

    #[test]
    fn recovery_v2_roundtrip_signs_once_and_lock_clears_proof() {
        let pair = mobile_generate_device_keypair().unwrap();
        let created = mobile_create_vault_for_device(pair.public_key).unwrap();
        let rotation = mobile_prepare_recovery_rotation(created.session_handle.clone()).unwrap();
        assert_eq!(rotation.recovery_code.len(), 43);
        assert_eq!(rotation.encrypted_recovery_packet.len(), RECOVERY_V2_PACKET_LEN);
        assert_eq!(rotation.signing_public_key.len(), 32);

        let opened = mobile_open_recovery_v2(
            rotation.recovery_code,
            rotation.encrypted_recovery_packet,
        )
        .unwrap();
        assert_eq!(opened.signing_public_key, rotation.signing_public_key);
        let transcript = [RECOVERY_V2_FINISH_PREFIX, b"canonical-test-transcript"].concat();
        let signature = mobile_sign_recovery_finish(
            opened.recovery_proof_handle.clone(),
            transcript.clone(),
        )
        .unwrap();
        let public_key: [u8; 32] = opened.signing_public_key.try_into().unwrap();
        let signature = Signature::from_slice(&signature).unwrap();
        VerifyingKey::from_bytes(&public_key)
            .unwrap()
            .verify(&transcript, &signature)
            .unwrap();
        assert!(matches!(
            mobile_sign_recovery_finish(opened.recovery_proof_handle, transcript),
            Err(MobileCryptoError::RecoveryProofExpired)
        ));

        let next = mobile_prepare_recovery_rotation(opened.session_handle.clone()).unwrap();
        let next_opened = mobile_open_recovery_v2(
            next.recovery_code,
            next.encrypted_recovery_packet,
        )
        .unwrap();
        mobile_lock_vault(next_opened.session_handle).unwrap();
        assert!(matches!(
            mobile_sign_recovery_finish(
                next_opened.recovery_proof_handle,
                [RECOVERY_V2_FINISH_PREFIX, b"after-lock"].concat(),
            ),
            Err(MobileCryptoError::RecoveryProofExpired)
        ));
    }

    #[test]
    fn recovery_v2_rejects_tampering_and_rotation_changes_signing_key() {
        let pair = mobile_generate_device_keypair().unwrap();
        let created = mobile_create_vault_for_device(pair.public_key).unwrap();
        let first = mobile_prepare_recovery_rotation(created.session_handle.clone()).unwrap();
        let second = mobile_prepare_recovery_rotation(created.session_handle).unwrap();
        assert_ne!(first.signing_public_key, second.signing_public_key);

        let mut tampered = first.encrypted_recovery_packet;
        *tampered.last_mut().unwrap() ^= 1;
        assert!(matches!(
            mobile_open_recovery_v2(first.recovery_code, tampered),
            Err(MobileCryptoError::AuthenticationFailed)
        ));
    }

    #[test]
    fn mobile_kdf_rejects_resource_exhaustion_params() {
        assert!(matches!(
            mobile_unlock_vault("password".into(), vec![7_u8; 16], u32::MAX, 1, 1),
            Err(MobileCryptoError::InvalidKdfParams)
        ));
    }

    #[test]
    fn crypto_core_backup_opens_and_rejects_wrong_password() {
        let password = "backup password";
        let salt = vec![11_u8; 16];
        let params = KdfParams { memory_kib: 8192, iterations: 1, parallelism: 1 };
        let key = Zeroizing::new(derive_vault_key(password, &salt, params).unwrap());
        let plaintext = br#"{"schemaVersion":1,"items":[]}"#;
        let sealed = envelope(
            encrypt_xchacha20(key.as_ref(), plaintext, CRYPTO_CORE_BACKUP_AAD).unwrap(),
        );

        assert_eq!(
            mobile_decrypt_crypto_core_backup(
                password.into(), salt.clone(), 8192, 1, 1, sealed.clone(),
            )
            .unwrap(),
            plaintext,
        );
        assert!(matches!(
            mobile_decrypt_crypto_core_backup(
                "wrong".into(), salt, 8192, 1, 1, sealed,
            ),
            Err(MobileCryptoError::AuthenticationFailed)
        ));
    }

    #[test]
    fn password_generator_includes_every_selected_class() {
        let password = mobile_generate_password(32, true, true, true, true).unwrap();
        assert_eq!(password.len(), 32);
        assert!(password.bytes().any(|byte| byte.is_ascii_uppercase()));
        assert!(password.bytes().any(|byte| byte.is_ascii_lowercase()));
        assert!(password.bytes().any(|byte| byte.is_ascii_digit()));
        assert!(password.bytes().any(|byte| !byte.is_ascii_alphanumeric()));
    }

    #[test]
    fn totp_matches_rfc_6238_sha_vectors() {
        let sha1 = mobile_generate_totp(
            "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA1&digits=8&period=30".into(),
            59,
        )
        .unwrap();
        let sha256 = mobile_generate_totp(
            "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA&algorithm=SHA256&digits=8&period=30".into(),
            59,
        )
        .unwrap();
        let sha512 = mobile_generate_totp(
            "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA&algorithm=SHA512&digits=8&period=30".into(),
            59,
        )
        .unwrap();
        assert_eq!(sha1.code, "94287082");
        assert_eq!(sha256.code, "46119246");
        assert_eq!(sha512.code, "90693936");
        assert_eq!(sha1.valid_for_seconds, 1);
    }

    #[test]
    fn legacy_wrapped_item_vector_remains_compatible() {
        let password = "password";
        let salt = vec![9_u8; 16];
        let params = KdfParams {
            memory_kib: 8192,
            iterations: 1,
            parallelism: 1,
        };
        let handle = mobile_unlock_vault(password.into(), salt.clone(), 8192, 1, 1).unwrap();
        let vault_key = Zeroizing::new(derive_vault_key(password, &salt, params).unwrap());
        let item_key = Zeroizing::new(derive_item_key(vault_key.as_ref(), "item-1").unwrap());
        let wrapped = encrypt_xchacha20(
            vault_key.as_ref(),
            item_key.as_ref(),
            b"zero-vault:item-key-wrap:item-1",
        )
        .unwrap();
        let payload = core_encrypt_item(item_key.as_ref(), b"secret", "item-1").unwrap();
        assert_eq!(
            mobile_decrypt_item(handle, envelope(wrapped), envelope(payload), "item-1".into())
                .unwrap(),
            b"secret"
        );
    }

    #[test]
    fn native_client_interoperates_with_serenity_kit_server() {
        const EMAIL: &str = "rust-mobile-interop@example.invalid";
        const PASSWORD: &str = "synthetic interop password 2026";
        const SERVER_IDENTIFIER: &str = "zero-vault";

        let mut server = SerenityNodeServer::start();

        let registration = mobile_opaque_start_registration(
            PASSWORD.into(),
            EMAIL.into(),
            SERVER_IDENTIFIER.into(),
        )
        .expect("Rust registration start must succeed");
        let registration_reply = server.exchange(&format!("REGISTER\t{}", registration.request));
        let registration_parts: Vec<&str> = registration_reply.split('\t').collect();
        assert_eq!(registration_parts.first(), Some(&"REGISTRATION"));
        assert_eq!(registration_parts.len(), 3, "unexpected registration response");

        let registered = mobile_opaque_finish_registration(
            registration.state_handle,
            registration_parts[1].to_owned(),
        )
        .expect("Rust registration finish must accept Serenity response");
        assert_eq!(registered.server_static_public_key, registration_parts[2]);
        assert_eq!(
            server.exchange(&format!("RECORD\t{}", registered.registration_record)),
            "STORED",
        );

        let login = mobile_opaque_start_login(
            PASSWORD.into(),
            EMAIL.into(),
            SERVER_IDENTIFIER.into(),
        )
        .expect("Rust login start must succeed");
        let login_reply = server.exchange(&format!("LOGIN\t{}", login.request));
        let login_parts: Vec<&str> = login_reply.split('\t').collect();
        assert_eq!(login_parts.first(), Some(&"LOGIN_RESPONSE"));
        assert_eq!(login_parts.len(), 2, "unexpected login response");

        let finished = mobile_opaque_finish_login(login.state_handle, login_parts[1].to_owned())
            .expect("Rust login finish must accept Serenity response");
        assert_eq!(
            server.exchange(&format!("FINISH\t{}", finished.finish_login_request)),
            "FINISHED",
            "Serenity server must authenticate the Rust client proof",
        );
        server.wait_for_success();
    }

    struct SerenityNodeServer {
        child: Child,
        stdin: ChildStdin,
        stdout: BufReader<ChildStdout>,
    }

    impl SerenityNodeServer {
        fn start() -> Self {
            let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
            let web_workspace = workspace.join("apps/web");
            let package = web_workspace.join("node_modules/@serenity-kit/opaque/package.json");
            assert!(
                package.is_file(),
                "@serenity-kit/opaque@1.1.0 must be installed before the interop gate runs",
            );
            let package_manifest = std::fs::read_to_string(&package)
                .expect("read @serenity-kit/opaque package manifest");
            assert!(
                package_manifest.contains("\"version\": \"1.1.0\""),
                "OPAQUE interop gate requires exactly @serenity-kit/opaque@1.1.0",
            );
            let mut child = Command::new("node")
                .args(["-e", SERENITY_SERVER_SCRIPT])
                .current_dir(web_workspace)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .expect("Node.js must be available for the OPAQUE interoperability gate");
            let stdin = child.stdin.take().expect("Node stdin must be piped");
            let stdout = BufReader::new(child.stdout.take().expect("Node stdout must be piped"));
            Self { child, stdin, stdout }
        }

        fn exchange(&mut self, command: &str) -> String {
            writeln!(self.stdin, "{command}").expect("write command to Serenity server");
            self.stdin.flush().expect("flush command to Serenity server");
            let mut line = String::new();
            let bytes = self
                .stdout
                .read_line(&mut line)
                .expect("read response from Serenity server");
            assert_ne!(bytes, 0, "Serenity server exited before replying");
            line.trim_end_matches(['\r', '\n']).to_owned()
        }

        fn wait_for_success(mut self) {
            let status = self.child.wait().expect("wait for Serenity server");
            assert!(status.success(), "Serenity server process failed: {status}");
        }
    }

    impl Drop for SerenityNodeServer {
        fn drop(&mut self) {
            if self.child.try_wait().ok().flatten().is_none() {
                let _ = self.child.kill();
                let _ = self.child.wait();
            }
        }
    }

    const SERENITY_SERVER_SCRIPT: &str = r#"
const readline = require("node:readline");
const opaque = require("@serenity-kit/opaque");

(async () => {
  await opaque.ready;
  const userIdentifier = "rust-mobile-interop@example.invalid";
  const identifiers = { client: userIdentifier, server: "zero-vault" };
  const serverSetup = opaque.server.createSetup();
  const serverPublicKey = opaque.server.getPublicKey(serverSetup);
  let registrationRecord;
  let serverLoginState;
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    const separator = line.indexOf("\t");
    const command = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1);
    if (command === "REGISTER") {
      const { registrationResponse } = opaque.server.createRegistrationResponse({
        serverSetup,
        userIdentifier,
        registrationRequest: value,
      });
      process.stdout.write(`REGISTRATION\t${registrationResponse}\t${serverPublicKey}\n`);
    } else if (command === "RECORD") {
      registrationRecord = value;
      process.stdout.write("STORED\n");
    } else if (command === "LOGIN") {
      if (!registrationRecord) throw new Error("registration record is missing");
      const started = opaque.server.startLogin({
        serverSetup,
        registrationRecord,
        startLoginRequest: value,
        userIdentifier,
        identifiers,
      });
      serverLoginState = started.serverLoginState;
      process.stdout.write(`LOGIN_RESPONSE\t${started.loginResponse}\n`);
    } else if (command === "FINISH") {
      if (!serverLoginState) throw new Error("server login state is missing");
      opaque.server.finishLogin({
        serverLoginState,
        finishLoginRequest: value,
        identifiers,
      });
      process.stdout.write("FINISHED\n");
      lines.close();
    } else {
      throw new Error(`unknown interop command: ${command}`);
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
"#;
}

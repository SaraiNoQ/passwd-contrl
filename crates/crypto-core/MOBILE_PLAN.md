# Mobile Reuse Plan for crypto-core

This document describes how to build and integrate `crypto-core` for Android and iOS clients.

## Build Targets

### Android

**Recommended approach: UniFFI (Mozilla)**

UniFFI generates Kotlin bindings from a Rust UDL (UniFFI Definition Language) file or proc-macros.

1. Add `uniffi` crate to `Cargo.toml` and annotate exported functions with `#[uniffi::export]`.
2. Create `src/crypto.udl` describing the public API surface.
3. Build for Android targets:
   - `aarch64-linux-android` (arm64-v8a)
   - `x86_64-linux-android` (for emulator)
   - Optionally `armv7-linux-androideabi` (armeabi-v7a)
4. Use `cargo-ndk` or the Android NDK toolchain directly.
5. UniFFI generates a Kotlin JAR that loads the `.so` via `System.loadLibrary`.

**Alternative: Direct JNI**

Write JNI wrappers manually with `jni` crate. More control, more boilerplate.

**Build command sketch:**

```sh
# Install targets
rustup target add aarch64-linux-android x86_64-linux-android

# Build
cargo ndk -t arm64-v8a -t x86_64 -o app/src/main/jniLibs build --release
```

### iOS

**Recommended approach: XCFramework via `cargo-xcode` or `swift-bridge`**

1. Build for iOS targets:
   - `aarch64-apple-ios` (device)
   - `x86_64-apple-ios` (simulator, Intel)
   - `aarch64-apple-ios-sim` (simulator, Apple Silicon)
2. Create a universal static library or XCFramework.
3. Use `swift-bridge` or `cbindgen` to generate a C header, then wrap in a Swift module.

**Alternative: UniFFI for iOS**

UniFFI also generates Swift bindings. Same UDL file serves both platforms.

**Build command sketch:**

```sh
# Install targets
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim

# Build static libs
cargo build --release --target aarch64-apple-ios
cargo build --release --target x86_64-apple-ios
cargo build --release --target aarch64-apple-ios-sim

# Create XCFramework
xcodebuild -create-xcframework \
  -library target/aarch64-apple-ios/release/libcrypto_core.a -headers include/ \
  -library target/x86_64-apple-ios/release/libcrypto_core.a -headers include/ \
  -library target/aarch64-apple-ios-sim/release/libcrypto_core.a -headers include/ \
  -output CryptoCore.xcframework
```

## Functions to Expose

All public functions in `lib.rs` should be exposed to mobile:

| Function | Purpose | Mobile use case |
|---|---|---|
| `derive_vault_key` | Argon2id KDF | Unlock vault on login |
| `encrypt_xchacha20` | Encrypt vault snapshot | Save vault locally |
| `decrypt_xchacha20` | Decrypt vault snapshot | Load vault |
| `derive_item_key` | HKDF per-item key derivation | Item-level sync encryption |
| `encrypt_item` | Encrypt single credential | Sync to server |
| `decrypt_item` | Decrypt single credential | Receive from sync |
| `derive_recovery_key` | Argon2id from recovery code | Recovery flow |
| `encrypt_recovery_packet` | Wrap vault key for recovery | Create recovery |
| `decrypt_recovery_packet` | Unwrap vault key from recovery | Recover vault |
| `generate_device_keypair` | X25519 keypair | Device trust enrollment |
| `encrypt_for_device` | ECDH + encrypt vault key | Share vault to new device |
| `decrypt_on_device` | ECDH + decrypt vault key | Receive vault on device |
| `generate_salt` | Random 16-byte salt | KDF salt generation |
| `generate_key` | Random 32-byte key | Random key generation |

## Security Considerations for Mobile Key Storage

### Android

- Use `AndroidKeyStore` to protect the vault key at rest.
- Wrap the vault key with a key stored in the hardware-backed keystore (TEE/StrongBox).
- Require biometric or device credential authentication before unwrapping.
- Never log the master password, derived keys, or plaintext vault contents.
- Clear keys from memory when the app is backgrounded or the vault is locked.

### iOS

- Use the iOS Keychain with `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`.
- Enable `SecAccessControl` with biometric requirement for vault key access.
- Use `kSecAttrSynchronizable = false` to prevent vault keys from syncing via iCloud Keychain.
- Clear sensitive memory on `applicationDidEnterBackground`.
- Consider using the Secure Enclave for key wrapping if available.

### Both Platforms

- The Rust `generate_key()` function uses `OsRng` which maps to the platform CSPRNG on both Android and iOS.
- Argon2id memory parameters may need to be reduced on mobile devices with limited RAM. Consider `memory_kib: 65536` for desktop and `memory_kib: 19456` for mobile, with a runtime negotiation.
- Never store the master password in SharedPreferences/UserDefaults. Store only the encrypted vault blob and the KDF salt.

## Recommended Mobile Crypto Flow

```
1. User enters master password
2. Mobile calls derive_vault_key(password, salt, params) -> vault_key
3. Mobile stores vault_key in platform keystore (wrapped by hardware key)
4. Mobile calls decrypt_xchacha20(vault_key, encrypted_snapshot, aad) -> plaintext
5. Parse plaintext as VaultSnapshot JSON

For sync:
6. For each item: derive_item_key(vault_key, item_id) -> item_key
7. encrypt_item(item_key, item_json, item_id) -> encrypted_blob
8. Upload encrypted_blob to sync API

For device trust (adding new device):
9. New device: generate_device_keypair() -> (private, public)
10. Old device: encrypt_for_device(new_device_public, vault_key) -> blob
11. Transfer blob to new device (via QR code or server relay)
12. New device: decrypt_on_device(private_key, blob) -> vault_key

For recovery:
13. derive_recovery_key(recovery_code) -> recovery_key
14. encrypt_recovery_packet(recovery_key, vault_key) -> packet
15. Store packet on server (it's opaque to the server)

Recovery unlock:
16. derive_recovery_key(user_enters_code) -> recovery_key
17. decrypt_recovery_packet(recovery_key, packet) -> vault_key
```

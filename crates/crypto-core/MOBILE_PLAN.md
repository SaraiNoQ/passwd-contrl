# crypto-core Android / UniFFI Plan

Last updated: 2026-07-16

Android is the current mobile target. All Rust Android-target installation, binding generation, native compilation and tests run inside `zero-vault-android-dev` on `root@campus-server`; never run them locally.

> **Current status:** Gradle cargo-ndk/binding tasks, UniFFI Kotlin adapter, Expo Module and Kotlin Repository are wired. A historical 2026-07-16 snapshot passed the two Android ABIs, generated Kotlin bindings, debug APK, API 33–36 instrumented matrix and real Rust client to Worker Serenity OPAQUE interoperability; `OPAQUE_INTEROP_VERIFIED` is enabled. Current and future automated Android validation runs only on API 36, while `minSdk 26` remains an install-compatibility declaration. Later source changes still require a fresh fingerprint-matched run, and device/recovery business flows still require end-to-end evidence.

## Target supported output

- UniFFI Kotlin bindings consumed by the local Expo Module.
- `arm64-v8a` and `x86_64` shared libraries built with NDK `27.1.12297006` and cargo-ndk.
- No 32-bit ABI and no iOS artifact in the current scope.

## Export surface

Expose product operations, not raw key material: initialize device, OPAQUE start/finish, unlock/lock, item encrypt/decrypt, device packet encrypt/decrypt and recovery packet operations. Kotlin must keep key-bearing types opaque; the Expo Module returns only a short-lived session handle and sanitized DTOs.

Rust errors cross FFI as stable codes. Panic must not cross FFI. Password/key/plaintext buffers are zeroized after use, and cancellation/lock invalidates all outstanding handles.

## Compatibility gate

Native and WASM must share versioned envelopes, KDF parameters, AAD and device/recovery packet formats. Fixed synthetic vectors cover success, wrong key, tamper, truncation and unknown version. Android does not implement legacy `webcrypto-mvp`; users migrate those vaults in Web first.

Builds are driven by the remote scripts and copied into the Expo native module's generated `jniLibs` only during remote prebuild. Generated bindings are versioned if required for reproducibility; compiled `.so`, Cargo target and Gradle outputs are never committed.

The gate is an APK-level call, not merely `cargo ndk`: both ABIs must be present, `getStatus()` must report the expected protocol, and session/encrypt/decrypt/tamper behavior must run through Expo Module → Kotlin → UniFFI. OPAQUE can be enabled only after a remote compatibility report against the Worker implementation is archived with a non-stale source fingerprint.

See `docs/android-dev/native-bridge.md` and `docs/android-dev/security.md`.

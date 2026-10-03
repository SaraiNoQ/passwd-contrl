# API 36 Autofill / Credential Provider fixture

`com.zerovault.autofillfixture` is a standalone relying-party test app. It has
one username field, one password field, an explicit Autofill request button,
and an AndroidX Credential Manager button using `GetPasswordOption`. Filled
values are visible in the fields, but are never persisted or logged; the
window uses `FLAG_SECURE`.

The fixture is included into the ephemeral Expo-generated Gradle project by
the dedicated remote wrapper. Do not install Gradle or an Android SDK locally.

## Build and install

Start the existing API 36 emulator when an install is needed:

```sh
pnpm mobile:remote:emulator
./scripts/mobile-autofill-fixture-remote.sh install-debug
```

Build without installing:

```sh
./scripts/mobile-autofill-fixture-remote.sh build-debug
```

Each run records the APK, signature verification, signer SHA-256, manifest
facts, source sync marker, container health, and this exact association:

```json
{
  "packageName": "com.zerovault.autofillfixture",
  "signingCertificateSha256": "<64 uppercase hex characters>"
}
```

Use that generated `android-association.json` on a **dedicated test login**
inside Zero Vault. Never use a real credential in the fixture or Maestro
artifacts. Enable Zero Vault as the system Autofill service and Credential
Provider, then verify both explicit paths:

1. Tap **Request Autofill**, select the associated test login, and confirm both
   fields plus the status text update without automatic submission.
2. Tap **Request Password Credential**, select the same login, and confirm the
   AndroidX Credential Manager callback fills both fields.

`surface-smoke.yml` only proves the relying-party UI is installed and
addressable. A successful credential golden path also requires an unlocked
Zero Vault test account, the generated package/signature association, and both
system providers enabled.

## Dedicated release signer

Debug builds use the server Gradle volume's standard debug keystore. For a
stable release-signed fixture, create a separate long-lived fixture keystore
outside Git, copy `release.env.example` to
`/root/dev/zero-vault-android-secrets/autofill-fixture.env`, set both secret
files to mode `600`, and run:

```sh
./scripts/mobile-autofill-fixture-remote.sh install-release
```

The wrapper fails closed if any release signing value is absent, the keystore
is outside `/run/zero-vault-secrets`, file permissions are unsafe, the APK is
unsigned, or its signer differs from the expected SHA-256.

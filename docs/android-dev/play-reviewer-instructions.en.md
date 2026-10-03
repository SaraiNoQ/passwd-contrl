# Google Play reviewer instructions (draft)

Last updated: 2026-07-26

This is a repository template for Play Console **App access** instructions. It
contains no production credentials and is not evidence that a review
environment is publicly reachable. Replace every angle-bracket placeholder,
verify the steps against the submitted AAB, and keep any time-limited
credentials in Play Console rather than in Git.

## Review build

- App: Zero Vault
- Package: `com.zerovault.mobile`
- Version name/code: `<SUBMITTED_VERSION_NAME>` / `<SUBMITTED_VERSION_CODE>`
- Review API base URL: `<REVIEW_API_BASE_URL>`
- Public account-deletion URL: `<PUBLIC_ACCOUNT_DELETION_HTTPS_URL>`
- Support contact: `<REVIEW_SUPPORT_EMAIL>`

## Access

Preferred setup: provide an isolated, resettable review environment that allows
self-service registration with synthetic data.

1. Open Zero Vault and select **Create account**.
2. Register a synthetic email address accepted by
   `<REVIEW_ACCOUNT_CREATION_RULES>`.
3. Set a reviewer-created master password. Do not enter a Google employee's
   personal password or production secrets.
4. Copy the one-time recovery code into the review team's approved secure
   notes system, acknowledge it in the app, and continue.
5. If self-service registration cannot be enabled, put a time-limited synthetic
   account and its delivery/reset procedure in Play Console's protected App
   access field. Never add the password or recovery code to this file.

Environment reset procedure: `<REVIEW_ENVIRONMENT_RESET_PROCEDURE>`

## Core flow

1. Unlock the vault with the account master password.
2. Create a **Login** item with synthetic values, save it, and confirm it appears
   in the vault list.
3. Edit the item, search for it, then use **Sync**. The in-app status banner
   reports success or an actionable failure.
4. Create and remove a Secure Note or Card using synthetic values.
5. Open Settings to switch Light, Dark, and Follow system themes.
6. Lock the vault and unlock it again. Biometric unlock is available only when
   the review device has compatible secure lock-screen enrollment.

## Device approval and encrypted sync

Testing approval requires two review devices or emulators:

1. Register and unlock on device A.
2. Sign in with the same account on device B.
3. On device A, open device management, approve device B, and distribute the
   encrypted vault key.
4. Sync device B and verify the synthetic item is available after unlock.
5. Revoke device B from device A and verify subsequent protected requests from
   device B are rejected.

If the submitted build has a pre-seeded resettable review arrangement, describe
it here: `<TWO_DEVICE_REVIEW_SETUP>`.

## Autofill and Credential Provider

1. Enable Zero Vault as the system Autofill service.
2. On Android 14 or later, also enable it as a Credential Provider.
3. Create a synthetic Login item associated with the exact review target:
   `<AUTOFILL_REVIEW_ORIGIN_OR_PACKAGE>`.
4. Open `<AUTOFILL_REVIEW_TARGET_INSTRUCTIONS>`, focus the username/password
   fields, select Zero Vault, authenticate when prompted, and choose the item.
5. The service intentionally returns no credential when the origin, Android
   package, or signing-certificate association does not match.

## Account deletion

In app:

1. If the current session is older than five minutes, sign out and sign in
   again before starting deletion.
2. Open Settings → Account → Delete account.
3. Enter the full verified email and submit deletion. If the server returns a
   recent-authentication error, sign out, sign in, and retry within five
   minutes; the current build does not collect the master password inside the
   account page.

Without the app:

1. Open `<PUBLIC_ACCOUNT_DELETION_HTTPS_URL>`.
2. Sign in using the account's OPAQUE authentication flow.
3. Re-enter the verified email and confirm deletion within five minutes of
   authentication.

The client clears local encrypted state only after the server explicitly
confirms deletion. To repeat review, run
`<REVIEW_ENVIRONMENT_RESET_PROCEDURE>`.

## Recovery

Use only a synthetic review account:

1. Select account recovery and enter the saved one-time recovery code.
2. Set a new master password and complete the replacement-device flow.
3. Confirm that old sessions/devices are revoked and a new recovery code is
   issued.

Exact reset prerequisites for the submitted environment:
`<RECOVERY_REVIEW_PREREQUISITES>`.

## Notes for the final Console entry

- State any network allowlist, region, VPN, or maintenance-window requirements:
  `<NETWORK_ACCESS_NOTES>`.
- State any feature unavailable to reviewers and why:
  `<REVIEW_LIMITATIONS>`.
- Attach only current screenshots/video that match the submitted version.
- Before submission, verify every placeholder is replaced, the review backend
  is reachable from outside the developer network, and all synthetic accounts
  can be reset without developer intervention.

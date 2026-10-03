# Android business E2E

`smoke.yml` only proves that the development client can load the bundle.
`production-client.yml` creates a unique synthetic account and exercises the
personal-client golden path: native password generation, TOTP display, login /
secure-note / card CRUD, unlocked-memory search, two synced revisions and an
actual server-backed history restore, password health, local/cloud backup
navigation, sync, offline-code recovery, and verification of the restored
login after the new password unlock. It also exercises the app's recovery-code
copy control, logs out, performs a normal OPAQUE login on the same approved
local device, and unlocks the empty vault again. Backup automation stops at the visible
app controls: it never bypasses Android's share sheet or document picker.
`offline-restart-register.yml`, `offline-restart-prepare.yml`, and
`offline-restart-resume.yml` use a separate synthetic account to prove the
process-death queue boundary without switching Android airplane mode. After
registration, the host generates a random 64-hex control token and uses it only
from loopback to arm the local HTTPS proxy. The proxy consumes that authorization
once, drops exactly the next `POST /vault/item-sync` connection, and immediately
returns to normal forwarding. The prepare flow creates a mutation, observes the
network error with one Room item still pending, and kills the app process. The
resume flow performs the online OPAQUE authorization, reloads the same pending
mutation, and the host requires the count of successful upstream item-sync POSTs
to increase by exactly one. This is not evidence of password-based offline
unlock: the current password authorization step uses OPAQUE and therefore
requires the E2E Worker.
It is intentionally destructive and must target an isolated E2E Worker/D1
environment. The remote runner reads `EXPO_PUBLIC_ZERO_VAULT_API_URL` only from
the server-side `/root/dev/zero-vault-android-secrets/e2e.env`. The file must
also set `ZERO_VAULT_E2E_CONFIRM_DESTRUCTIVE=YES`, and its HTTPS hostname must
name an `e2e`, `test`, `testing`, or `staging` environment. Native OPAQUE
interoperability must already be verified. Failure of any prerequisite is a
production-gate failure, not a reason to replace native crypto with a test
double.

The API 36 runner now builds and installs the repository's dedicated Autofill
fixture in the same generated Gradle project as Zero Vault. It verifies that the
fixture has exactly one signer, extracts that run's actual certificate SHA-256,
and injects the exact package/certificate pair only into a synthetic login.
`biometric-enroll-api36.yml` drives the user-visible strong-biometric enrollment
screen, and `autofill-account-setup-api36.yml` creates the protected account and
enables Android's provider settings without writing secure settings directly.
`autofill-fixture-api36.yml` and
`credential-provider-fixture-api36.yml` each start only after the React Native
app process has been killed, proving the native Room/Keystore service path does
not depend on React Native remaining alive.

All four flows are production gates, but their presence is not evidence that
they passed. Only an API 36 remote run with the final fixed status artifact is
passing evidence. Their raw console, JUnit, screenshots and hierarchy dumps stay
under a mode-0700 temporary directory and are destroyed on every exit path
because they may contain a device PIN, recovery code, account password or
generated login secret. Public failure evidence contains sanitized command
type/sequence/status plus fixed proxy event and aggregate-count lines; it never
contains the control token or request bodies. The dynamic fixture signer is
never added to a production browser allowlist. `autofill.yml.disabled` remains a legacy negative-case
contract; it is not run by the golden path.

Journeys that are not inferred from the single-emulator run have separate
boundaries:

- Device approval and vault-key distribution require two independently keyed
  devices and an out-of-band fingerprint comparison. The API 36 two-device
  runner below implements this with two wiped AVDs, but its source alone is not
  passing evidence.
- Conflict creation and resolution require two approved clients editing the
  same synced revision. The same two-device runner covers all four decisions
  and final values without Worker backdoors or hand-written Room rows.
- Local backup export/restore and Web backup import require the real Android
  share sheet/document picker plus a synthetic encrypted fixture file.
- A real browser Autofill claim still requires the target device's actual
  browser package/signing certificate and a reachable production API. The API
  36 golden path instead builds a native fixture, derives its exact signer from
  that APK, enables the system providers through visible Settings UI, and tests
  Autofill plus Credential Provider after the React Native process is killed.

Cloud backup create/restore/delete is exercised with synthetic data in the
business golden path. The native fixture signer is stored only in that run's
synthetic item association and is never added to the production browser
allowlist.

The two-device conflict flows address `conflict-<resolution>-<itemId>` and
`conflict-confirm-<itemId>`, then assert the exact final username and, for
keep-both, one remote original plus one local copy. A Worker backdoor or a
hand-written Room row would only test the screen and remains forbidden as
production evidence.

Only the non-sensitive launch smoke retains raw Maestro JUnit/command output.
All business, offline-restart, biometric, Autofill and Credential Provider raw
JUnit, screenshots, console and command metadata stay in a mode-0700 temporary
directory that is destroyed on every exit path. Successful runs emit only
fixed-value `business-golden.txt`, `autofill-credential-golden.txt`, and
`two-device-golden.txt` summaries; failures emit only sanitized command status
and fixed proxy event/count evidence. A recovery
code, PIN, password or filled credential must never be retained as test
evidence, even for a synthetic account.

All flows are executed only inside the `campus-server` Android container. The
flows use synthetic values and must never receive a real password, vault or
recovery code.

## Re-running only approved-device login

`subflows/login-approved-device.yml` is both the final login segment of
`production-client.yml` and a standalone diagnostic flow. A standalone run
requires the app to already be on the login screen with the same protected,
approved local device identity still installed:

```bash
maestro test \
  -e E2E_EMAIL='synthetic-account@example.invalid' \
  -e E2E_PASSWORD='synthetic-master-password' \
  apps/mobile/.maestro/subflows/login-approved-device.yml
```

Run that command only inside the remote Android container against the isolated
E2E Worker. The flow intentionally uses `clearState: false`. Clearing app data
creates a new device identity; a successful login must then stop at device
approval until a second independently keyed approved device shares the vault
key. This single-emulator flow does not claim to cover that two-device gate.

## API 36 two-device gate

`./scripts/mobile-remote.sh e2e-multidevice` starts two independently wiped API
36 AVDs and targets every Maestro phase with an explicit emulator serial. It
creates an account on device A, logs device B into the real pending state,
reads B's visible device fingerprint from the Android accessibility hierarchy,
requires the same full fingerprint in A's approval dialog, ends B's pending
session without deleting its local identity, and logs B in again. B must then
decrypt A's four synced baseline records, which is the observable proof that
the approval key packet was fetched and installed.

The same run creates four conflicts without Worker or Room state injection.
For each record, B makes an offline edit from revision 1, A advances that same
revision through the normal UI and sync API, and B reconnects. Each conflict is
handled alone so selectors never guess among multiple cards: keep local,
accept remote, keep both, and decide later. The decide-later case must reappear
on the next sync before the runner cleans it up.

Only a successful remote run containing `two-device-golden.txt` is passing
evidence. Raw Maestro output remains in a mode-0700 temporary directory and is
destroyed on success or failure; a failed phase retains only sanitized command
types and statuses.

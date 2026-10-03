# Sync Protocol

## Browser extension client (2026-10-03)

Web and the standalone extension reuse the same `packages/browser-vault` item encryption, search tokens, sync plan and receipt/cursor engine. Extension storage commits encrypted snapshot and metadata in one storage.local record before cursor advancement. Exact pending encrypted mutations survive offline failures and response loss. Push conflicts suspend the item until the user chooses local, remote or a copy; cloud deletions remove the local baseline. The extension synchronizes on unlock/save, on manual request and every minute while unlocked. Device-bound bearer auth plus CSRF use existing Worker schemas; `/auth/extension/login/finish` aliases the same OPAQUE/device validation as native bearer login. No sync schema or database migration is added. Web–extension browser tests exercise data changes in both directions; Android native acceptance remains separately constrained by the campus-server workflow.

Last updated: 2026-10-03

## Web / Android interoperability

Rust/WASM Web vaults use Android's strict `item_level_v1` push and cursor-based pull protocol. Web pushes local edits/deletions before pulling, persists exact ciphertext/mutation IDs before transport, validates complete receipts, batches at 100 operations, and advances a cursor only after persisting its encrypted snapshot. Synced item timestamps prevent uploads of unchanged records. Remote deletions remove data and its sync baseline, preventing resurrection.

Pending work and unresolved conflicts are preserved while independent changes continue. Keep-local uses the latest item/tombstone revision; accept-remote applies the item or deletion; create-copy preserves all fields and accepts the original remote state; skip suspends the conflict. Rust vaults never silently fall back to whole-vault overwrite on network/protocol failure. Legacy WebCrypto remains a compatibility path and needs migration before Android use.

Web defaults to 60-second polling and schedules sync after unlock/data changes and reconnect. Mobile retains foreground/unlock sync and its durable Room queue. Shared keys come from trusted-device approval rather than being independently recreated from the same password.

Web tests cover shared-key unlock, bidirectional edits/deletions, lost-response replay and conflicts. Worker tests cover device-bound browser cookies, pending restrictions and revocation. Real browser E2E covers approval/key sharing and changes in both directions. Native Android acceptance still requires campus-server and physical-device checks; browser evidence does not replace them.

> Android now has Room queue/conflict entities, native bridge operations, Worker cursor/mutation routes and RN sync/conflict code. The current snapshot has not passed remote compile, offline restart, replay or multi-device conflict E2E; this remains a partial implementation.

## Overview

Zero Vault supports two sync modes: whole-envelope sync (legacy, still supported) and item-level sync (new default). Both modes are zero-knowledge; the server stores only ciphertext.

## Whole-Envelope Sync (Legacy)

The original sync path stores the complete encrypted local vault as one encrypted `VaultItemCiphertext` envelope.

**Push flow:**
1. Client encrypts the entire local vault into a single ciphertext envelope.
2. Client sends the envelope with a revision number to the server.
3. Server checks the revision for conflicts and stores the envelope.
4. Server returns the new revision.

**Pull flow:**
1. Client requests the latest envelope from the server.
2. Server returns the ciphertext envelope and current revision.
3. Client decrypts locally after unlock.

**Limitations:**
- Any change to any item requires re-uploading the entire vault.
- Conflict resolution operates on the whole vault, not individual items.
- Not suitable for multi-device workflows with frequent changes.

## Item-Level Sync (New Default)

Item-level sync replaces whole-envelope sync as the default. Each vault item is synced independently with its own encryption, revision, and conflict state.

### Push Flow

1. Client constructs an `ItemLevelSyncPlan` containing:
   - `upserts`: items that have been created or modified locally, each with:
     - `itemId`: unique item identifier.
     - `ciphertext`: the encrypted item payload.
     - `baseItemRevision`: the last known revision for this item (used for conflict detection).
   - `deletes`: item IDs that have been deleted locally.
2. Client sends the `ItemLevelSyncPlan` to the server.
3. Server processes each upsert:
   - If `baseItemRevision` matches the server's current revision for that item, the upsert is applied.
   - If `baseItemRevision` does not match, the item is flagged as a conflict.
4. Server returns an `ItemLevelSyncResponse` containing:
   - `appliedIds`: item IDs that were successfully upserted or deleted.
   - `conflicts`: items where the server's version has diverged, each with the server's current ciphertext and revision.

### Conflict Resolution

When the server returns conflicts, the client presents a resolution UI with four options per conflict:

- **Keep local:** Overwrite the server version with the local version (requires another sync push).
- **Accept remote:** Replace the local item with the server's version.
- **Create copy:** Keep both versions as separate items (local item gets a new ID).
- **Skip:** Leave the conflict unresolved; the item is not synced.

### Pull Flow

1. Client requests all items from the server, optionally passing `serverRevision` from the last successful pull.
2. Server returns:
   - `items`: array of ciphertext envelopes, each with `itemId`, `ciphertext`, and `revision`.
   - `serverRevision`: the current server revision for the vault.
3. Client decrypts each item locally after unlock.
4. Client merges pulled items into the local vault, applying conflict detection where needed.

### Item Encryption

Each item is encrypted independently:

1. The vault key is a random symmetric key.
2. Each item has a random item key derived from the vault key.
3. The item payload is encrypted with AEAD (XChaCha20-Poly1305 for `crypto-core-wasm` vaults).
4. The server receives only the ciphertext envelope, item ID, and revision.

## Server Boundary

The server never sees plaintext. It stores:

## Android Offline Queue

In the Android implementation, Room is the ciphertext/revision source of truth. Local-write/enqueue, pull, ack and conflict transactions have native implementations; a historical 2026-07-16 snapshot produced remote evidence for generated v2 schema JSON and the API 33–36 transaction/migration matrix. Current and future automated Android validation runs only on API 36, while `minSdk 26` remains an install-compatibility declaration. Conflicts retain encrypted local and remote references and use keep-local, accept-remote, create-copy or skip decisions. Mobile OPAQUE finish returns a device-bound bearer session; Web cookie behavior remains unchanged. Full offline guarantees remain open until the current APK survives force-stop/restart and replays idempotently in multi-device business E2E.

- Ciphertext envelopes (whole-envelope or per-item).
- Revision numbers and item IDs.
- Conflict metadata (server revision at time of conflict).

The server does not store:

- Master password or derived keys.
- Plaintext item contents.
- Recovery codes.

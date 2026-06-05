# Sync Protocol

Last updated: 2026-06-04

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

- Ciphertext envelopes (whole-envelope or per-item).
- Revision numbers and item IDs.
- Conflict metadata (server revision at time of conflict).

The server does not store:

- Master password or derived keys.
- Plaintext item contents.
- Recovery codes.

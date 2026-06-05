# Architecture

Zero Vault is split into clients that hold secrets and a sync service that only stores encrypted records.

## Components

- `apps/web`: Web Vault for vault management, import, recovery setup, and future account settings.
- `apps/extension`: Manifest V3 extension for form detection and user-confirmed fill.
- `apps/worker-api`: Sync API (Cloudflare Worker + Hono). It stores registration records, encrypted recovery packets, encrypted vault items, and revision metadata in D1.
- `packages/shared`: DTOs and runtime validation schemas shared by app, API, and extension.
- `crates/crypto-core`: Rust KDF and AEAD primitives. It should become the only implementation of key derivation and item encryption.

## Data Flow

1. A client derives keys locally from the master password and device material.
2. A vault item is serialized locally and encrypted locally.
3. The API receives only encrypted envelopes and a revision number.
4. Other clients pull encrypted envelopes and decrypt locally after unlock.
5. The browser extension receives fillable credentials only after the user unlocks and confirms a matched origin.

## Server Boundary

The API must not hold master passwords, plaintext item data, plaintext domains, plaintext usernames, plaintext notes, or recovery codes. The Worker API uses D1 (SQLite) for all persistent storage.

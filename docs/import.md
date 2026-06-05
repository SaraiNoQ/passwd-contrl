# Password Import

Last updated: 2026-06-04

## Supported Sources

Initial import supports CSV files exported by:

- Chrome / Google Password Manager.
- Microsoft Edge.
- Firefox.

Browser exports are plaintext CSV files and must be treated as high-risk secrets.

## Import Rules

- Parse CSV in client memory.
- Validate each row against `ImportLoginRow`.
- Encrypt each item before sync.
- Do not upload the CSV file.
- Do not log row contents, filenames, usernames, passwords, or domains.
- Do not keep temporary plaintext files.
- After import, prompt the user to delete the exported CSV and empty trash.

## CSV Import Flow

The import process follows these steps:

1. User selects a CSV file via the Web Vault file picker.
2. The file is read entirely in browser memory (FileReader API).
3. The CSV is parsed and rows are validated against the expected schema.
4. Invalid rows (missing URL or password) are flagged for user review.
5. Valid rows are converted into vault item objects.
6. Each item is encrypted immediately using the active crypto runtime.
7. Encrypted items are persisted to the local vault and synced if connected.
8. The plaintext CSV data is discarded from memory after encryption completes.

**Critical:** Plaintext never touches localStorage, API payloads, or logs. The CSV file content exists only in browser memory during the import process and is cleared as soon as encryption completes.

## Field Mapping

The importer should normalize common columns:

- `url`, `origin`, `website` -> `origin`
- `username`, `login`, `email` -> `username`
- `password` -> `password`
- `name`, `title` -> `title`

Rows missing a valid URL or password must be rejected or quarantined for user review before encryption.

## Phase 3+ Behavior

CSV import is implemented in Web Vault after local unlock. It supports common Chrome, Edge, and Firefox column names and rejects invalid URL/password rows. The extension popup does not import CSV files.

With item-level sync (Phase 4), imported items are encrypted individually and synced per-item rather than as part of a whole-envelope upload.

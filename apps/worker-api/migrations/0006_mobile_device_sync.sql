-- Device-bound mobile sessions and cursor-based item sync.

ALTER TABLE sessions ADD COLUMN device_id TEXT REFERENCES trusted_devices(id) ON DELETE CASCADE;
ALTER TABLE trusted_devices ADD COLUMN credential_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_device
ON sessions(device_id);

CREATE TABLE IF NOT EXISTS item_sync_changes (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  item_revision INTEGER NOT NULL,
  change_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_item_sync_changes_user_cursor
ON item_sync_changes(user_id, cursor);

-- Existing encrypted rows become the initial cursor snapshot. No plaintext is
-- introduced by the migration; encrypted envelopes stay JSON values.
INSERT INTO item_sync_changes
  (user_id, item_id, operation, item_revision, change_json, created_at)
SELECT
  user_id,
  id,
  CASE WHEN deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,
  revision,
  CASE
    WHEN deleted_at IS NULL THEN json_object(
      'operation', 'upsert',
      'item', json_object(
        'id', id,
        'ownerUserId', user_id,
        'revision', revision,
        'createdAt', created_at,
        'updatedAt', updated_at,
        'encryptedItemKey', json(encrypted_item_key),
        'encryptedPayload', json(encrypted_payload),
        'encryptedSearchTokens', json(encrypted_search_tokens)
      )
    )
    ELSE json_object(
      'operation', 'delete',
      'itemId', id,
      'revision', revision,
      'deletedAt', deleted_at
    )
  END,
  updated_at
FROM vault_items;

CREATE TABLE IF NOT EXISTS item_sync_mutations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_mutation_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, client_mutation_id)
);

CREATE INDEX IF NOT EXISTS idx_item_sync_mutations_created
ON item_sync_mutations(created_at);

-- D1 batches are transactional, but the reads used to prepare a sync batch
-- happen before that transaction starts.  Claiming the next per-user revision
-- as the first statement in every write batch makes concurrent writers race on
-- this primary key; the loser rolls its whole batch back and retries from fresh
-- state instead of overwriting the winner with the same revision.
CREATE TABLE IF NOT EXISTS item_sync_revision_claims (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, revision)
);

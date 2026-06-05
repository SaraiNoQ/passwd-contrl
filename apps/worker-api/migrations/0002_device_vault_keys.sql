CREATE TABLE IF NOT EXISTS device_vault_keys (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  encrypted_blob TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, device_id)
);

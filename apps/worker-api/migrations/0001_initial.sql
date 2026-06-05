-- Zero Vault D1 schema

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  opaque_registration_record TEXT NOT NULL,
  public_key_bundle TEXT NOT NULL,
  encrypted_recovery_packet TEXT NOT NULL,  -- JSON string
  server_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Registration sessions (OPAQUE)
CREATE TABLE IF NOT EXISTS registration_sessions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  registration_response TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reg_sessions_email ON registration_sessions(email);
CREATE INDEX IF NOT EXISTS idx_reg_sessions_expires ON registration_sessions(expires_at);

-- Login sessions (OPAQUE)
CREATE TABLE IF NOT EXISTS login_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_login_state TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_sessions_expires ON login_sessions(expires_at);

-- Auth sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Vault items (encrypted)
CREATE TABLE IF NOT EXISTS vault_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  encrypted_item_key TEXT NOT NULL,      -- JSON string
  encrypted_payload TEXT NOT NULL,       -- JSON string
  encrypted_search_tokens TEXT NOT NULL DEFAULT '[]',  -- JSON array
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_vault_items_user ON vault_items(user_id);
CREATE INDEX IF NOT EXISTS idx_vault_items_user_rev ON vault_items(user_id, revision);

-- Vault item history
CREATE TABLE IF NOT EXISTS vault_item_history (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES vault_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL,               -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_history_item ON vault_item_history(item_id);
CREATE INDEX IF NOT EXISTS idx_history_user_item ON vault_item_history(user_id, item_id);

-- Recovery packets
CREATE TABLE IF NOT EXISTS recovery_packets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_recovery_packet TEXT NOT NULL,  -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Trusted devices
CREATE TABLE IF NOT EXISTS trusted_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON trusted_devices(user_id);

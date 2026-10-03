-- Recovery-v2 authorization and epoch-bound sessions.

ALTER TABLE users ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE login_sessions ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0;

ALTER TABLE recovery_packets ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE recovery_packets ADD COLUMN signing_public_key TEXT;
ALTER TABLE recovery_packets ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;

-- Unknown accounts still complete the server side of OPAQUE login/start. Keep
-- their one-time server state separate so no fake attempt can ever mint a real
-- user session.
CREATE TABLE IF NOT EXISTS fake_login_sessions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  server_login_state TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fake_login_sessions_expires
ON fake_login_sessions(expires_at);

-- Revoked rows are audit history and must not prevent a recovered installation
-- from reusing its hardware fingerprint or public key.
DROP INDEX IF EXISTS idx_devices_user_public_key_unique;
DROP INDEX IF EXISTS idx_devices_user_fingerprint_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_user_public_key_active_unique
ON trusted_devices(user_id, public_key)
WHERE status IN ('pending', 'approved');

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_user_fingerprint_active_unique
ON trusted_devices(user_id, fingerprint)
WHERE fingerprint IS NOT NULL AND status IN ('pending', 'approved');

CREATE TABLE IF NOT EXISTS recovery_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  auth_epoch INTEGER,
  recovery_generation INTEGER,
  nonce TEXT NOT NULL CHECK (length(nonce) = 43),
  registration_session_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (user_id IS NULL AND auth_epoch IS NULL AND recovery_generation IS NULL)
    OR
    (user_id IS NOT NULL AND auth_epoch IS NOT NULL AND recovery_generation IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_recovery_challenges_expires
ON recovery_challenges(expires_at);

CREATE INDEX IF NOT EXISTS idx_recovery_challenges_user
ON recovery_challenges(user_id, created_at);

-- The primary key is the single-use authorization claim. A recovery finish
-- batch inserts this row first; any replay aborts the entire D1 transaction.
CREATE TABLE IF NOT EXISTS recovery_claims (
  challenge_id TEXT PRIMARY KEY NOT NULL
    REFERENCES recovery_challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recovery_claims_user
ON recovery_claims(user_id, claimed_at);

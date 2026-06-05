CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (key, timestamp)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_key_ts ON rate_limits (key, timestamp);

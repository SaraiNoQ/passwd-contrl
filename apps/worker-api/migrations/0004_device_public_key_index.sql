CREATE INDEX IF NOT EXISTS idx_devices_user_public_key
ON trusted_devices(user_id, public_key);

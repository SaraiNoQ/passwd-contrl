ALTER TABLE trusted_devices ADD COLUMN fingerprint TEXT;
ALTER TABLE trusted_devices ADD COLUMN last_seen_ip TEXT;
ALTER TABLE trusted_devices ADD COLUMN last_seen_location TEXT;

DELETE FROM trusted_devices
WHERE id NOT IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, public_key
        ORDER BY
          CASE status
            WHEN 'approved' THEN 0
            WHEN 'pending' THEN 1
            WHEN 'revoked' THEN 2
            WHEN 'rejected' THEN 3
            ELSE 4
          END,
          updated_at DESC
      ) AS row_rank
    FROM trusted_devices
  )
  WHERE row_rank = 1
);

DELETE FROM trusted_devices
WHERE fingerprint IS NULL
  AND status = 'pending'
  AND id NOT IN (
    SELECT id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY user_id, name, substr(created_at, 1, 16)
          ORDER BY updated_at DESC
        ) AS row_rank
      FROM trusted_devices
      WHERE fingerprint IS NULL
        AND status = 'pending'
    )
    WHERE row_rank = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_user_public_key_unique
ON trusted_devices(user_id, public_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_user_fingerprint_unique
ON trusted_devices(user_id, fingerprint)
WHERE fingerprint IS NOT NULL;

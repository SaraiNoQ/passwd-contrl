// SQLite database module for encrypted vault storage.
// Handles local vault item storage, sync metadata, and conflict state.
// Uses `rusqlite` with bundled SQLite for portability.
//
// Security rules:
// - Stores ONLY ciphertext envelopes, never plaintext vault item data.
// - Stores revisions and sync metadata.
// - Does NOT store master password, derived key, vault key, or plaintext items.

use rusqlite::{Connection, params};
use serde::Serialize;
use std::sync::Mutex;

// ── Types ────────────────────────────────────────────────────────────────────

/// JSON-serializable representation of a stored ciphertext row.
/// Matches the TypeScript `StoredItem` interface.
#[derive(Serialize)]
pub struct StoredItemJson {
    pub item_id: String,
    pub ciphertext_json: String,
    pub item_revision: i64,
    pub last_synced_at: String,
    pub has_conflict: bool,
    pub conflict_server_item_revision: Option<i64>,
}

// ── State wrapper ────────────────────────────────────────────────────────────

/// Thread-safe wrapper around the SQLite connection.
/// `rusqlite::Connection` is `!Send`, so we wrap it in a `Mutex` to satisfy
/// Tauri's `Send + Sync` bound on managed state.
pub struct DbConnection(pub Mutex<Connection>);

// ── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS ciphertext_items (
    item_id       TEXT PRIMARY KEY,
    ciphertext_json TEXT NOT NULL,
    item_revision INTEGER NOT NULL,
    last_synced_at TEXT NOT NULL,
    has_conflict  INTEGER NOT NULL DEFAULT 0,
    conflict_server_item_revision INTEGER
);

CREATE TABLE IF NOT EXISTS sync_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Initialize the database: open the file and create tables if they do not exist.
#[tauri::command]
pub fn db_init(db_path: String) -> Result<(), String> {
    let conn = Connection::open(&db_path).map_err(|e| format!("db open failed: {e}"))?;
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("schema creation failed: {e}"))?;

    // Migrate existing databases: add conflict_server_item_revision column
    // if it was created before the column was added to the schema.
    let _ = conn.execute_batch(
        "ALTER TABLE ciphertext_items ADD COLUMN conflict_server_item_revision INTEGER;"
    );
    Ok(())
}

/// Retrieve all stored ciphertext items.
#[tauri::command]
pub fn db_get_all_ciphertext(state: tauri::State<'_, DbConnection>) -> Result<Vec<StoredItemJson>, String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare("SELECT item_id, ciphertext_json, item_revision, last_synced_at, has_conflict, conflict_server_item_revision FROM ciphertext_items")
        .map_err(|e| format!("prepare failed: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(StoredItemJson {
                item_id: row.get(0)?,
                ciphertext_json: row.get(1)?,
                item_revision: row.get(2)?,
                last_synced_at: row.get(3)?,
                has_conflict: row.get::<_, i64>(4)? != 0,
                conflict_server_item_revision: row.get(5)?,
            })
        })
        .map_err(|e| format!("query failed: {e}"))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("row read failed: {e}"))?);
    }
    Ok(items)
}

/// Retrieve a single ciphertext item by ID.
#[tauri::command]
pub fn db_get_ciphertext_by_id(
    state: tauri::State<'_, DbConnection>,
    item_id: String,
) -> Result<Option<StoredItemJson>, String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare("SELECT item_id, ciphertext_json, item_revision, last_synced_at, has_conflict, conflict_server_item_revision FROM ciphertext_items WHERE item_id = ?1")
        .map_err(|e| format!("prepare failed: {e}"))?;

    let mut rows = stmt
        .query_map(params![item_id], |row| {
            Ok(StoredItemJson {
                item_id: row.get(0)?,
                ciphertext_json: row.get(1)?,
                item_revision: row.get(2)?,
                last_synced_at: row.get(3)?,
                has_conflict: row.get::<_, i64>(4)? != 0,
                conflict_server_item_revision: row.get(5)?,
            })
        })
        .map_err(|e| format!("query failed: {e}"))?;

    match rows.next() {
        Some(row) => Ok(Some(row.map_err(|e| format!("row read failed: {e}"))?)),
        None => Ok(None),
    }
}

/// Insert or update a ciphertext item.
#[tauri::command]
pub fn db_upsert_ciphertext(
    state: tauri::State<'_, DbConnection>,
    item_id: String,
    ciphertext_json: String,
    item_revision: i64,
    last_synced_at: String,
    has_conflict: bool,
    conflict_server_item_revision: Option<i64>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    conn.execute(
        "INSERT INTO ciphertext_items (item_id, ciphertext_json, item_revision, last_synced_at, has_conflict, conflict_server_item_revision)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(item_id) DO UPDATE SET
             ciphertext_json = excluded.ciphertext_json,
             item_revision = excluded.item_revision,
             last_synced_at = excluded.last_synced_at,
             has_conflict = excluded.has_conflict,
             conflict_server_item_revision = excluded.conflict_server_item_revision",
        params![item_id, ciphertext_json, item_revision, last_synced_at, has_conflict as i64, conflict_server_item_revision],
    )
    .map_err(|e| format!("upsert failed: {e}"))?;
    Ok(())
}

/// Delete a ciphertext item by ID.
#[tauri::command]
pub fn db_delete_ciphertext(
    state: tauri::State<'_, DbConnection>,
    item_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    conn.execute("DELETE FROM ciphertext_items WHERE item_id = ?1", params![item_id])
        .map_err(|e| format!("delete failed: {e}"))?;
    Ok(())
}

/// Get the server revision from sync_metadata, defaulting to 0.
#[tauri::command]
pub fn db_get_server_revision(state: tauri::State<'_, DbConnection>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM sync_metadata WHERE key = 'server_revision'",
            [],
            |row| row.get(0),
        )
        .ok();

    match result {
        Some(val) => val.parse::<i64>().map_err(|_| "invalid server_revision".to_string()),
        None => Ok(0),
    }
}

/// Set the server revision in sync_metadata.
#[tauri::command]
pub fn db_set_server_revision(
    state: tauri::State<'_, DbConnection>,
    revision: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    conn.execute(
        "INSERT INTO sync_metadata (key, value) VALUES ('server_revision', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![revision.to_string()],
    )
    .map_err(|e| format!("set server_revision failed: {e}"))?;
    Ok(())
}

/// Get the last synced at timestamp from sync_metadata.
#[tauri::command]
pub fn db_get_last_synced_at(state: tauri::State<'_, DbConnection>) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM sync_metadata WHERE key = 'last_synced_at'",
            [],
            |row| row.get(0),
        )
        .ok();
    Ok(result)
}

/// Set the last synced at timestamp in sync_metadata.
#[tauri::command]
pub fn db_set_last_synced_at(
    state: tauri::State<'_, DbConnection>,
    timestamp: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    conn.execute(
        "INSERT INTO sync_metadata (key, value) VALUES ('last_synced_at', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![timestamp],
    )
    .map_err(|e| format!("set last_synced_at failed: {e}"))?;
    Ok(())
}

/// Get IDs of all items that have a conflict flag set.
#[tauri::command]
pub fn db_get_conflict_ids(state: tauri::State<'_, DbConnection>) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare("SELECT item_id FROM ciphertext_items WHERE has_conflict = 1")
        .map_err(|e| format!("prepare failed: {e}"))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query failed: {e}"))?;

    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| format!("row read failed: {e}"))?);
    }
    Ok(ids)
}

/// Set conflict flags: clear all, then set the given IDs.
#[tauri::command]
pub fn db_set_conflict_ids(
    state: tauri::State<'_, DbConnection>,
    ids: Vec<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;

    // Clear all conflict flags.
    conn.execute("UPDATE ciphertext_items SET has_conflict = 0", [])
        .map_err(|e| format!("clear conflicts failed: {e}"))?;

    // Set conflict flags for the given IDs.
    for id in &ids {
        conn.execute(
            "UPDATE ciphertext_items SET has_conflict = 1 WHERE item_id = ?1",
            params![id],
        )
        .map_err(|e| format!("set conflict for {id} failed: {e}"))?;
    }
    Ok(())
}

/// Truncate all tables — full local data wipe.
#[tauri::command]
pub fn db_clear(state: tauri::State<'_, DbConnection>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    conn.execute("DELETE FROM ciphertext_items", [])
        .map_err(|e| format!("clear ciphertext_items failed: {e}"))?;
    conn.execute("DELETE FROM sync_metadata", [])
        .map_err(|e| format!("clear sync_metadata failed: {e}"))?;
    Ok(())
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> DbConnection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        DbConnection(Mutex::new(conn))
    }

    #[test]
    fn upsert_and_get_by_id() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        conn.execute(
            "INSERT INTO ciphertext_items (item_id, ciphertext_json, item_revision, last_synced_at, has_conflict, conflict_server_item_revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["item-1", r#"{"id":"item-1"}"#, 1i64, "2025-01-01T00:00:00Z", 0i64, Option::<i64>::None],
        )
        .unwrap();

        let mut stmt = conn
            .prepare("SELECT item_id, ciphertext_json, item_revision, last_synced_at, has_conflict, conflict_server_item_revision FROM ciphertext_items WHERE item_id = ?1")
            .unwrap();
        let item: StoredItemJson = stmt
            .query_row(params!["item-1"], |row| {
                Ok(StoredItemJson {
                    item_id: row.get(0)?,
                    ciphertext_json: row.get(1)?,
                    item_revision: row.get(2)?,
                    last_synced_at: row.get(3)?,
                    has_conflict: row.get::<_, i64>(4)? != 0,
                    conflict_server_item_revision: row.get(5)?,
                })
            })
            .unwrap();

        assert_eq!(item.item_id, "item-1");
        assert_eq!(item.item_revision, 1);
        assert!(!item.has_conflict);
        assert!(item.conflict_server_item_revision.is_none());
    }

    #[test]
    fn upsert_overwrites_existing() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        conn.execute(
            "INSERT INTO ciphertext_items (item_id, ciphertext_json, item_revision, last_synced_at, has_conflict, conflict_server_item_revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["item-1", r#"{"v":1}"#, 1i64, "2025-01-01T00:00:00Z", 0i64, Option::<i64>::None],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO ciphertext_items (item_id, ciphertext_json, item_revision, last_synced_at, has_conflict, conflict_server_item_revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(item_id) DO UPDATE SET
                 ciphertext_json = excluded.ciphertext_json,
                 item_revision = excluded.item_revision,
                 last_synced_at = excluded.last_synced_at,
                 has_conflict = excluded.has_conflict,
                 conflict_server_item_revision = excluded.conflict_server_item_revision",
            params!["item-1", r#"{"v":2}"#, 2i64, "2025-01-02T00:00:00Z", 1i64, Some(7i64)],
        )
        .unwrap();

        let mut stmt = conn
            .prepare("SELECT ciphertext_json, item_revision, has_conflict, conflict_server_item_revision FROM ciphertext_items WHERE item_id = ?1")
            .unwrap();
        let (json, rev, conflict, conflict_server_item_revision): (String, i64, i64, Option<i64>) = stmt
            .query_row(params!["item-1"], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
            .unwrap();

        assert_eq!(json, r#"{"v":2}"#);
        assert_eq!(rev, 2);
        assert_eq!(conflict, 1);
        assert_eq!(conflict_server_item_revision, Some(7));
    }

    #[test]
    fn delete_removes_item() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        conn.execute(
            "INSERT INTO ciphertext_items (item_id, ciphertext_json, item_revision, last_synced_at, has_conflict, conflict_server_item_revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["item-1", r#"{}"#, 1i64, "2025-01-01T00:00:00Z", 0i64, Option::<i64>::None],
        )
        .unwrap();

        conn.execute("DELETE FROM ciphertext_items WHERE item_id = ?1", params!["item-1"])
            .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM ciphertext_items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn sync_metadata_server_revision() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        // Default is 0 when no row exists.
        let result: Option<String> = conn
            .query_row(
                "SELECT value FROM sync_metadata WHERE key = 'server_revision'",
                [],
                |row| row.get(0),
            )
            .ok();
        assert!(result.is_none());

        // Insert.
        conn.execute(
            "INSERT INTO sync_metadata (key, value) VALUES ('server_revision', ?1)",
            params!["42"],
        )
        .unwrap();

        let val: String = conn
            .query_row(
                "SELECT value FROM sync_metadata WHERE key = 'server_revision'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(val, "42");

        // Upsert.
        conn.execute(
            "INSERT INTO sync_metadata (key, value) VALUES ('server_revision', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params!["100"],
        )
        .unwrap();

        let val: String = conn
            .query_row(
                "SELECT value FROM sync_metadata WHERE key = 'server_revision'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(val, "100");
    }

    #[test]
    fn conflict_ids_query() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        conn.execute(
            "INSERT INTO ciphertext_items (item_id, ciphertext_json, item_revision, last_synced_at, has_conflict, conflict_server_item_revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["a", r#"{}"#, 1i64, "2025-01-01T00:00:00Z", 1i64, Some(2i64)],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ciphertext_items (item_id, ciphertext_json, item_revision, last_synced_at, has_conflict, conflict_server_item_revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["b", r#"{}"#, 1i64, "2025-01-01T00:00:00Z", 0i64, Option::<i64>::None],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ciphertext_items (item_id, ciphertext_json, item_revision, last_synced_at, has_conflict, conflict_server_item_revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["c", r#"{}"#, 1i64, "2025-01-01T00:00:00Z", 1i64, Some(3i64)],
        )
        .unwrap();

        let mut stmt = conn
            .prepare("SELECT item_id FROM ciphertext_items WHERE has_conflict = 1")
            .unwrap();
        let ids: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"a".to_string()));
        assert!(ids.contains(&"c".to_string()));
    }

    #[test]
    fn clear_empties_tables() {
        let db = test_db();
        let conn = db.0.lock().unwrap();

        conn.execute(
            "INSERT INTO ciphertext_items (item_id, ciphertext_json, item_revision, last_synced_at, has_conflict, conflict_server_item_revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["item-1", r#"{}"#, 1i64, "2025-01-01T00:00:00Z", 0i64, Option::<i64>::None],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sync_metadata (key, value) VALUES ('server_revision', '5')",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM ciphertext_items", []).unwrap();
        conn.execute("DELETE FROM sync_metadata", []).unwrap();

        let count_items: i64 = conn
            .query_row("SELECT COUNT(*) FROM ciphertext_items", [], |row| row.get(0))
            .unwrap();
        let count_meta: i64 = conn
            .query_row("SELECT COUNT(*) FROM sync_metadata", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count_items, 0);
        assert_eq!(count_meta, 0);
    }
}

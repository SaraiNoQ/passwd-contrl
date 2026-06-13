// macOS Keychain integration for secure storage.
// Handles key derivation parameters, device keypair, and session tokens.
// Uses the `keyring` crate for cross-platform secure storage.
//
// Security rules:
// - Never stores master password, plaintext credentials, or derived keys.
// - Internal keyring error details are never exposed to the frontend.

use keyring::Entry;

const SERVICE_NAME: &str = "com.zerovault.desktop";

/// Read a value from the macOS Keychain.
/// Returns `None` if the key does not exist.
#[tauri::command]
pub fn keychain_get_item(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|_| "Failed to access keychain")?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Failed to read from keychain".to_string()),
    }
}

/// Write a value to the macOS Keychain. Creates or updates the entry.
#[tauri::command]
pub fn keychain_set_item(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|_| "Failed to access keychain")?;
    entry
        .set_password(&value)
        .map_err(|_| "Failed to write to keychain".to_string())
}

/// Delete a value from the macOS Keychain.
/// Succeeds silently if the key does not exist.
#[tauri::command]
pub fn keychain_delete_item(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|_| "Failed to access keychain")?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Failed to delete from keychain".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // These tests require access to the macOS Keychain and will prompt
    // for credentials in CI. They serve as integration-level smoke tests.

    #[test]
    fn round_trip_set_get_delete() {
        let key = "test_round_trip_001".to_string();
        let value = "secret-value".to_string();

        // Clean up in case a previous run left data
        let _ = keychain_delete_item(key.clone());

        // Set
        keychain_set_item(key.clone(), value.clone()).expect("set should succeed");

        // Get
        let result = keychain_get_item(key.clone()).expect("get should succeed");
        assert_eq!(result, Some(value));

        // Delete
        keychain_delete_item(key.clone()).expect("delete should succeed");

        // Verify deleted
        let result = keychain_get_item(key.clone()).expect("get after delete should succeed");
        assert_eq!(result, None);
    }

    #[test]
    fn get_nonexistent_returns_none() {
        let result = keychain_get_item("test_nonexistent_key_9999".to_string())
            .expect("get nonexistent should succeed");
        assert_eq!(result, None);
    }

    #[test]
    fn delete_nonexistent_succeeds() {
        let result = keychain_delete_item("test_nonexistent_del_9999".to_string());
        assert!(result.is_ok());
    }

    #[test]
    fn overwrite_updates_value() {
        let key = "test_overwrite_001".to_string();

        let _ = keychain_delete_item(key.clone());

        keychain_set_item(key.clone(), "first".to_string()).expect("first set");
        keychain_set_item(key.clone(), "second".to_string()).expect("second set");

        let result = keychain_get_item(key.clone()).expect("get");
        assert_eq!(result, Some("second".to_string()));

        let _ = keychain_delete_item(key.clone());
    }
}

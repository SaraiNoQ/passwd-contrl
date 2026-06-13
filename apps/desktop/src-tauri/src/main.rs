// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};
use zero_vault_desktop::crypto;
use zero_vault_desktop::db::DbConnection;
use zero_vault_desktop::keychain;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // ── Database setup ─────────────────────────────────────────────
            let app_data = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_data).expect("failed to create app data dir");
            let db_path = app_data.join("vault.db");

            let conn = Connection::open(&db_path).expect("failed to open database");
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS ciphertext_items (
                    item_id       TEXT PRIMARY KEY,
                    ciphertext_json TEXT NOT NULL,
                    item_revision INTEGER NOT NULL,
                    last_synced_at TEXT NOT NULL,
                    has_conflict  INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS sync_metadata (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );",
            )
            .expect("failed to create schema");

            app.manage(DbConnection(Mutex::new(conn)));

            // ── macOS menu bar ─────────────────────────────────────────────
            let handle = app.handle();

            // App menu (Obscura)
            let app_menu = Submenu::with_items(
                handle,
                "Obscura",
                true,
                &[
                    &PredefinedMenuItem::about(handle, None, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(handle, "preferences", "偏好设置...", true, Some("Cmd+,"))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::hide(handle, None)?,
                    &PredefinedMenuItem::hide_others(handle, None)?,
                    &PredefinedMenuItem::show_all(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::quit(handle, None)?,
                ],
            )?;

            // File menu
            let file_menu = Submenu::with_items(
                handle,
                "文件",
                true,
                &[
                    &MenuItem::with_id(handle, "new_credential", "新建凭据", true, Some("Cmd+N"))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(handle, "import_csv", "导入 CSV...", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::close_window(handle, None)?,
                ],
            )?;

            // Edit menu
            let edit_menu = Submenu::with_items(
                handle,
                "编辑",
                true,
                &[
                    &PredefinedMenuItem::undo(handle, None)?,
                    &PredefinedMenuItem::redo(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, None)?,
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                ],
            )?;

            // View menu
            let view_menu = Submenu::with_items(
                handle,
                "显示",
                true,
                &[
                    &MenuItem::with_id(handle, "search", "搜索", true, Some("Cmd+K"))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::fullscreen(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(handle, "reload", "重新加载", true, Some("Cmd+R"))?,
                    &MenuItem::with_id(handle, "dev_tools", "开发者工具", true, Some("Cmd+Alt+I"))?,
                ],
            )?;

            // Vault menu (custom)
            let vault_menu = Submenu::with_items(
                handle,
                "密码库",
                true,
                &[
                    &MenuItem::with_id(handle, "lock_vault", "锁定密码库", true, Some("Cmd+L"))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(handle, "sync", "同步", true, Some("Cmd+S"))?,
                ],
            )?;

            // Window menu
            let window_menu = Submenu::with_items(
                handle,
                "窗口",
                true,
                &[
                    &PredefinedMenuItem::minimize(handle, None)?,
                    &PredefinedMenuItem::maximize(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::bring_all_to_front(handle, None)?,
                ],
            )?;

            // Build the full menu
            let menu = Menu::with_items(
                handle,
                &[
                    &app_menu,
                    &file_menu,
                    &edit_menu,
                    &view_menu,
                    &vault_menu,
                    &window_menu,
                ],
            )?;

            app.set_menu(menu)?;

            // ── Menu event handler ─────────────────────────────────────────
            let handle_clone = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                let id = event.id().as_ref();
                match id {
                    "new_credential" => {
                        let _ = handle_clone.emit("menu:new_credential", ());
                    }
                    "import_csv" => {
                        let _ = handle_clone.emit("menu:import_csv", ());
                    }
                    "search" => {
                        let _ = handle_clone.emit("menu:search", ());
                    }
                    "lock_vault" => {
                        let _ = handle_clone.emit("menu:lock_vault", ());
                    }
                    "sync" => {
                        let _ = handle_clone.emit("menu:sync", ());
                    }
                    "preferences" => {
                        let _ = handle_clone.emit("menu:preferences", ());
                    }
                    "reload" => {
                        let _ = handle_clone.emit("menu:reload", ());
                    }
                    "dev_tools" => {
                        let _ = handle_clone.emit("menu:dev_tools", ());
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crypto::derive_vault_key,
            crypto::decrypt_item,
            crypto::encrypt_item,
            crypto::generate_recovery_code,
            crypto::derive_recovery_key,
            crypto::generate_device_keypair,
            crypto::encrypt_vault_key_for_device,
            crypto::decrypt_vault_key_on_device,
            keychain::keychain_get_item,
            keychain::keychain_set_item,
            keychain::keychain_delete_item,
            zero_vault_desktop::db::db_init,
            zero_vault_desktop::db::db_get_all_ciphertext,
            zero_vault_desktop::db::db_get_ciphertext_by_id,
            zero_vault_desktop::db::db_upsert_ciphertext,
            zero_vault_desktop::db::db_delete_ciphertext,
            zero_vault_desktop::db::db_get_server_revision,
            zero_vault_desktop::db::db_set_server_revision,
            zero_vault_desktop::db::db_get_last_synced_at,
            zero_vault_desktop::db::db_set_last_synced_at,
            zero_vault_desktop::db::db_get_conflict_ids,
            zero_vault_desktop::db::db_set_conflict_ids,
            zero_vault_desktop::db::db_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

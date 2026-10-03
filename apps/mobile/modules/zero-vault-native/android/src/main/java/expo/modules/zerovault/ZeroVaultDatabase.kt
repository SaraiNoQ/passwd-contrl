package expo.modules.zerovault

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
  entities = [
    CiphertextRecordEntity::class,
    SyncCursorEntity::class,
    PendingMutationEntity::class,
    SyncConflictEntity::class,
    DeviceStateEntity::class,
  ],
  version = 2,
  exportSchema = true,
)
abstract class ZeroVaultDatabase : RoomDatabase() {
  abstract fun ciphertexts(): VaultCiphertextDao
  abstract fun syncCursors(): SyncCursorDao
  abstract fun pendingMutations(): PendingMutationDao
  abstract fun syncConflicts(): SyncConflictDao
  abstract fun deviceState(): DeviceStateDao

  companion object {
    const val DATABASE_NAME = "zero-vault.db"

    val MIGRATION_1_2 = object : Migration(1, 2) {
      override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE vault_ciphertexts ADD COLUMN item_type TEXT")
        database.execSQL("ALTER TABLE vault_ciphertexts ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0")
        database.execSQL("CREATE INDEX IF NOT EXISTS index_vault_ciphertexts_account_id_is_deleted ON vault_ciphertexts(account_id, is_deleted)")
        database.execSQL("ALTER TABLE sync_cursors ADD COLUMN server_cursor INTEGER")
        database.execSQL("ALTER TABLE sync_cursors ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 2")
        database.execSQL(
          """CREATE TABLE IF NOT EXISTS pending_mutations (
            account_id TEXT NOT NULL,
            client_mutation_id TEXT NOT NULL,
            record_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            base_item_revision INTEGER NOT NULL,
            ciphertext_envelope_json TEXT,
            created_at TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            last_error_code TEXT,
            PRIMARY KEY(account_id, client_mutation_id)
          )""".trimIndent(),
        )
        database.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_pending_mutations_account_id_record_id ON pending_mutations(account_id, record_id)")
        database.execSQL(
          """CREATE TABLE IF NOT EXISTS sync_conflicts (
            account_id TEXT NOT NULL,
            record_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            local_ciphertext_envelope_json TEXT,
            remote_ciphertext_envelope_json TEXT,
            server_revision INTEGER NOT NULL,
            server_item_revision INTEGER,
            status TEXT NOT NULL DEFAULT 'UNRESOLVED',
            created_at TEXT NOT NULL,
            PRIMARY KEY(account_id, record_id)
          )""".trimIndent(),
        )
        database.execSQL("CREATE INDEX IF NOT EXISTS index_sync_conflicts_account_id_status ON sync_conflicts(account_id, status)")
        database.execSQL(
          """CREATE TABLE IF NOT EXISTS device_state (
            account_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            public_key TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            encrypted_vault_key TEXT,
            created_at TEXT NOT NULL,
            PRIMARY KEY(account_id)
          )""".trimIndent(),
        )
      }
    }

    val ALL_MIGRATIONS: Array<Migration> = arrayOf(MIGRATION_1_2)

    fun open(context: Context): ZeroVaultDatabase =
      Room.databaseBuilder(
        context.applicationContext,
        ZeroVaultDatabase::class.java,
        DATABASE_NAME,
      )
        .addMigrations(*ALL_MIGRATIONS)
        .build()
  }
}

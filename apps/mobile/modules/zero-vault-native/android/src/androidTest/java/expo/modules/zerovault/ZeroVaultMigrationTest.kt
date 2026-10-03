package expo.modules.zerovault

import androidx.room.testing.MigrationTestHelper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ZeroVaultMigrationTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val context = instrumentation.targetContext

  @get:Rule
  val helper = MigrationTestHelper(instrumentation, ZeroVaultDatabase::class.java)

  @Before
  @After
  fun deleteDatabase() {
    context.deleteDatabase(TEST_DATABASE_NAME)
  }

  @Test
  fun migrationOneToTwoPreservesCiphertextAndCursorAndCreatesQueues() {
    helper.createDatabase(TEST_DATABASE_NAME, 1).use { database ->
      database.execSQL(
        """INSERT INTO vault_ciphertexts (
          account_id, record_id, ciphertext_envelope_json, item_revision, last_synced_at, has_conflict
        ) VALUES (?, ?, ?, ?, ?, ?)""".trimIndent(),
        arrayOf("account-1", "item-1", "{\"ciphertext\":\"preserve-me\"}", 7L, "2026-07-16T00:00:00Z", 1),
      )
      database.execSQL(
        "INSERT INTO sync_cursors (account_id, server_revision, last_synced_at) VALUES (?, ?, ?)",
        arrayOf("account-1", 11L, "2026-07-16T00:01:00Z"),
      )
    }

    helper.runMigrationsAndValidate(
      TEST_DATABASE_NAME,
      2,
      true,
      ZeroVaultDatabase.MIGRATION_1_2,
    ).use { database ->
      database.query("SELECT * FROM vault_ciphertexts WHERE account_id = 'account-1' AND record_id = 'item-1'").use { cursor ->
        assertTrue(cursor.moveToFirst())
        assertEquals("{\"ciphertext\":\"preserve-me\"}", cursor.getString(cursor.getColumnIndexOrThrow("ciphertext_envelope_json")))
        assertEquals(7L, cursor.getLong(cursor.getColumnIndexOrThrow("item_revision")))
        assertEquals("2026-07-16T00:00:00Z", cursor.getString(cursor.getColumnIndexOrThrow("last_synced_at")))
        assertEquals(1, cursor.getInt(cursor.getColumnIndexOrThrow("has_conflict")))
        assertNull(cursor.getString(cursor.getColumnIndexOrThrow("item_type")))
        assertEquals(0, cursor.getInt(cursor.getColumnIndexOrThrow("is_deleted")))
        assertFalse(cursor.moveToNext())
      }

      database.query("SELECT * FROM sync_cursors WHERE account_id = 'account-1'").use { cursor ->
        assertTrue(cursor.moveToFirst())
        assertEquals(11L, cursor.getLong(cursor.getColumnIndexOrThrow("server_revision")))
        assertEquals("2026-07-16T00:01:00Z", cursor.getString(cursor.getColumnIndexOrThrow("last_synced_at")))
        assertTrue(cursor.isNull(cursor.getColumnIndexOrThrow("server_cursor")))
        assertEquals(2, cursor.getInt(cursor.getColumnIndexOrThrow("schema_version")))
        assertFalse(cursor.moveToNext())
      }

      listOf("pending_mutations", "sync_conflicts", "device_state").forEach { table ->
        database.query("SELECT COUNT(*) FROM $table").use { cursor ->
          assertTrue(cursor.moveToFirst())
          assertEquals(0L, cursor.getLong(0))
        }
      }
    }
  }

  private companion object {
    const val TEST_DATABASE_NAME = "zero-vault-migration-test.db"
  }
}

package expo.modules.zerovault

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.UUID
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeBackupDocumentsInstrumentedTest {
  private val accountId = "account-native-backup"
  private val backupId = "e899396b-8211-47a1-89a8-2d7da9e36db7"
  private val createdAt = "2026-07-26T08:30:00+08:00"
  private val encryptedSnapshot = """{"ciphertext":"encrypted-only"}"""

  @Test
  fun wrapperMatchesTheExistingTypeScriptContractExactly() {
    val serialized = NativeBackupDocumentCodec.encode(
      accountId,
      backupId,
      createdAt,
      encryptedSnapshot,
    )
    val json = JSONObject(serialized)

    assertEquals(
      setOf("format", "version", "accountId", "backupId", "createdAt", "encryptedSnapshot"),
      json.keys().asSequence().toSet(),
    )
    assertEquals("zero-vault-personal-android-backup", json.getString("format"))
    assertEquals(1, json.getInt("version"))
    assertEquals(accountId, json.getString("accountId"))
    assertEquals(backupId, json.getString("backupId"))
    assertEquals(createdAt, json.getString("createdAt"))
    assertEquals(encryptedSnapshot, json.getString("encryptedSnapshot"))

    val metadata = NativeBackupDocumentCodec.metadata(serialized)
    assertEquals(accountId, metadata.accountId)
    assertEquals(backupId, metadata.backupId)
    assertEquals(createdAt, metadata.createdAt)
  }

  @Test
  fun stagedAndroidBackupUsesAnOpaqueHandleAndCanOnlyBeClaimedOnce() {
    val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    val store = NativeBackupStageStore(context)
    val serialized = NativeBackupDocumentCodec.encode(
      accountId,
      backupId,
      createdAt,
      encryptedSnapshot,
    )

    try {
      val staged = store.stage(
        ByteArrayInputStream(serialized.toByteArray(Charsets.UTF_8)),
        NativeBackupKind.ANDROID,
      )
      assertNotNull(UUID.fromString(staged.operationId))
      assertFalse(staged.file.name.contains(staged.operationId))
      assertEquals(accountId, staged.metadata?.accountId)

      val claimed = store.claim(staged.operationId, NativeBackupKind.ANDROID)
      assertTrue(claimed.file.exists())
      assertThrows(VaultRepositoryException::class.java) {
        store.claim(staged.operationId, NativeBackupKind.ANDROID)
      }
      claimed.file.delete()
    } finally {
      store.discardAll()
    }
  }

  @Test
  fun androidRestoreRejectsAnotherAccount() {
    val serialized = NativeBackupDocumentCodec.encode(
      accountId,
      backupId,
      createdAt,
      encryptedSnapshot,
    )

    val error = assertThrows(VaultRepositoryException::class.java) {
      NativeBackupDocumentCodec.encryptedSnapshot(serialized, "another-account")
    }
    assertEquals("BACKUP_ACCOUNT_MISMATCH", error.code)
  }

  @Test
  fun cryptoCoreStageEnforcesTheEightMiBHardLimitAndCleansUp() {
    val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    val store = NativeBackupStageStore(context)
    val oversized = RepeatingInputStream(8 * 1_048_576 + 1)

    try {
      val error = assertThrows(VaultRepositoryException::class.java) {
        store.stage(oversized, NativeBackupKind.CRYPTO_CORE)
      }
      assertEquals("BACKUP_FILE_TOO_LARGE", error.code)
      val stageDirectory = context.cacheDir.resolve("zero-vault-backup-stage")
      assertTrue(stageDirectory.listFiles().isNullOrEmpty())
    } finally {
      store.discardAll()
    }
  }

  private class RepeatingInputStream(private var remaining: Int) : InputStream() {
    override fun read(): Int {
      if (remaining == 0) return -1
      remaining -= 1
      return 'x'.code
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
      if (remaining == 0) return -1
      val count = minOf(length, remaining)
      buffer.fill('x'.code.toByte(), offset, offset + count)
      remaining -= count
      return count
    }
  }
}

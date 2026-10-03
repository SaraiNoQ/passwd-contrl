package expo.modules.zerovault

import android.content.Context
import java.io.File
import java.io.InputStream
import java.time.OffsetDateTime
import java.util.UUID
import org.json.JSONObject

internal enum class NativeBackupKind(val bridgeValue: String, val maximumBytes: Long) {
  ANDROID("android", 52L * 1_048_576L),
  CRYPTO_CORE("crypto-core", 8L * 1_048_576L);

  companion object {
    fun fromBridge(value: String): NativeBackupKind =
      values().firstOrNull { it.bridgeValue == value }
        ?: throw VaultRepositoryException("INVALID_ARGUMENT", "Backup kind is invalid")
  }
}

internal data class NativeBackupMetadata(
  val accountId: String,
  val backupId: String,
  val createdAt: String,
)

internal data class StagedNativeBackup(
  val operationId: String,
  val kind: NativeBackupKind,
  val file: File,
  val metadata: NativeBackupMetadata?,
)

internal object NativeBackupDocumentCodec {
  const val FORMAT = "zero-vault-personal-android-backup"
  const val VERSION = 1
  private const val MAX_ACCOUNT_ID_LENGTH = 256
  private const val MAX_ENCRYPTED_SNAPSHOT_BYTES = 50 * 1_048_576
  private val WRAPPER_KEYS = setOf(
    "format",
    "version",
    "accountId",
    "backupId",
    "createdAt",
    "encryptedSnapshot",
  )

  fun encode(
    accountId: String,
    backupId: String,
    createdAt: String,
    encryptedSnapshot: String,
  ): String {
    validateAccountId(accountId)
    validateBackupId(backupId)
    validateCreatedAt(createdAt)
    validateEncryptedSnapshot(encryptedSnapshot)
    return JSONObject()
      .put("format", FORMAT)
      .put("version", VERSION)
      .put("accountId", accountId)
      .put("backupId", backupId)
      .put("createdAt", createdAt)
      .put("encryptedSnapshot", encryptedSnapshot)
      .toString()
  }

  fun metadata(serialized: String): NativeBackupMetadata = parse(serialized).metadata

  fun encryptedSnapshot(serialized: String, expectedAccountId: String): Pair<NativeBackupMetadata, String> {
    validateAccountId(expectedAccountId)
    val parsed = parse(serialized)
    if (parsed.metadata.accountId != expectedAccountId) {
      throw VaultRepositoryException("BACKUP_ACCOUNT_MISMATCH", "Backup belongs to another account")
    }
    return parsed.metadata to parsed.encryptedSnapshot
  }

  private fun parse(serialized: String): ParsedAndroidBackup {
    if (serialized.isEmpty() || serialized.toByteArray(Charsets.UTF_8).size > NativeBackupKind.ANDROID.maximumBytes) {
      throw VaultRepositoryException("BACKUP_FILE_TOO_LARGE", "Encrypted backup is empty or too large")
    }
    val json = try {
      JSONObject(serialized)
    } catch (_: Exception) {
      throw VaultRepositoryException("INVALID_BACKUP", "Encrypted backup document is invalid")
    }
    val keys = buildSet {
      val iterator = json.keys()
      while (iterator.hasNext()) add(iterator.next())
    }
    val formatValue = json.opt("format")
    val versionValue = json.opt("version")
    val accountIdValue = json.opt("accountId")
    val backupIdValue = json.opt("backupId")
    val createdAtValue = json.opt("createdAt")
    val encryptedSnapshotValue = json.opt("encryptedSnapshot")
    if (
      keys != WRAPPER_KEYS ||
      formatValue !is String ||
      formatValue != FORMAT ||
      versionValue !is Number ||
      versionValue.toDouble() != VERSION.toDouble() ||
      accountIdValue !is String ||
      backupIdValue !is String ||
      createdAtValue !is String ||
      encryptedSnapshotValue !is String
    ) {
      throw VaultRepositoryException("INVALID_BACKUP", "Encrypted backup document is invalid")
    }

    val accountId = accountIdValue
    val backupId = backupIdValue
    val createdAt = createdAtValue
    val encryptedSnapshot = encryptedSnapshotValue
    try {
      validateAccountId(accountId)
      validateBackupId(backupId)
      validateCreatedAt(createdAt)
      validateEncryptedSnapshot(encryptedSnapshot)
    } catch (_: Exception) {
      throw VaultRepositoryException("INVALID_BACKUP", "Encrypted backup document is invalid")
    }
    return ParsedAndroidBackup(
      NativeBackupMetadata(accountId, backupId, createdAt),
      encryptedSnapshot,
    )
  }

  private fun validateAccountId(accountId: String) {
    require(accountId.isNotEmpty() && accountId.length <= MAX_ACCOUNT_ID_LENGTH)
  }

  private fun validateBackupId(backupId: String) {
    require(UUID.fromString(backupId).toString() == backupId.lowercase())
  }

  private fun validateCreatedAt(createdAt: String) {
    OffsetDateTime.parse(createdAt)
  }

  private fun validateEncryptedSnapshot(encryptedSnapshot: String) {
    require(
      encryptedSnapshot.isNotEmpty() &&
        encryptedSnapshot.toByteArray(Charsets.UTF_8).size <= MAX_ENCRYPTED_SNAPSHOT_BYTES,
    )
  }

  private data class ParsedAndroidBackup(
    val metadata: NativeBackupMetadata,
    val encryptedSnapshot: String,
  )
}

internal class NativeBackupStageStore(context: Context) {
  private val lock = Any()
  private val stageDirectory = File(context.cacheDir, "zero-vault-backup-stage")
  private var staged: StagedNativeBackup? = null
  private var copyInProgress = false
  private var generation = 0L

  init {
    stageDirectory.mkdirs()
    stageDirectory.listFiles()?.forEach { it.delete() }
  }

  fun stage(input: InputStream, kind: NativeBackupKind): StagedNativeBackup {
    val stageGeneration = synchronized(lock) {
      if (staged != null || copyInProgress) {
        throw VaultRepositoryException("BACKUP_OPERATION_IN_PROGRESS", "Another backup operation is active")
      }
      copyInProgress = true
      generation
    }

    val file = try {
      File.createTempFile("backup-", ".stage", stageDirectory)
    } catch (error: Exception) {
      synchronized(lock) { copyInProgress = false }
      throw error
    }
    try {
      copyWithLimit(input, file, kind.maximumBytes)
      val metadata = if (kind == NativeBackupKind.ANDROID) {
        NativeBackupDocumentCodec.metadata(file.readText(Charsets.UTF_8))
      } else {
        null
      }
      val candidate = StagedNativeBackup(UUID.randomUUID().toString(), kind, file, metadata)
      synchronized(lock) {
        if (generation != stageGeneration) {
          throw VaultRepositoryException("BACKUP_OPERATION_CANCELLED", "Backup operation was cancelled")
        }
        if (staged != null) {
          throw VaultRepositoryException("BACKUP_OPERATION_IN_PROGRESS", "Another backup operation is active")
        }
        staged = candidate
        copyInProgress = false
      }
      return candidate
    } catch (error: Exception) {
      file.delete()
      throw error
    } finally {
      synchronized(lock) { copyInProgress = false }
    }
  }

  fun hasStagedBackup(): Boolean = synchronized(lock) { staged != null || copyInProgress }

  fun claim(operationId: String, expectedKind: NativeBackupKind): StagedNativeBackup =
    synchronized(lock) {
      val current = staged
      if (
        current == null ||
        current.operationId != operationId ||
        current.kind != expectedKind
      ) {
        throw VaultRepositoryException("BACKUP_OPERATION_NOT_FOUND", "Staged backup is unavailable")
      }
      staged = null
      current
    }

  fun discard(operationId: String): Boolean {
    val discarded = synchronized(lock) {
      val current = staged
      if (current == null || current.operationId != operationId) return@synchronized null
      staged = null
      current
    }
    discarded ?: return false
    discarded.file.delete()
    return true
  }

  fun discardAll() {
    val current = synchronized(lock) {
      val value = staged
      staged = null
      generation += 1
      value
    }
    current?.file?.delete()
    stageDirectory.listFiles()?.forEach { it.delete() }
  }

  private fun copyWithLimit(input: InputStream, destination: File, maximumBytes: Long) {
    val buffer = ByteArray(64 * 1024)
    var total = 0L
    try {
      destination.outputStream().buffered().use { output ->
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          if (read == 0) continue
          total += read
          if (total > maximumBytes) {
            throw VaultRepositoryException("BACKUP_FILE_TOO_LARGE", "Backup document is too large")
          }
          output.write(buffer, 0, read)
        }
        output.flush()
      }
      if (total == 0L) {
        throw VaultRepositoryException("INVALID_BACKUP", "Backup document is empty")
      }
    } finally {
      buffer.fill(0)
    }
  }
}

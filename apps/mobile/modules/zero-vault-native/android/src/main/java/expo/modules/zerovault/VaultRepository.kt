package expo.modules.zerovault

import android.util.Base64
import android.os.SystemClock
import androidx.fragment.app.FragmentActivity
import androidx.room.withTransaction
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.Locale
import java.util.UUID
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

data class CiphertextRecord(
  val accountId: String,
  val recordId: String,
  val ciphertextEnvelopeJson: String,
  val itemRevision: Long,
  val lastSyncedAt: String,
  val hasConflict: Boolean,
  val itemType: String? = null,
  val isDeleted: Boolean = false,
)

data class SyncCursor(
  val accountId: String,
  val serverRevision: Long,
  val lastSyncedAt: String?,
  val serverCursor: Long? = null,
)

data class PendingMutation(
  val accountId: String,
  val clientMutationId: String,
  val recordId: String,
  val operation: String,
  val baseItemRevision: Long,
  val ciphertextEnvelopeJson: String?,
  val createdAt: String,
  val attemptCount: Int,
  val lastErrorCode: String?,
)

data class MutationAcknowledgement(
  val clientMutationId: String,
  val appliedItemRevision: Long,
)

data class RemoteDeletedItem(
  val recordId: String,
  val itemRevision: Long,
  val deletedAt: String,
)

data class SyncConflict(
  val accountId: String,
  val recordId: String,
  val reason: String,
  val localCiphertextEnvelopeJson: String?,
  val remoteCiphertextEnvelopeJson: String?,
  val serverRevision: Long,
  val serverItemRevision: Long?,
  val status: String = "UNRESOLVED",
  val createdAt: String,
)

data class VaultSessionHandle(val value: String)
data class OpaqueStartResult(val request: String)
data class OpaqueRegistrationFinishResult(
  val registrationRecord: String,
  val serverStaticPublicKey: String,
)
data class PreparedDevice(
  val deviceId: String,
  val credential: String,
  val publicKey: String,
  val fingerprint: String,
)
data class BoundDevice(val deviceId: String, val publicKey: String, val fingerprint: String)
enum class LocalDeviceUnlockState {
  PASSWORD_ALLOWED,
  DEVICE_KEY_INVALIDATED,
  BIOMETRIC_READY,
  BIOMETRIC_INVALIDATED,
}
data class LocalDeviceSecurityState(
  val fingerprint: String,
  val unlockState: LocalDeviceUnlockState,
)
data class DeviceLoginMaterial(
  val accountId: String?,
  val deviceId: String,
  val credential: String,
  val publicKey: String,
  val fingerprint: String,
)
data class InitialVaultBootstrap(
  val sessionHandle: String,
  val encryptedVaultKeyPacketJson: String,
  val recoveryCode: String,
  val recoveryPacketJson: String,
  val recoverySigningPublicKey: String,
)
data class PendingRecoveryMaterial(
  val recoveryCode: String,
  val recoveryPacketJson: String,
  val recoverySigningPublicKey: String,
)
data class NativeRecoveryV2Open(
  val sessionHandle: String,
  val recoveryProofHandle: String,
  val signingPublicKey: String,
)
data class NativeRecoveryV2Rotation(
  val recoveryCode: String,
  val recoveryPacketJson: String,
  val signingPublicKey: String,
)
data class NativeEncryptedItem(val encryptedItemKeyJson: String, val encryptedPayloadJson: String)
data class NativeTotp(val code: String, val validForSeconds: Int)

enum class AutofillStatus { READY, LOCKED_BIOMETRIC, UNAVAILABLE }

data class AutofillTarget(
  val webOrigin: String? = null,
  val packageName: String? = null,
  val signingCertSha256: String? = null,
)

data class AutofillCandidate(val id: String, val title: String, val username: String)
data class RevealedCredential(val username: String, val password: String)

class VaultRepositoryException(
  val code: String,
  val safeMessage: String,
) : IllegalStateException(safeMessage)

interface VaultRepository {
  fun protocolVersion(): Int
  suspend fun createEncryptedBackup(accountId: String, backupId: String): String
  suspend fun restoreEncryptedBackup(accountId: String, backupId: String, snapshotJson: String)
  suspend fun importCryptoCoreBackup(accountId: String, backupJson: String, password: String): Int
  suspend fun listCiphertexts(accountId: String): List<CiphertextRecord>
  suspend fun getCiphertext(accountId: String, recordId: String): CiphertextRecord?
  suspend fun putCiphertext(record: CiphertextRecord)
  suspend fun getSyncCursor(accountId: String): SyncCursor?
  suspend fun setSyncCursor(cursor: SyncCursor)
  suspend fun deleteCiphertext(accountId: String, recordId: String)
  suspend fun setConflictIds(accountId: String, recordIds: List<String>)
  suspend fun clearCiphertexts(accountId: String)
  suspend fun upsertLocalCiphertextAndEnqueue(
    record: CiphertextRecord,
    baseItemRevision: Long?,
    clientMutationId: String,
  )
  suspend fun deleteLocalAndEnqueue(
    accountId: String,
    recordId: String,
    baseItemRevision: Long?,
    clientMutationId: String,
    createdAt: String,
  )
  suspend fun listPendingMutations(accountId: String): List<PendingMutation>
  suspend fun ackMutations(
    accountId: String,
    acknowledgements: List<MutationAcknowledgement>,
    serverRevision: Long,
    timestamp: String,
  )
  suspend fun applyPull(
    accountId: String,
    items: List<CiphertextRecord>,
    deletedItems: List<RemoteDeletedItem>,
    serverRevision: Long,
    cursor: Long,
    timestamp: String,
  )
  suspend fun saveConflicts(conflicts: List<SyncConflict>)
  suspend fun listConflicts(accountId: String): List<SyncConflict>
  suspend fun resolveConflict(
    accountId: String,
    recordId: String,
    resolution: String,
    replacement: CiphertextRecord? = null,
    clientMutationId: String? = null,
  )
  fun opaqueStartLogin(email: String, password: String): OpaqueStartResult
  fun opaqueFinishLogin(email: String, response: String): String
  fun opaqueCancelLogin()
  fun opaqueStartRegistration(email: String, password: String): OpaqueStartResult
  fun opaqueFinishRegistration(email: String, response: String): OpaqueRegistrationFinishResult
  fun opaqueCancelRegistration()
  fun prepareDevice(email: String): PreparedDevice
  fun getRecoveryContinuationDevice(email: String): PreparedDevice?
  fun abandonRecoveryContinuation(email: String, deviceId: String)
  suspend fun prepareDeviceLogin(email: String): DeviceLoginMaterial
  suspend fun bindDevice(
    email: String,
    accountId: String,
    deviceId: String,
  ): BoundDevice
  suspend fun completeDeviceLogin(email: String, accountId: String)
  suspend fun resetDeviceLogin(email: String)
  fun bootstrapInitialVault(email: String): InitialVaultBootstrap
  fun getPendingRecovery(email: String): PendingRecoveryMaterial?
  fun getBoundPendingRecovery(email: String): PendingRecoveryMaterial?
  fun acknowledgePendingRecovery(email: String)
  suspend fun installEncryptedVaultKey(accountId: String, encryptedVaultKeyPacketJson: String)
  suspend fun hasVaultKey(accountId: String): Boolean
  suspend fun getLocalDeviceSecurityState(accountId: String): LocalDeviceSecurityState
  suspend fun unlockWithDevice(accountId: String): VaultSessionHandle
  suspend fun enableBiometric(activity: FragmentActivity, accountId: String)
  suspend fun unlockWithBiometric(activity: FragmentActivity, accountId: String): VaultSessionHandle
  suspend fun unlockActiveAccountWithBiometric(activity: FragmentActivity): VaultSessionHandle
  suspend fun shareVaultKey(
    sessionHandle: VaultSessionHandle,
    recipientDeviceId: String,
    recipientPublicKey: String,
  ): String
  fun openSession(accountId: String): VaultSessionHandle
  fun closeSession(sessionHandle: VaultSessionHandle)
  fun lockAll()
  fun activeAccountId(): String?
  fun isUnlocked(): Boolean
  fun autofillStatus(): AutofillStatus
  suspend fun findAutofillCandidates(target: AutofillTarget): List<AutofillCandidate>
  suspend fun revealAutofillCredential(candidateId: String, target: AutofillTarget): RevealedCredential
  fun encryptItem(sessionHandle: VaultSessionHandle, itemJson: String, itemId: String): NativeEncryptedItem
  fun decryptItem(
    sessionHandle: VaultSessionHandle,
    encryptedItemKeyJson: String,
    encryptedPayloadJson: String,
    itemId: String,
  ): String
  fun generateRecoveryPacket(sessionHandle: VaultSessionHandle, recoveryCode: String): String
  fun restoreRecoveryPacket(accountId: String, recoveryCode: String, packetJson: String): VaultSessionHandle
  fun openRecoveryV2(recoveryCode: String, packetJson: String): NativeRecoveryV2Open
  fun prepareRecoveryRotation(email: String, sessionHandle: VaultSessionHandle): NativeRecoveryV2Rotation
  fun signRecoveryFinish(recoveryProofHandle: String, transcriptBase64Url: String): String
  fun cancelRecovery(recoveryProofHandle: String, sessionHandle: VaultSessionHandle)
  fun generatePassword(length: Int, upper: Boolean, lower: Boolean, digits: Boolean, symbols: Boolean): String
  fun generateTotp(secretOrUri: String, timestampSeconds: Long): NativeTotp
}

class DefaultVaultRepository(
  private val database: ZeroVaultDatabase,
  private val rust: RustCrypto,
  private val keyStore: AndroidKeyStore,
  private val secureMaterials: SecureMaterialStore,
  private val biometricGate: BiometricGate,
  private val sessionGenerationStore: VaultSessionGenerationStore,
) : VaultRepository {
  private val sessionLock = Any()
  private val sessionsByAccount = mutableMapOf<String, VaultSessionHandle>()
  private val accountBySession = mutableMapOf<String, String>()
  private val generationBySession = mutableMapOf<String, Long>()
  private val generationByRecoveryProof = mutableMapOf<String, Long>()
  private val opaqueLock = Any()
  private var activeLogin: OpaqueOperation? = null
  private var activeRegistration: OpaqueOperation? = null
  private var completedOpaqueAuthorization: OpaqueAuthorization? = null
  private val unlockGrantsByAccount = mutableMapOf<String, Long>()
  private var bootstrapSession: VaultSessionHandle? = null

  override fun protocolVersion(): Int = rust.protocolVersion()

  override suspend fun createEncryptedBackup(accountId: String, backupId: String): String {
    requireIdentifier(accountId, "account")
    requireUuid(backupId, "backup")
    val handle = sessionForAccount(accountId)
    val plaintext = database.withTransaction {
      if (database.syncConflicts().list(accountId).isNotEmpty()) {
        throw VaultRepositoryException("BACKUP_CONFLICTS_PRESENT", "Resolve sync conflicts before creating a backup")
      }
      val cursor = database.syncCursors().get(accountId)
      JSONObject()
        .put("format", MOBILE_ENCRYPTED_BACKUP_FORMAT)
        .put("version", 1)
        .put("createdAt", Instant.now().toString())
        .put("items", JSONArray(database.ciphertexts().listIncludingTombstones(accountId).map { item ->
          JSONObject()
            .put("recordId", item.recordId)
            .put("ciphertext", JSONObject(item.ciphertextEnvelopeJson))
            .put("itemRevision", item.itemRevision)
            .put("lastSyncedAt", item.lastSyncedAt)
            .put("isDeleted", item.isDeleted)
        }))
        .put("pendingMutations", JSONArray(database.pendingMutations().list(accountId).map { mutation ->
          JSONObject()
            .put("clientMutationId", mutation.clientMutationId)
            .put("recordId", mutation.recordId)
            .put("operation", mutation.operation)
            .put("baseItemRevision", mutation.baseItemRevision)
            .put("ciphertext", mutation.ciphertextEnvelopeJson?.let(::JSONObject) ?: JSONObject.NULL)
            .put("createdAt", mutation.createdAt)
        }))
        .put("sync", cursor?.let {
          JSONObject()
            .put("serverRevision", it.serverRevision)
            .put("lastSyncedAt", it.lastSyncedAt ?: JSONObject.NULL)
            .put("serverCursor", it.serverCursor ?: JSONObject.NULL)
        } ?: JSONObject.NULL)
        .toString().toByteArray(Charsets.UTF_8)
        .also { require(it.size <= MAX_ENCRYPTED_BACKUP_PLAINTEXT_BYTES) }
    }
    return try {
      val encrypted = rust.encryptBackup(handle.value, accountId, backupId, plaintext)
      require(encrypted.size >= 40)
      JSONObject()
        .put("format", MOBILE_ENCRYPTED_BACKUP_FORMAT)
        .put("version", 2)
        .put("nonce", encodeBase64Url(encrypted.copyOfRange(0, 24)))
        .put("ciphertext", encodeBase64Url(encrypted.copyOfRange(24, encrypted.size)))
        .toString()
        .also { require(it.toByteArray(Charsets.UTF_8).size <= MAX_ENCRYPTED_BACKUP_BYTES) }
    } finally {
      plaintext.fill(0)
    }
  }

  override suspend fun restoreEncryptedBackup(accountId: String, backupId: String, snapshotJson: String) {
    requireIdentifier(accountId, "account")
    requireUuid(backupId, "backup")
    val handle = sessionForAccount(accountId)
    require(snapshotJson.toByteArray(Charsets.UTF_8).size in 1..MAX_ENCRYPTED_BACKUP_BYTES) {
      "Encrypted backup is empty or too large"
    }
    val envelope = JSONObject(snapshotJson)
    require(envelope.keys().asSequence().toSet() == MOBILE_ENCRYPTED_BACKUP_ENVELOPE_KEYS)
    require(envelope.getString("format") == MOBILE_ENCRYPTED_BACKUP_FORMAT)
    require(envelope.getInt("version") == 2)
    val encrypted = decodeCanonicalBase64Url(envelope.getString("nonce"), 24).also { require(it.size == 24) } +
      decodeCanonicalBase64Url(envelope.getString("ciphertext"), MAX_ENCRYPTED_BACKUP_PLAINTEXT_BYTES + 16)
    val plaintext = rust.decryptBackup(handle.value, accountId, backupId, encrypted)
    val snapshot = try {
      JSONObject(plaintext.toString(Charsets.UTF_8))
    } finally {
      plaintext.fill(0)
    }
    require(snapshot.keys().asSequence().toSet() == MOBILE_ENCRYPTED_BACKUP_KEYS)
    require(snapshot.getString("format") == MOBILE_ENCRYPTED_BACKUP_FORMAT)
    require(snapshot.getInt("version") == 1)
    requireTimestamp(snapshot.getString("createdAt"))

    val items = snapshot.getJSONArray("items").let { array ->
      require(array.length() <= MAX_ENCRYPTED_BACKUP_ITEMS)
      (0 until array.length()).map { index ->
        val item = array.getJSONObject(index)
        require(item.keys().asSequence().toSet() == MOBILE_ENCRYPTED_BACKUP_ITEM_KEYS)
        CiphertextRecord(
          accountId = accountId,
          recordId = item.getString("recordId"),
          ciphertextEnvelopeJson = item.getJSONObject("ciphertext").toString(),
          itemRevision = item.getLong("itemRevision"),
          lastSyncedAt = item.getString("lastSyncedAt"),
          hasConflict = false,
          itemType = null,
          isDeleted = item.getBoolean("isDeleted"),
        ).also(::validate)
      }
    }
    require(items.map { it.recordId }.toSet().size == items.size) { "Encrypted backup contains duplicate records" }

    val pending = snapshot.getJSONArray("pendingMutations").let { array ->
      require(array.length() <= MAX_ENCRYPTED_BACKUP_ITEMS)
      (0 until array.length()).map { index ->
        val mutation = array.getJSONObject(index)
        require(mutation.keys().asSequence().toSet() == MOBILE_ENCRYPTED_BACKUP_MUTATION_KEYS)
        val clientMutationId = mutation.getString("clientMutationId").also { requireUuid(it, "client mutation") }
        val recordId = mutation.getString("recordId").also { requireIdentifier(it, "record") }
        val operation = mutation.getString("operation").also { require(it == "upsert" || it == "delete") }
        val baseRevision = mutation.getLong("baseItemRevision").also(::requireSafeRevision)
        val ciphertext = if (mutation.isNull("ciphertext")) null else mutation.getJSONObject("ciphertext").toString()
        require((operation == "upsert") == (ciphertext != null)) { "Encrypted backup mutation payload is invalid" }
        val item = items.singleOrNull { it.recordId == recordId }
          ?: throw IllegalArgumentException("Encrypted backup mutation references a missing record")
        if (ciphertext != null) require(ciphertext == item.ciphertextEnvelopeJson)
        val createdAt = mutation.getString("createdAt").also(::requireTimestamp)
        PendingMutationEntity(accountId, clientMutationId, recordId, operation, baseRevision, ciphertext, createdAt)
      }
    }
    require(pending.map { it.clientMutationId }.toSet().size == pending.size)
    require(pending.map { it.recordId }.toSet().size == pending.size)

    val cursor = if (snapshot.isNull("sync")) null else snapshot.getJSONObject("sync").let { value ->
      require(value.keys().asSequence().toSet() == MOBILE_ENCRYPTED_BACKUP_SYNC_KEYS)
      SyncCursor(
        accountId,
        value.getLong("serverRevision"),
        if (value.isNull("lastSyncedAt")) null else value.getString("lastSyncedAt"),
        if (value.isNull("serverCursor")) null else value.getLong("serverCursor"),
      ).also(::validateCursor)
    }

    database.withTransaction {
      database.ciphertexts().clear(accountId)
      database.pendingMutations().clear(accountId)
      database.syncConflicts().clear(accountId)
      database.syncCursors().delete(accountId)
      database.ciphertexts().upsertAll(items.map(CiphertextRecord::toEntity))
      pending.forEach { database.pendingMutations().upsert(it) }
      cursor?.let { database.syncCursors().upsert(it.toEntity()) }
    }
    lockAll()
  }

  override suspend fun importCryptoCoreBackup(
    accountId: String,
    backupJson: String,
    password: String,
  ): Int {
    requireIdentifier(accountId, "account")
    val handle = sessionForAccount(accountId)
    require(backupJson.toByteArray(Charsets.UTF_8).size in 1..MAX_CRYPTO_CORE_BACKUP_BYTES) {
      "Encrypted backup is empty or too large"
    }
    require(password.isNotEmpty() && password.length <= 1024) { "Backup password is invalid" }
    val backup = try {
      JSONObject(backupJson)
    } catch (error: JSONException) {
      throw IllegalArgumentException("Encrypted backup has an invalid shape", error)
    }
    if (backup.optString("runtime") == "webcrypto-mvp") {
      throw VaultRepositoryException(
        "LEGACY_BACKUP_UNSUPPORTED",
        "Migrate webcrypto-mvp backups in the Web client before importing on Android",
      )
    }
    require(backup.keys().asSequence().toSet() == CRYPTO_CORE_BACKUP_KEYS)
    require(backup.getInt("schemaVersion") == 1 && backup.getString("runtime") == "crypto-core-wasm")
    requireTimestamp(backup.getString("updatedAt"))
    val kdf = backup.getJSONObject("kdf")
    require(kdf.keys().asSequence().toSet() == CRYPTO_CORE_BACKUP_KDF_KEYS)
    require(kdf.getString("alg") == "ARGON2ID_V13")
    val cipher = backup.getJSONObject("cipher")
    require(cipher.keys().asSequence().toSet() == CRYPTO_CORE_BACKUP_CIPHER_KEYS)
    require(cipher.getString("alg") == "XCHACHA20_POLY1305")
    val salt = decodeCanonicalBase64Url(kdf.getString("salt"), 16).also { require(it.size == 16) }
    val nonce = decodeCanonicalBase64Url(cipher.getString("nonce"), 24).also { require(it.size == 24) }
    val ciphertext = decodeCanonicalBase64Url(cipher.getString("ciphertext"), MAX_CRYPTO_CORE_BACKUP_BYTES)
      .also { require(it.size >= 16) }

    val plaintext = rust.decryptCryptoCoreBackup(
      password,
      salt,
      kdf.getInt("memoryKib"),
      kdf.getInt("iterations"),
      kdf.getInt("parallelism"),
      nonce + ciphertext,
    )
    try {
      val snapshot = JSONObject(plaintext.toString(Charsets.UTF_8))
      require(snapshot.keys().asSequence().toSet() == CRYPTO_CORE_SNAPSHOT_KEYS)
      require(snapshot.getInt("schemaVersion") == 1)
      requireTimestamp(snapshot.getString("createdAt"))
      requireTimestamp(snapshot.getString("updatedAt"))
      val items = snapshot.getJSONArray("items")
      require(items.length() <= MAX_CRYPTO_CORE_BACKUP_ITEMS)
      require(backup.getInt("itemCount") == items.length())
      val now = Instant.now().toString()
      val records = (0 until items.length()).map { index ->
        val item = items.getJSONObject(index)
        validateImportedVaultItem(item)
        val itemId = item.getString("id")
        val itemBytes = item.toString().toByteArray(Charsets.UTF_8)
        val encrypted = try {
          rust.encryptItem(handle.value, itemBytes, itemId)
        } finally {
          itemBytes.fill(0)
        }
        val envelope = JSONObject()
          .put("id", itemId)
          .put("ownerUserId", accountId)
          .put("revision", 0)
          .put("createdAt", item.getString("createdAt"))
          .put("updatedAt", item.getString("updatedAt"))
          .put("encryptedItemKey", JSONObject(encodeCryptoEnvelopeJson(encrypted.encryptedItemKey)))
          .put("encryptedPayload", JSONObject(encodeCryptoEnvelopeJson(encrypted.encryptedPayload)))
          .put("encryptedSearchTokens", JSONArray())
        CiphertextRecord(
          accountId = accountId,
          recordId = itemId,
          ciphertextEnvelopeJson = envelope.toString(),
          itemRevision = 0,
          lastSyncedAt = now,
          hasConflict = false,
          itemType = item.getString("type"),
        ).also(::validate)
      }
      require(records.map { it.recordId }.toSet().size == records.size) { "Backup contains duplicate items" }
      database.withTransaction {
        require(records.none { database.ciphertexts().get(accountId, it.recordId) != null }) {
          "Backup contains an item already present in this vault"
        }
        records.forEach { record ->
          database.ciphertexts().upsert(record.toEntity())
          database.pendingMutations().upsert(
            PendingMutationEntity(
              accountId = accountId,
              clientMutationId = UUID.randomUUID().toString(),
              recordId = record.recordId,
              operation = "upsert",
              baseItemRevision = 0,
              ciphertextEnvelopeJson = record.ciphertextEnvelopeJson,
              createdAt = now,
            ),
          )
        }
      }
      lockAll()
      return records.size
    } finally {
      plaintext.fill(0)
    }
  }

  override suspend fun listCiphertexts(accountId: String): List<CiphertextRecord> {
    requireIdentifier(accountId, "account")
    return database.ciphertexts().list(accountId).map(CiphertextRecordEntity::toDomain)
  }

  override suspend fun getCiphertext(accountId: String, recordId: String): CiphertextRecord? {
    requireIdentifier(accountId, "account")
    requireIdentifier(recordId, "record")
    return database.ciphertexts().get(accountId, recordId)?.takeUnless { it.isDeleted }?.toDomain()
  }

  override suspend fun putCiphertext(record: CiphertextRecord) {
    validate(record)
    database.ciphertexts().upsert(record.toEntity())
  }

  override suspend fun getSyncCursor(accountId: String): SyncCursor? {
    requireIdentifier(accountId, "account")
    return database.syncCursors().get(accountId)?.toDomain()
  }

  override suspend fun setSyncCursor(cursor: SyncCursor) {
    validateCursor(cursor)
    database.syncCursors().upsert(cursor.toEntity())
  }

  override suspend fun deleteCiphertext(accountId: String, recordId: String) {
    requireIdentifier(accountId, "account")
    requireIdentifier(recordId, "record")
    database.ciphertexts().delete(accountId, recordId)
  }

  override suspend fun setConflictIds(accountId: String, recordIds: List<String>) {
    requireIdentifier(accountId, "account")
    recordIds.forEach { requireIdentifier(it, "record") }
    database.withTransaction {
      database.ciphertexts().clearConflicts(accountId)
      if (recordIds.isNotEmpty()) database.ciphertexts().markConflicts(accountId, recordIds)
    }
  }

  override suspend fun clearCiphertexts(accountId: String) {
    requireIdentifier(accountId, "account")
    val hasPendingRecovery = secureMaterials.isPendingRecoveryBoundToAccount(accountId)
    database.withTransaction {
      database.ciphertexts().clear(accountId)
      database.syncCursors().delete(accountId)
      database.pendingMutations().clear(accountId)
      database.syncConflicts().clear(accountId)
      database.deviceState().delete(accountId)
    }
    synchronized(sessionLock) {
      sessionsByAccount.remove(accountId)?.also { handle ->
        accountBySession.remove(handle.value)
        runCatching { rust.lock(handle.value) }
      }
      unlockGrantsByAccount.remove(accountId)
    }
    val clearsPendingRecovery =
      hasPendingRecovery && secureMaterials.clearPendingRecoveryForAccount(accountId)
    secureMaterials.deleteAccount(accountId)
    keyStore.delete(secureMaterials.wrappingAlias(accountId))
    keyStore.delete(secureMaterials.biometricAlias(accountId))
    if (clearsPendingRecovery) keyStore.delete(secureMaterials.pendingRecoveryAlias())
    lockAll()
  }

  override suspend fun upsertLocalCiphertextAndEnqueue(
    record: CiphertextRecord,
    baseItemRevision: Long?,
    clientMutationId: String,
  ) {
    validate(record)
    requireSafeRevision(baseItemRevision)
    val normalizedBaseRevision = baseItemRevision ?: 0L
    requireUuid(clientMutationId, "client mutation")
    database.withTransaction {
      val pending = database.pendingMutations().getForRecord(record.accountId, record.recordId)
      val effectiveBaseRevision = pending?.baseItemRevision ?: normalizedBaseRevision
      database.ciphertexts().upsert(record.copy(isDeleted = false).toEntity())
      database.pendingMutations().deleteForRecord(record.accountId, record.recordId)
      database.pendingMutations().upsert(
        PendingMutationEntity(
          accountId = record.accountId,
          clientMutationId = clientMutationId,
          recordId = record.recordId,
          operation = "upsert",
          baseItemRevision = effectiveBaseRevision,
          ciphertextEnvelopeJson = record.ciphertextEnvelopeJson,
          createdAt = Instant.now().toString(),
        ),
      )
    }
  }

  override suspend fun deleteLocalAndEnqueue(
    accountId: String,
    recordId: String,
    baseItemRevision: Long?,
    clientMutationId: String,
    createdAt: String,
  ) {
    requireIdentifier(accountId, "account")
    requireIdentifier(recordId, "record")
    requireSafeRevision(baseItemRevision)
    requireUuid(clientMutationId, "client mutation")
    requireTimestamp(createdAt)
    database.withTransaction {
      val pending = database.pendingMutations().getForRecord(accountId, recordId)
      if (pending?.operation == "upsert" && pending.baseItemRevision == 0L) {
        database.ciphertexts().delete(accountId, recordId)
        database.pendingMutations().deleteForRecord(accountId, recordId)
        return@withTransaction
      }
      val deleteBaseRevision = pending?.baseItemRevision ?: baseItemRevision
        ?: throw IllegalArgumentException("Delete base revision is required for a synchronized item")
      database.ciphertexts().get(accountId, recordId)?.let {
        database.ciphertexts().upsert(it.copy(isDeleted = true))
      }
      database.pendingMutations().deleteForRecord(accountId, recordId)
      database.pendingMutations().upsert(
        PendingMutationEntity(
          accountId = accountId,
          clientMutationId = clientMutationId,
          recordId = recordId,
          operation = "delete",
          baseItemRevision = deleteBaseRevision,
          ciphertextEnvelopeJson = null,
          createdAt = createdAt,
        ),
      )
    }
  }

  override suspend fun listPendingMutations(accountId: String): List<PendingMutation> {
    requireIdentifier(accountId, "account")
    return database.pendingMutations().list(accountId).map(PendingMutationEntity::toDomain)
  }

  override suspend fun ackMutations(
    accountId: String,
    acknowledgements: List<MutationAcknowledgement>,
    serverRevision: Long,
    timestamp: String,
  ) {
    requireIdentifier(accountId, "account")
    acknowledgements.forEach {
      requireUuid(it.clientMutationId, "client mutation")
      requireSafeRevision(it.appliedItemRevision)
    }
    require(acknowledgements.map { it.clientMutationId }.distinct().size == acknowledgements.size) {
      "Mutation acknowledgement is duplicated"
    }
    requireSafeRevision(serverRevision)
    requireTimestamp(timestamp)
    database.withTransaction {
      val revisions = acknowledgements.associate { it.clientMutationId to it.appliedItemRevision }
      val pending = if (revisions.isEmpty()) {
        emptyList()
      } else {
        database.pendingMutations().getAll(accountId, revisions.keys.toList())
      }
      if (pending.size != revisions.size) {
        throw VaultRepositoryException("MUTATION_NOT_FOUND", "Mutation acknowledgement no longer matches the queue")
      }
      pending.forEach { mutation ->
        if (mutation.operation == "delete") {
          database.ciphertexts().delete(accountId, mutation.recordId)
        } else {
          val itemRevision = requireNotNull(revisions[mutation.clientMutationId])
          val local = database.ciphertexts().get(accountId, mutation.recordId)
            ?: throw VaultRepositoryException("ITEM_NOT_FOUND", "Acknowledged item no longer exists")
          val envelope = JSONObject(local.ciphertextEnvelopeJson)
            .put("revision", itemRevision)
            .toString()
          database.ciphertexts().upsert(
            local.copy(
              ciphertextEnvelopeJson = envelope,
              itemRevision = itemRevision,
              lastSyncedAt = timestamp,
              hasConflict = false,
              isDeleted = false,
            ),
          )
        }
      }
      if (revisions.isNotEmpty()) database.pendingMutations().deleteAll(accountId, revisions.keys.toList())
      val current = database.syncCursors().get(accountId)
      if (current != null && serverRevision < current.serverRevision) {
        throw VaultRepositoryException("SYNC_REVISION_REGRESSED", "Server revision moved backwards")
      }
      database.syncCursors().upsert(
        SyncCursorEntity(accountId, serverRevision, timestamp, current?.serverCursor, 2),
      )
    }
  }

  override suspend fun applyPull(
    accountId: String,
    items: List<CiphertextRecord>,
    deletedItems: List<RemoteDeletedItem>,
    serverRevision: Long,
    cursor: Long,
    timestamp: String,
  ) {
    requireIdentifier(accountId, "account")
    requireSafeRevision(serverRevision)
    requireSafeRevision(cursor)
    requireTimestamp(timestamp)
    items.forEach { require(it.accountId == accountId); validate(it) }
    deletedItems.forEach {
      requireIdentifier(it.recordId, "record")
      requireSafeRevision(it.itemRevision)
      requireTimestamp(it.deletedAt)
    }
    require((items.map { it.recordId } + deletedItems.map { it.recordId }).distinct().size == items.size + deletedItems.size) {
      "Pull response contains duplicate records"
    }
    database.withTransaction {
      val current = database.syncCursors().get(accountId)
      if (current != null &&
        (serverRevision < current.serverRevision || cursor < (current.serverCursor ?: 0L))
      ) {
        throw VaultRepositoryException("SYNC_REVISION_REGRESSED", "Sync cursor or revision moved backwards")
      }
      items.forEach { remote ->
        val pending = database.pendingMutations().getForRecord(accountId, remote.recordId)
        if (pending == null) {
          database.ciphertexts().upsert(remote.copy(lastSyncedAt = timestamp, hasConflict = false, isDeleted = false).toEntity())
        } else {
          savePullConflict(accountId, remote.recordId, remote.ciphertextEnvelopeJson, serverRevision, remote.itemRevision, timestamp)
        }
      }
      deletedItems.forEach { deleted ->
        val pending = database.pendingMutations().getForRecord(accountId, deleted.recordId)
        if (pending == null) {
          database.ciphertexts().delete(accountId, deleted.recordId)
        } else {
          savePullConflict(
            accountId,
            deleted.recordId,
            null,
            serverRevision,
            deleted.itemRevision,
            timestamp,
          )
        }
      }
      database.syncCursors().upsert(SyncCursorEntity(accountId, serverRevision, timestamp, cursor, 2))
    }
  }

  override suspend fun saveConflicts(conflicts: List<SyncConflict>) {
    conflicts.forEach(::validateConflict)
    database.withTransaction {
      database.syncConflicts().upsertAll(conflicts.map(SyncConflict::toEntity))
      conflicts.groupBy { it.accountId }.forEach { (accountId, values) ->
        database.ciphertexts().markConflicts(accountId, values.map { it.recordId })
      }
    }
  }

  override suspend fun listConflicts(accountId: String): List<SyncConflict> {
    requireIdentifier(accountId, "account")
    return database.syncConflicts().list(accountId).map(SyncConflictEntity::toDomain)
  }

  override suspend fun resolveConflict(
    accountId: String,
    recordId: String,
    resolution: String,
    replacement: CiphertextRecord?,
    clientMutationId: String?,
  ) {
    requireIdentifier(accountId, "account")
    requireIdentifier(recordId, "record")
    require(resolution in CONFLICT_RESOLUTIONS) { "Conflict resolution is invalid" }
    database.withTransaction {
      val conflict = database.syncConflicts().get(accountId, recordId)
        ?: throw VaultRepositoryException("CONFLICT_NOT_FOUND", "Sync conflict no longer exists")
      when (resolution) {
        "keep_local" -> {
          val pending = database.pendingMutations().getForRecord(accountId, recordId)
          val local = database.ciphertexts().get(accountId, recordId)
            ?: throw VaultRepositoryException("ITEM_NOT_FOUND", "Local conflict item no longer exists")
          val operation = pending?.operation ?: if (local.isDeleted) "delete" else "upsert"
          database.pendingMutations().deleteForRecord(accountId, recordId)
          database.pendingMutations().upsert(
            PendingMutationEntity(
              accountId = accountId,
              clientMutationId = UUID.randomUUID().toString(),
              recordId = recordId,
              operation = operation,
              baseItemRevision = conflict.serverItemRevision ?: 0L,
              ciphertextEnvelopeJson = if (operation == "upsert") local.ciphertextEnvelopeJson else null,
              createdAt = Instant.now().toString(),
            ),
          )
          database.ciphertexts().setConflict(accountId, recordId, false)
          database.syncConflicts().delete(accountId, recordId)
        }
        "accept_remote" -> {
          applyRemoteConflict(conflict)
          database.pendingMutations().deleteForRecord(accountId, recordId)
          database.syncConflicts().delete(accountId, recordId)
        }
        "create_copy" -> {
          val copy = requireNotNull(replacement) { "Encrypted replacement is required" }
          val mutationId = requireNotNull(clientMutationId) { "Client mutation identifier is required" }
          require(copy.accountId == accountId && copy.recordId != recordId)
          validate(copy)
          requireUuid(mutationId, "client mutation")
          applyRemoteConflict(conflict)
          database.pendingMutations().deleteForRecord(accountId, recordId)
          database.ciphertexts().upsert(copy.copy(hasConflict = false).toEntity())
          database.pendingMutations().upsert(
            PendingMutationEntity(
              accountId,
              mutationId,
              copy.recordId,
              "upsert",
              0L,
              copy.ciphertextEnvelopeJson,
              Instant.now().toString(),
            ),
          )
          database.syncConflicts().delete(accountId, recordId)
        }
        "skip" -> database.syncConflicts().setStatus(accountId, recordId, "SKIPPED")
      }
    }
  }

  override fun opaqueStartLogin(email: String, password: String): OpaqueStartResult = synchronized(opaqueLock) {
    validateEmail(email)
    activeLogin?.let { runCatching { rust.opaqueCancel(it.handle) } }
    completedOpaqueAuthorization = null
    rust.opaqueStartLogin(password, email, OPAQUE_SERVER_IDENTIFIER).also {
      activeLogin = OpaqueOperation(it.stateHandle, email)
    }.let { OpaqueStartResult(it.request) }
  }

  override fun opaqueFinishLogin(email: String, response: String): String = synchronized(opaqueLock) {
    val active = activeLogin ?: throw VaultRepositoryException("AUTH_EXPIRED", "Login operation expired")
    require(active.email == email) { "Login identifier changed" }
    activeLogin = null
    rust.opaqueFinishLogin(active.handle, response).also {
      completedOpaqueAuthorization = OpaqueAuthorization(
        normalizedEmail(email),
        OpaqueAuthorizationKind.LOGIN,
        SystemClock.elapsedRealtime(),
      )
    }
  }

  override fun opaqueCancelLogin() = synchronized(opaqueLock) {
    activeLogin?.let { runCatching { rust.opaqueCancel(it.handle) } }
    activeLogin = null
    completedOpaqueAuthorization = null
  }

  override fun opaqueStartRegistration(email: String, password: String): OpaqueStartResult = synchronized(opaqueLock) {
    validateEmail(email)
    activeRegistration?.let { runCatching { rust.opaqueCancel(it.handle) } }
    completedOpaqueAuthorization = null
    rust.opaqueStartRegistration(password, email, OPAQUE_SERVER_IDENTIFIER).also {
      activeRegistration = OpaqueOperation(it.stateHandle, email)
    }.let { OpaqueStartResult(it.request) }
  }

  override fun opaqueFinishRegistration(
    email: String,
    response: String,
  ): OpaqueRegistrationFinishResult = synchronized(opaqueLock) {
    val active = activeRegistration
      ?: throw VaultRepositoryException("AUTH_EXPIRED", "Registration operation expired")
    require(active.email == email) { "Registration identifier changed" }
    activeRegistration = null
    rust.opaqueFinishRegistration(active.handle, response).let {
      completedOpaqueAuthorization = OpaqueAuthorization(
        normalizedEmail(email),
        OpaqueAuthorizationKind.REGISTRATION,
        SystemClock.elapsedRealtime(),
      )
      OpaqueRegistrationFinishResult(it.registrationRecord, it.serverStaticPublicKey)
    }
  }

  override fun opaqueCancelRegistration() = synchronized(opaqueLock) {
    activeRegistration?.let { runCatching { rust.opaqueCancel(it.handle) } }
    activeRegistration = null
    completedOpaqueAuthorization = null
  }

  override fun prepareDevice(email: String): PreparedDevice {
    validateEmail(email)
    pendingRegistrationDevice(email)?.let { return it }
    secureMaterials.clearPendingDevice()
    keyStore.delete(secureMaterials.pendingAlias())
    val pair = rust.generateDeviceKeyPair()
    val credentialBytes = ByteArray(32).also(SECURE_RANDOM::nextBytes)
    var encodedCredentialBytes = ByteArray(0)
    return try {
      val deviceId = UUID.randomUUID().toString()
      val credential = encodeBase64Url(credentialBytes)
      encodedCredentialBytes = credential.toByteArray(Charsets.UTF_8)
      val publicKey = encodeBase64Url(pair.publicKey)
      val fingerprint = sha256Hex(pair.publicKey)
      secureMaterials.putPendingDevice(
        email,
        deviceId,
        keyStore.wrap(secureMaterials.pendingAlias(), pair.privateKey),
        keyStore.wrap(secureMaterials.pendingAlias(), encodedCredentialBytes),
        publicKey,
        fingerprint,
      )
      PreparedDevice(deviceId, credential, publicKey, fingerprint)
    } finally {
      pair.privateKey.fill(0)
      encodedCredentialBytes.fill(0)
      credentialBytes.fill(0)
    }
  }

  override fun getRecoveryContinuationDevice(email: String): PreparedDevice? {
    validateEmail(email)
    if (!secureMaterials.pendingRecoveryMatches(email) ||
      secureMaterials.isPendingRecoveryBound(email) ||
      !secureMaterials.pendingDeviceMatches(email)
    ) {
      return null
    }
    return pendingRegistrationDevice(email)
  }

  override fun abandonRecoveryContinuation(email: String, deviceId: String) {
    validateEmail(email)
    requireUuid(deviceId, "device")
    if (!secureMaterials.pendingRecoveryMatches(email) ||
      secureMaterials.isPendingRecoveryBound(email) ||
      !secureMaterials.pendingDeviceMatches(email) ||
      secureMaterials.pendingDeviceId() != deviceId
    ) {
      throw VaultRepositoryException("DEVICE_IDENTITY_MISMATCH", "Recovery continuation does not match the device")
    }
    secureMaterials.clearPendingRecovery(email)
    keyStore.delete(secureMaterials.pendingRecoveryAlias())
  }

  override suspend fun bindDevice(
    email: String,
    accountId: String,
    deviceId: String,
  ): BoundDevice {
    validateEmail(email)
    requireIdentifier(accountId, "account")
    requireUuid(deviceId, "device")
    if (!secureMaterials.pendingDeviceMatches(email) || secureMaterials.pendingDeviceId() != deviceId) {
      throw VaultRepositoryException("DEVICE_IDENTITY_MISMATCH", "Device response does not match registration")
    }
    consumeOpaqueAuthorization(
      email,
      setOf(OpaqueAuthorizationKind.LOGIN, OpaqueAuthorizationKind.REGISTRATION),
    )
    val pending = secureMaterials.pendingDevicePrivateKey()
      ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Pending device identity is unavailable")
    val publicKey = secureMaterials.pendingDevicePublicKey()
      ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Pending device identity is unavailable")
    val fingerprint = secureMaterials.pendingDeviceFingerprint()
      ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Pending device identity is unavailable")
    val privateKey = keyStore.unwrap(secureMaterials.pendingAlias(), pending)
    val credentialBytes = bindingCredentialBytes(deviceId)
    try {
      secureMaterials.putDevicePrivateKey(
        accountId,
        keyStore.wrap(secureMaterials.wrappingAlias(accountId), privateKey),
      )
      secureMaterials.putDeviceCredential(
        accountId,
        keyStore.wrap(secureMaterials.wrappingAlias(accountId), credentialBytes),
      )
    } finally {
      privateKey.fill(0)
      credentialBytes.fill(0)
    }
    database.deviceState().upsert(
      DeviceStateEntity(accountId, deviceId, publicKey, fingerprint, null, Instant.now().toString()),
    )
    secureMaterials.bindEmail(email, accountId)
    secureMaterials.bindPendingRecoveryAccount(email, accountId)
    secureMaterials.setActiveAccount(accountId)
    secureMaterials.clearDevicePrivateKey(accountId, biometric = true)
    keyStore.delete(secureMaterials.biometricAlias(accountId))
    secureMaterials.setBiometricRequired(accountId, false)
    secureMaterials.clearPendingDevice()
    keyStore.delete(secureMaterials.pendingAlias())
    synchronized(sessionLock) {
      val bootstrapped = bootstrapSession
      bootstrapped?.let { registerSession(accountId, it) }
      if (bootstrapped == null) grantOneTimeUnlock(accountId)
      bootstrapSession = null
    }
    return BoundDevice(deviceId, publicKey, fingerprint)
  }

  override suspend fun prepareDeviceLogin(email: String): DeviceLoginMaterial {
    validateEmail(email)
    val accountId = secureMaterials.accountIdForEmail(email)
    if (accountId == null) {
      val pending = pendingDeviceForLogin(email)
      return DeviceLoginMaterial(
        accountId = null,
        deviceId = pending.deviceId,
        credential = pending.credential,
        publicKey = pending.publicKey,
        fingerprint = pending.fingerprint,
      )
    }
    requireIdentifier(accountId, "account")
    val device = database.deviceState().get(accountId)
      ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Device identity is unavailable")
    val wrappedCredential = secureMaterials.getDeviceCredential(accountId)
      ?: throw VaultRepositoryException("DEVICE_CREDENTIAL_MISSING", "Device credential is unavailable")
    val credentialBytes = keyStore.unwrap(secureMaterials.wrappingAlias(accountId), wrappedCredential)
    return try {
      val credential = credentialBytes.toString(Charsets.UTF_8)
      require(DEVICE_CREDENTIAL.matches(credential)) { "Device credential is invalid" }
      DeviceLoginMaterial(accountId, device.deviceId, credential, device.publicKey, device.fingerprint)
    } finally {
      credentialBytes.fill(0)
    }
  }

  override suspend fun completeDeviceLogin(email: String, accountId: String) {
    validateEmail(email)
    requireIdentifier(accountId, "account")
    if (secureMaterials.accountIdForEmail(email) != accountId) {
      throw VaultRepositoryException("DEVICE_IDENTITY_MISMATCH", "Login does not match the local device")
    }
    if (database.deviceState().get(accountId) == null || secureMaterials.getDeviceCredential(accountId) == null) {
      throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Device identity is unavailable")
    }
    consumeOpaqueAuthorization(email, setOf(OpaqueAuthorizationKind.LOGIN))
    secureMaterials.setActiveAccount(accountId)
    grantOneTimeUnlock(accountId)
  }

  override suspend fun resetDeviceLogin(email: String) {
    validateEmail(email)
    val accountId = secureMaterials.accountIdForEmail(email)
    if (accountId != null) {
      lockAll()
      synchronized(sessionLock) {
        sessionsByAccount.remove(accountId)?.also {
          accountBySession.remove(it.value)
          generationBySession.remove(it.value)
          runCatching { rust.lock(it.value) }
        }
        unlockGrantsByAccount.remove(accountId)
      }
      database.deviceState().delete(accountId)
      secureMaterials.deleteAccount(accountId)
      keyStore.delete(secureMaterials.wrappingAlias(accountId))
      keyStore.delete(secureMaterials.biometricAlias(accountId))
    }
    if (secureMaterials.pendingDeviceMatches(email)) {
      secureMaterials.clearPendingDevice()
      keyStore.delete(secureMaterials.pendingAlias())
    }
    synchronized(opaqueLock) { completedOpaqueAuthorization = null }
  }

  override fun bootstrapInitialVault(email: String): InitialVaultBootstrap {
    validateEmail(email)
    if (!secureMaterials.pendingDeviceMatches(email)) {
      throw VaultRepositoryException("DEVICE_IDENTITY_MISMATCH", "Recovery bootstrap does not match the device")
    }
    val publicKey = secureMaterials.pendingDevicePublicKey()
      ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Prepare the device before vault bootstrap")
    val deviceId = secureMaterials.pendingDeviceId()
      ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Prepare the device before vault bootstrap")
    getPendingRecovery(email)?.let { existing ->
      val opened = rust.openRecoveryV2(
        existing.recoveryCode,
        decodeRecoveryPacketV2Json(existing.recoveryPacketJson),
      )
      val storedPublicKey = decodeCanonicalBase64Url(existing.recoverySigningPublicKey, 32)
      if (!MessageDigest.isEqual(storedPublicKey, opened.signingPublicKey)) {
        runCatching { rust.cancelRecovery(opened.recoveryProofHandle, opened.sessionHandle) }
        throw VaultRepositoryException("CIPHERTEXT_TAMPERED", "Pending recovery material is inconsistent")
      }
      rust.discardRecoveryProof(opened.recoveryProofHandle)
      val sessionHandle = opened.sessionHandle
      registerBootstrapSession(VaultSessionHandle(sessionHandle))
      return InitialVaultBootstrap(
        sessionHandle = sessionHandle,
        encryptedVaultKeyPacketJson = encodeDevicePacket(
          deviceId,
          publicKey,
          rust.shareVaultKey(sessionHandle, decodeBase64Url(publicKey)),
        ),
        recoveryCode = existing.recoveryCode,
        recoveryPacketJson = existing.recoveryPacketJson,
        recoverySigningPublicKey = existing.recoverySigningPublicKey,
      )
    }
    val created = rust.createVaultForDevice(decodeBase64Url(publicKey))
    registerBootstrapSession(VaultSessionHandle(created.sessionHandle))
    val recovery = try {
      rust.prepareRecoveryRotation(created.sessionHandle)
    } catch (error: Exception) {
      runCatching { rust.lock(created.sessionHandle) }
      throw error
    }
    val recoveryPacketJson = encodeRecoveryPacketV2(recovery.encryptedRecoveryPacket)
    val recoverySigningPublicKey = encodeBase64Url(recovery.signingPublicKey)
    val recoveryCodeBytes = recovery.recoveryCode.toByteArray(Charsets.UTF_8)
    val recoveryPacketBytes = recoveryPacketJson.toByteArray(Charsets.UTF_8)
    try {
      secureMaterials.putPendingRecovery(
        email,
        keyStore.wrap(secureMaterials.pendingRecoveryAlias(), recoveryCodeBytes),
        keyStore.wrap(secureMaterials.pendingRecoveryAlias(), recoveryPacketBytes),
        recoverySigningPublicKey,
      )
    } catch (error: Exception) {
      runCatching { rust.lock(created.sessionHandle) }
      synchronized(sessionLock) {
        bootstrapSession = null
        generationBySession.remove(created.sessionHandle)
      }
      throw error
    } finally {
      recoveryCodeBytes.fill(0)
      recoveryPacketBytes.fill(0)
    }
    return InitialVaultBootstrap(
      sessionHandle = created.sessionHandle,
      encryptedVaultKeyPacketJson = encodeDevicePacket(deviceId, publicKey, created.encryptedVaultKey),
      recoveryCode = recovery.recoveryCode,
      recoveryPacketJson = recoveryPacketJson,
      recoverySigningPublicKey = recoverySigningPublicKey,
    )
  }

  override fun getPendingRecovery(email: String): PendingRecoveryMaterial? {
    validateEmail(email)
    if (!secureMaterials.pendingRecoveryMatches(email)) return null
    val wrappedCode = secureMaterials.pendingRecoveryCode()
      ?: throw VaultRepositoryException("RECOVERY_MATERIAL_MISSING", "Pending recovery material is incomplete")
    val wrappedPacket = secureMaterials.pendingRecoveryPacket()
      ?: throw VaultRepositoryException("RECOVERY_MATERIAL_MISSING", "Pending recovery material is incomplete")
    val signingPublicKey = secureMaterials.pendingRecoverySigningPublicKey()
      ?: throw VaultRepositoryException("RECOVERY_MATERIAL_MISSING", "Pending recovery material is incomplete")
    val codeBytes = keyStore.unwrap(secureMaterials.pendingRecoveryAlias(), wrappedCode)
    val packetBytes = keyStore.unwrap(secureMaterials.pendingRecoveryAlias(), wrappedPacket)
    return try {
      val code = codeBytes.toString(Charsets.UTF_8)
      val packet = packetBytes.toString(Charsets.UTF_8)
      val decodedCode = decodeCanonicalBase64Url(code, 32)
      try {
        require(decodedCode.size == 32) { "Pending recovery code is invalid" }
      } finally {
        decodedCode.fill(0)
      }
      decodeRecoveryPacketV2Json(packet)
      require(decodeCanonicalBase64Url(signingPublicKey, 32).size == 32) {
        "Pending recovery signing key is invalid"
      }
      PendingRecoveryMaterial(code, packet, signingPublicKey)
    } finally {
      codeBytes.fill(0)
      packetBytes.fill(0)
    }
  }

  override fun getBoundPendingRecovery(email: String): PendingRecoveryMaterial? {
    validateEmail(email)
    val accountId = secureMaterials.accountIdForEmail(email) ?: return null
    if (!secureMaterials.isPendingRecoveryBoundTo(email, accountId)) return null
    return getPendingRecovery(email)
  }

  override fun acknowledgePendingRecovery(email: String) {
    validateEmail(email)
    if (!secureMaterials.pendingRecoveryMatches(email)) {
      throw VaultRepositoryException("RECOVERY_MATERIAL_MISSING", "Pending recovery material is unavailable")
    }
    if (!secureMaterials.isPendingRecoveryBound(email)) {
      throw VaultRepositoryException("RECOVERY_ACK_NOT_ALLOWED", "Bind the account before acknowledging recovery")
    }
    secureMaterials.clearPendingRecovery(email)
    keyStore.delete(secureMaterials.pendingRecoveryAlias())
  }

  override suspend fun installEncryptedVaultKey(
    accountId: String,
    encryptedVaultKeyPacketJson: String,
  ) {
    requireIdentifier(accountId, "account")
    val device = database.deviceState().get(accountId)
      ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Device identity is unavailable")
    decodeDevicePacket(encryptedVaultKeyPacketJson, device.deviceId, device.publicKey)
    database.deviceState().upsert(device.copy(encryptedVaultKey = encryptedVaultKeyPacketJson))
    if (device.encryptedVaultKey != null && device.encryptedVaultKey != encryptedVaultKeyPacketJson) {
      lockAll()
    }
  }

  override suspend fun hasVaultKey(accountId: String): Boolean {
    requireIdentifier(accountId, "account")
    return database.deviceState().get(accountId)?.encryptedVaultKey != null
  }

  override suspend fun getLocalDeviceSecurityState(accountId: String): LocalDeviceSecurityState {
    requireIdentifier(accountId, "account")
    val device = database.deviceState().get(accountId)
      ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Device identity is unavailable")
    if (!SHA256_HEX.matches(device.fingerprint)) {
      throw VaultRepositoryException("DEVICE_IDENTITY_MISMATCH", "Device fingerprint is invalid")
    }
    if (!secureMaterials.isBiometricRequired(accountId)) {
      val unlockState = try {
        val wrapped = secureMaterials.getDevicePrivateKey(accountId)
          ?: throw VaultRepositoryException("KEY_INVALIDATED", "Device key material is unavailable")
        keyStore.createDecryptCipher(secureMaterials.wrappingAlias(accountId), wrapped, false)
        LocalDeviceUnlockState.PASSWORD_ALLOWED
      } catch (_: VaultRepositoryException) {
        LocalDeviceUnlockState.DEVICE_KEY_INVALIDATED
      }
      return LocalDeviceSecurityState(
        fingerprint = device.fingerprint.lowercase(),
        unlockState = unlockState,
      )
    }

    val unlockState = try {
      val wrapped = secureMaterials.getDevicePrivateKey(accountId, biometric = true)
        ?: throw VaultRepositoryException("KEY_INVALIDATED", "Biometric device material is unavailable")
      keyStore.createDecryptCipher(secureMaterials.biometricAlias(accountId), wrapped, true)
      LocalDeviceUnlockState.BIOMETRIC_READY
    } catch (error: VaultRepositoryException) {
      if (error.code == "AUTH_REQUIRED") {
        LocalDeviceUnlockState.BIOMETRIC_READY
      } else {
        secureMaterials.clearDevicePrivateKey(accountId, biometric = true)
        keyStore.delete(secureMaterials.biometricAlias(accountId))
        LocalDeviceUnlockState.BIOMETRIC_INVALIDATED
      }
    }
    return LocalDeviceSecurityState(
      fingerprint = device.fingerprint.lowercase(),
      unlockState = unlockState,
    )
  }

  override suspend fun unlockWithDevice(accountId: String): VaultSessionHandle {
    requireIdentifier(accountId, "account")
    if (secureMaterials.isBiometricRequired(accountId)) {
      throw VaultRepositoryException("BIOMETRIC_REQUIRED", "Biometric authentication is required")
    }
    consumeOneTimeUnlock(accountId)
    val wrappedPrivateKey = secureMaterials.getDevicePrivateKey(accountId)
      ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Device private key is unavailable")
    val device = database.deviceState().get(accountId)
      ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Device identity is unavailable")
    val encryptedVaultKey = device.encryptedVaultKey
      ?: throw VaultRepositoryException("DEVICE_PENDING", "This device has not received a vault key")
    val privateKey = keyStore.unwrap(secureMaterials.wrappingAlias(accountId), wrappedPrivateKey)
    return try {
      VaultSessionHandle(
        rust.openDeviceVault(
          privateKey,
          decodeDevicePacket(encryptedVaultKey, device.deviceId, device.publicKey),
        ),
      ).also { registerSession(accountId, it) }
    } finally {
      privateKey.fill(0)
    }
  }

  override suspend fun enableBiometric(activity: FragmentActivity, accountId: String) {
    requireIdentifier(accountId, "account")
    if (secureMaterials.isBiometricRequired(accountId)) {
      if (secureMaterials.getDevicePrivateKey(accountId, biometric = true) != null) return
      throw VaultRepositoryException("BIOMETRIC_UNAVAILABLE", "Biometric unlock material is unavailable")
    }
    val wrapped = secureMaterials.getDevicePrivateKey(accountId)
      ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Device private key is unavailable")
    val privateKey = keyStore.unwrap(secureMaterials.wrappingAlias(accountId), wrapped)
    try {
      val cipher = keyStore.createEncryptCipher(secureMaterials.biometricAlias(accountId), true)
      val authenticated = biometricGate.authenticate(
        activity,
        cipher,
        activity.getString(R.string.biometric_enable_title),
      )
      secureMaterials.putDevicePrivateKey(
        accountId,
        keyStore.finishEncryption(authenticated, privateKey),
        biometric = true,
      )
      secureMaterials.setBiometricRequired(accountId, true)
      secureMaterials.clearDevicePrivateKey(accountId, biometric = false)
    } finally {
      privateKey.fill(0)
    }
  }

  override suspend fun unlockWithBiometric(
    activity: FragmentActivity,
    accountId: String,
  ): VaultSessionHandle {
    requireIdentifier(accountId, "account")
    val wrapped = secureMaterials.getDevicePrivateKey(accountId, biometric = true)
      ?: throw VaultRepositoryException("BIOMETRIC_UNAVAILABLE", "Biometric unlock is not enabled")
    val device = database.deviceState().get(accountId)
      ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "Device identity is unavailable")
    val encryptedVaultKey = device.encryptedVaultKey
      ?: throw VaultRepositoryException("DEVICE_PENDING", "This device has not received a vault key")
    val privateKey = try {
      val cipher = keyStore.createDecryptCipher(secureMaterials.biometricAlias(accountId), wrapped, true)
      val authenticated = biometricGate.authenticate(
        activity,
        cipher,
        activity.getString(R.string.unlock_zero_vault),
      )
      keyStore.finishDecryption(authenticated, wrapped.ciphertext)
    } catch (error: VaultRepositoryException) {
      if (error.code == "KEY_INVALIDATED") {
        secureMaterials.clearDevicePrivateKey(accountId, biometric = true)
        keyStore.delete(secureMaterials.biometricAlias(accountId))
        lockAll()
      }
      throw error
    }
    return try {
      VaultSessionHandle(
        rust.openDeviceVault(
          privateKey,
          decodeDevicePacket(encryptedVaultKey, device.deviceId, device.publicKey),
        ),
      ).also { registerSession(accountId, it) }
    } finally {
      privateKey.fill(0)
    }
  }

  override suspend fun unlockActiveAccountWithBiometric(activity: FragmentActivity): VaultSessionHandle =
    unlockWithBiometric(
      activity,
      activeAccountId() ?: throw VaultRepositoryException("DEVICE_NOT_INITIALIZED", "No active account exists"),
    )

  override suspend fun shareVaultKey(
    sessionHandle: VaultSessionHandle,
    recipientDeviceId: String,
    recipientPublicKey: String,
  ): String {
    requireUuid(recipientDeviceId, "recipient device")
    val publicKey = decodeBase64Url(recipientPublicKey)
    require(publicKey.size == 32) { "Recipient public key is invalid" }
    val isBootstrapSession = synchronized(sessionLock) { bootstrapSession == sessionHandle }
    requireCurrentSession(sessionHandle, allowBootstrap = isBootstrapSession)
    if (isBootstrapSession && (
        secureMaterials.pendingDeviceId() != recipientDeviceId ||
          secureMaterials.pendingDevicePublicKey() != recipientPublicKey
      )) {
      throw VaultRepositoryException(
        "DEVICE_IDENTITY_MISMATCH",
        "Recovery bootstrap may share only with its prepared replacement device",
      )
    }
    return encodeDevicePacket(
      recipientDeviceId,
      recipientPublicKey,
      rust.shareVaultKey(sessionHandle.value, publicKey),
    )
  }

  override fun openSession(accountId: String): VaultSessionHandle {
    requireIdentifier(accountId, "account")
    return sessionForAccount(accountId)
  }

  override fun closeSession(sessionHandle: VaultSessionHandle) {
    synchronized(sessionLock) {
      accountBySession.remove(sessionHandle.value)?.let { sessionsByAccount.remove(it) }
      generationBySession.remove(sessionHandle.value)
    }
    runCatching { rust.lock(sessionHandle.value) }
  }

  override fun lockAll() {
    // The invalid marker written by advance() makes other processes fail closed
    // even if persisting the next generation is interrupted.
    val revocation = runCatching { sessionGenerationStore.advance() }
    lockLocalState()
    revocation.getOrElse {
      throw VaultRepositoryException(
        "VAULT_LOCKED",
        "Vault was locked locally but cross-process session revocation could not be confirmed",
      )
    }
  }

  private fun lockLocalState() {
    synchronized(sessionLock) {
      sessionsByAccount.clear()
      accountBySession.clear()
      generationBySession.clear()
      generationByRecoveryProof.clear()
      unlockGrantsByAccount.clear()
      bootstrapSession = null
    }
    synchronized(opaqueLock) {
      activeLogin = null
      activeRegistration = null
      completedOpaqueAuthorization = null
    }
    rust.lockAll()
  }

  override fun activeAccountId(): String? = secureMaterials.activeAccountId()

  override fun isUnlocked(): Boolean {
    val accountId = activeAccountId() ?: return false
    return runCatching { sessionForAccount(accountId); true }.getOrDefault(false)
  }

  override fun autofillStatus(): AutofillStatus {
    if (!ZeroVaultNativeModule.OPAQUE_INTEROP_VERIFIED) return AutofillStatus.UNAVAILABLE
    if (!runCatching { protocolVersion() >= 2 }.getOrDefault(false)) {
      return AutofillStatus.UNAVAILABLE
    }
    val accountId = activeAccountId() ?: return AutofillStatus.UNAVAILABLE
    val wrappedBiometricKey = secureMaterials.getDevicePrivateKey(accountId, biometric = true)
    val biometricReady =
      secureMaterials.isBiometricRequired(accountId) &&
        wrappedBiometricKey != null &&
        try {
          keyStore.createDecryptCipher(
            secureMaterials.biometricAlias(accountId),
            wrappedBiometricKey,
            requireBiometric = true,
          )
          true
        } catch (error: VaultRepositoryException) {
          if (error.code == "AUTH_REQUIRED") {
            true
          } else {
            if (error.code == "KEY_INVALIDATED") {
              secureMaterials.clearDevicePrivateKey(accountId, biometric = true)
              keyStore.delete(secureMaterials.biometricAlias(accountId))
              lockAll()
            }
            false
          }
        }
    if (!biometricReady) return AutofillStatus.UNAVAILABLE
    return if (isUnlocked()) AutofillStatus.READY else AutofillStatus.LOCKED_BIOMETRIC
  }

  override suspend fun findAutofillCandidates(target: AutofillTarget): List<AutofillCandidate> {
    validateAutofillTarget(target)
    if (autofillStatus() != AutofillStatus.READY) {
      throw VaultRepositoryException("AUTOFILL_UNAVAILABLE", "Autofill requires biometric unlock")
    }
    val accountId = activeAccountId()
      ?: throw VaultRepositoryException("VAULT_LOCKED", "Vault is locked")
    val handle = sessionForAccount(accountId)
    return database.ciphertexts().list(accountId).asSequence()
      .filter { !it.isDeleted && !it.hasConflict }
      .filter { it.itemType == null || it.itemType == "login" }
      .mapNotNull { record ->
        runCatching { JSONObject(decryptRecord(handle, record.toDomain())) }.getOrNull()
          ?.takeIf { it.optString("type") == "login" && loginMatches(it, target) }
          ?.let {
            AutofillCandidate(
              id = record.recordId,
              title = it.optString("title").take(2048),
              username = it.optString("username").take(1024),
            )
          }
      }
      .take(100)
      .toList()
  }

  override suspend fun revealAutofillCredential(
    candidateId: String,
    target: AutofillTarget,
  ): RevealedCredential {
    requireIdentifier(candidateId, "record")
    validateAutofillTarget(target)
    val accountId = activeAccountId()
      ?: throw VaultRepositoryException("VAULT_LOCKED", "Vault is locked")
    if (autofillStatus() != AutofillStatus.READY) {
      throw VaultRepositoryException("AUTOFILL_UNAVAILABLE", "Autofill requires biometric unlock")
    }
    val record = database.ciphertexts().get(accountId, candidateId)
      ?: throw VaultRepositoryException("ITEM_NOT_FOUND", "Credential no longer exists")
    if (record.isDeleted || record.hasConflict) {
      throw VaultRepositoryException("AUTOFILL_ITEM_UNAVAILABLE", "Credential cannot be used for Autofill")
    }
    val item = JSONObject(decryptRecord(sessionForAccount(accountId), record.toDomain()))
    if (item.optString("type") != "login" || !loginMatches(item, target)) {
      throw VaultRepositoryException("AUTOFILL_TARGET_MISMATCH", "Credential does not match the requesting app")
    }
    return RevealedCredential(
      username = item.optString("username").take(1024),
      password = item.optString("password").take(4096),
    )
  }

  override fun encryptItem(
    sessionHandle: VaultSessionHandle,
    itemJson: String,
    itemId: String,
  ): NativeEncryptedItem {
    requireCurrentSession(sessionHandle)
    requireIdentifier(itemId, "record")
    require(itemJson.toByteArray().size <= MAX_ITEM_BYTES) { "Vault item is too large" }
    val parsed = JSONObject(itemJson)
    require(parsed.getString("id") == itemId) { "Vault item identifier mismatch" }
    val encrypted = rust.encryptItem(sessionHandle.value, itemJson.toByteArray(Charsets.UTF_8), itemId)
    return NativeEncryptedItem(
      encodeCryptoEnvelopeJson(encrypted.encryptedItemKey),
      encodeCryptoEnvelopeJson(encrypted.encryptedPayload),
    )
  }

  override fun decryptItem(
    sessionHandle: VaultSessionHandle,
    encryptedItemKeyJson: String,
    encryptedPayloadJson: String,
    itemId: String,
  ): String {
    requireCurrentSession(sessionHandle)
    requireIdentifier(itemId, "record")
    val plaintext = rust.decryptItem(
      sessionHandle.value,
      decodeCryptoEnvelopeJson(encryptedItemKeyJson),
      decodeCryptoEnvelopeJson(encryptedPayloadJson),
      itemId,
    )
    return try {
      plaintext.toString(Charsets.UTF_8).also { require(JSONObject(it).getString("id") == itemId) }
    } finally {
      plaintext.fill(0)
    }
  }

  override fun generateRecoveryPacket(
    sessionHandle: VaultSessionHandle,
    recoveryCode: String,
  ): String {
    requireCurrentSession(sessionHandle)
    return encodeCryptoEnvelopeJson(rust.generateRecoveryPacket(sessionHandle.value, recoveryCode))
  }

  override fun restoreRecoveryPacket(
    accountId: String,
    recoveryCode: String,
    packetJson: String,
  ): VaultSessionHandle {
    requireIdentifier(accountId, "account")
    // v1 exists only so an already-unlocked account can cross the migration boundary.
    // Unauthenticated recovery must use openRecoveryV2 and its one-time proof.
    sessionForAccount(accountId)
    lockAll()
    return VaultSessionHandle(
      rust.restoreRecoveryPacket(recoveryCode, decodeCryptoEnvelopeJson(packetJson)),
    ).also { registerSession(accountId, it) }
  }

  override fun openRecoveryV2(
    recoveryCode: String,
    packetJson: String,
  ): NativeRecoveryV2Open {
    lockAll()
    val opened = rust.openRecoveryV2(recoveryCode, decodeRecoveryPacketV2Json(packetJson))
    registerBootstrapSession(VaultSessionHandle(opened.sessionHandle))
    synchronized(sessionLock) {
      generationByRecoveryProof[opened.recoveryProofHandle] = currentSessionGeneration()
    }
    return NativeRecoveryV2Open(
      opened.sessionHandle,
      opened.recoveryProofHandle,
      encodeBase64Url(opened.signingPublicKey),
    )
  }

  override fun prepareRecoveryRotation(
    email: String,
    sessionHandle: VaultSessionHandle,
  ): NativeRecoveryV2Rotation {
    validateEmail(email)
    requireCurrentSession(sessionHandle, allowBootstrap = true)
    val accountId = synchronized(sessionLock) { accountBySession[sessionHandle.value] }
    val isRecoveryBootstrap = synchronized(sessionLock) { bootstrapSession == sessionHandle }
    if (!rust.isSessionValid(sessionHandle.value)) {
      throw VaultRepositoryException("VAULT_LOCKED", "Vault is locked")
    }
    if (accountId != null && secureMaterials.accountIdForEmail(email) != accountId) {
      throw VaultRepositoryException("DEVICE_IDENTITY_MISMATCH", "Recovery rotation does not match the local account")
    }
    if (accountId == null && (!isRecoveryBootstrap || !secureMaterials.pendingDeviceMatches(email))) {
      throw VaultRepositoryException("AUTH_REQUIRED", "Recover the vault and prepare the replacement device first")
    }
    if (accountId != null && secureMaterials.isPendingRecoveryBoundTo(email, accountId)) {
      getPendingRecovery(email)?.let {
        return NativeRecoveryV2Rotation(
          it.recoveryCode,
          it.recoveryPacketJson,
          it.recoverySigningPublicKey,
        )
      }
    }
    val recovery = rust.prepareRecoveryRotation(sessionHandle.value)
    val packetJson = encodeRecoveryPacketV2(recovery.encryptedRecoveryPacket)
    val signingPublicKey = encodeBase64Url(recovery.signingPublicKey)
    val codeBytes = recovery.recoveryCode.toByteArray(Charsets.UTF_8)
    val packetBytes = packetJson.toByteArray(Charsets.UTF_8)
    try {
      secureMaterials.putPendingRecovery(
        email,
        keyStore.wrap(secureMaterials.pendingRecoveryAlias(), codeBytes),
        keyStore.wrap(secureMaterials.pendingRecoveryAlias(), packetBytes),
        signingPublicKey,
      )
      if (accountId != null) secureMaterials.bindPendingRecoveryAccount(email, accountId)
    } finally {
      codeBytes.fill(0)
      packetBytes.fill(0)
    }
    return NativeRecoveryV2Rotation(
      recovery.recoveryCode,
      packetJson,
      signingPublicKey,
    )
  }

  override fun signRecoveryFinish(
    recoveryProofHandle: String,
    transcriptBase64Url: String,
  ): String {
    requireIdentifier(recoveryProofHandle, "recovery proof")
    val currentGeneration = currentSessionGeneration()
    if (synchronized(sessionLock) { generationByRecoveryProof[recoveryProofHandle] } != currentGeneration) {
      lockLocalState()
      throw VaultRepositoryException("VAULT_LOCKED", "Recovery authorization has expired")
    }
    val transcript = decodeCanonicalBase64Url(
      transcriptBase64Url,
      MAX_RECOVERY_TRANSCRIPT_BYTES,
    )
    return try {
      encodeBase64Url(rust.signRecoveryFinish(recoveryProofHandle, transcript))
    } finally {
      transcript.fill(0)
    }
  }

  override fun cancelRecovery(
    recoveryProofHandle: String,
    sessionHandle: VaultSessionHandle,
  ) {
    requireIdentifier(recoveryProofHandle, "recovery proof")
    requireIdentifier(sessionHandle.value, "vault session")
    synchronized(sessionLock) {
      if (bootstrapSession == sessionHandle) bootstrapSession = null
      accountBySession.remove(sessionHandle.value)?.let { sessionsByAccount.remove(it) }
      generationBySession.remove(sessionHandle.value)
      generationByRecoveryProof.remove(recoveryProofHandle)
    }
    rust.cancelRecovery(recoveryProofHandle, sessionHandle.value)
  }

  override fun generatePassword(
    length: Int,
    upper: Boolean,
    lower: Boolean,
    digits: Boolean,
    symbols: Boolean,
  ): String = rust.generatePassword(length, upper, lower, digits, symbols)

  override fun generateTotp(secretOrUri: String, timestampSeconds: Long): NativeTotp =
    rust.generateTotp(secretOrUri, timestampSeconds).let { NativeTotp(it.code, it.validForSeconds) }

  private suspend fun savePullConflict(
    accountId: String,
    recordId: String,
    remoteEnvelope: String?,
    serverRevision: Long,
    serverItemRevision: Long?,
    timestamp: String,
  ) {
    val local = database.ciphertexts().get(accountId, recordId)
    database.syncConflicts().upsert(
      SyncConflictEntity(
        accountId,
        recordId,
        "item_revision_advanced",
        local?.ciphertextEnvelopeJson,
        remoteEnvelope,
        serverRevision,
        serverItemRevision,
        "UNRESOLVED",
        timestamp,
      ),
    )
    database.ciphertexts().setConflict(accountId, recordId, true)
  }

  private suspend fun applyRemoteConflict(conflict: SyncConflictEntity) {
    val remote = conflict.remoteCiphertextEnvelopeJson
    if (remote == null) {
      database.ciphertexts().delete(conflict.accountId, conflict.recordId)
      return
    }
    database.ciphertexts().upsert(
      recordFromEnvelope(conflict.accountId, remote, conflict.createdAt).copy(hasConflict = false).toEntity(),
    )
  }

  private fun registerSession(accountId: String, handle: VaultSessionHandle) {
    val generation = currentSessionGeneration()
    synchronized(sessionLock) {
      sessionsByAccount.put(accountId, handle)?.let { old ->
        accountBySession.remove(old.value)
        generationBySession.remove(old.value)
        runCatching { rust.lock(old.value) }
      }
      accountBySession[handle.value] = accountId
      generationBySession[handle.value] = generation
    }
    secureMaterials.setActiveAccount(accountId)
  }

  private fun registerBootstrapSession(handle: VaultSessionHandle) {
    val generation = currentSessionGeneration()
    synchronized(sessionLock) {
      bootstrapSession?.let { old ->
        generationBySession.remove(old.value)
        runCatching { rust.lock(old.value) }
      }
      bootstrapSession = handle
      generationBySession[handle.value] = generation
    }
  }

  private fun pendingRegistrationDevice(email: String): PreparedDevice? {
    if (!secureMaterials.pendingDeviceMatches(email) || !keyStore.contains(secureMaterials.pendingAlias())) return null
    val publicKey = secureMaterials.pendingDevicePublicKey()
    val fingerprint = secureMaterials.pendingDeviceFingerprint()
    val deviceId = secureMaterials.pendingDeviceId()
    val privateKey = secureMaterials.pendingDevicePrivateKey()
    val wrappedCredential = secureMaterials.pendingDeviceCredential()
    if (publicKey == null || fingerprint == null || deviceId == null || privateKey == null || wrappedCredential == null) {
      return null
    }
    val credentialBytes = keyStore.unwrap(secureMaterials.pendingAlias(), wrappedCredential)
    return try {
      val credential = credentialBytes.toString(Charsets.UTF_8)
      require(DEVICE_CREDENTIAL.matches(credential)) { "Pending device credential is invalid" }
      PreparedDevice(deviceId, credential, publicKey, fingerprint)
    } finally {
      credentialBytes.fill(0)
    }
  }

  private fun pendingDeviceForLogin(email: String): PendingLoginDevice {
    if (!secureMaterials.pendingDeviceMatches(email) || !keyStore.contains(secureMaterials.pendingAlias())) {
      secureMaterials.clearPendingDevice()
      keyStore.delete(secureMaterials.pendingAlias())
      return createPendingLoginDevice(email)
    }
    val publicKey = secureMaterials.pendingDevicePublicKey()
    val fingerprint = secureMaterials.pendingDeviceFingerprint()
    val deviceId = secureMaterials.pendingDeviceId()
    val privateKey = secureMaterials.pendingDevicePrivateKey()
    if (publicKey == null || fingerprint == null || deviceId == null || privateKey == null) {
      secureMaterials.clearPendingDevice()
      keyStore.delete(secureMaterials.pendingAlias())
      return createPendingLoginDevice(email)
    }
    val wrappedCredential = secureMaterials.pendingDeviceCredential()
    if (wrappedCredential == null) {
      secureMaterials.clearPendingDevice()
      keyStore.delete(secureMaterials.pendingAlias())
      return createPendingLoginDevice(email)
    }
    val credentialBytes = keyStore.unwrap(secureMaterials.pendingAlias(), wrappedCredential)
    return try {
      val credential = credentialBytes.toString(Charsets.UTF_8)
      require(DEVICE_CREDENTIAL.matches(credential)) { "Pending device credential is invalid" }
      PendingLoginDevice(deviceId, credential, publicKey, fingerprint)
    } finally {
      credentialBytes.fill(0)
    }
  }

  private fun createPendingLoginDevice(email: String): PendingLoginDevice {
    val prepared = prepareDevice(email)
    return PendingLoginDevice(prepared.deviceId, prepared.credential, prepared.publicKey, prepared.fingerprint)
  }

  private fun bindingCredentialBytes(deviceId: String): ByteArray {
    val wrapped = secureMaterials.pendingDeviceCredential()
      ?: throw VaultRepositoryException("DEVICE_CREDENTIAL_MISSING", "Device credential is unavailable")
    if (secureMaterials.pendingDeviceId() != deviceId) {
      throw VaultRepositoryException("DEVICE_IDENTITY_MISMATCH", "Device response does not match registration")
    }
    val stored = keyStore.unwrap(secureMaterials.pendingAlias(), wrapped)
    val storedValue = stored.toString(Charsets.UTF_8)
    if (!DEVICE_CREDENTIAL.matches(storedValue)) {
      stored.fill(0)
      throw VaultRepositoryException("CIPHERTEXT_TAMPERED", "Protected device credential is invalid")
    }
    return stored
  }

  private fun consumeOpaqueAuthorization(email: String, allowed: Set<OpaqueAuthorizationKind>) {
    synchronized(opaqueLock) {
      val authorization = completedOpaqueAuthorization
      completedOpaqueAuthorization = null
      if (authorization == null ||
        SystemClock.elapsedRealtime() - authorization.completedAtMs !in 0L..OPAQUE_AUTHORIZATION_TTL_MS ||
        authorization.email != normalizedEmail(email) ||
        authorization.kind !in allowed
      ) {
        throw VaultRepositoryException("AUTH_REQUIRED", "Complete native authentication again")
      }
    }
  }

  private fun grantOneTimeUnlock(accountId: String) {
    synchronized(sessionLock) {
      unlockGrantsByAccount[accountId] = SystemClock.elapsedRealtime()
    }
  }

  private fun consumeOneTimeUnlock(accountId: String) {
    val issuedAt = synchronized(sessionLock) { unlockGrantsByAccount.remove(accountId) }
    if (issuedAt == null || SystemClock.elapsedRealtime() - issuedAt !in 0L..UNLOCK_GRANT_TTL_MS) {
      throw VaultRepositoryException("AUTH_REQUIRED", "Sign in again before unlocking")
    }
  }

  private fun sessionForAccount(accountId: String): VaultSessionHandle {
    val handle = synchronized(sessionLock) {
      sessionsByAccount[accountId]
        ?: throw VaultRepositoryException("VAULT_LOCKED", "Vault is locked")
    }
    requireCurrentSession(handle)
    return handle
  }

  private fun requireCurrentSession(
    handle: VaultSessionHandle,
    allowBootstrap: Boolean = false,
  ) {
    val generation = currentSessionGeneration()
    val accepted = synchronized(sessionLock) {
      val registered =
        accountBySession.containsKey(handle.value) ||
          (allowBootstrap && bootstrapSession == handle)
      registered &&
        generationBySession[handle.value] == generation &&
        rust.isSessionValid(handle.value)
    }
    if (!accepted) {
      lockLocalState()
      throw VaultRepositoryException("VAULT_LOCKED", "Vault is locked")
    }
  }

  private fun currentSessionGeneration(): Long = try {
    sessionGenerationStore.current()
  } catch (_: Exception) {
    lockLocalState()
    throw VaultRepositoryException("VAULT_LOCKED", "Vault session revocation state is unavailable")
  }

  private fun decryptRecord(handle: VaultSessionHandle, record: CiphertextRecord): String {
    val item = JSONObject(record.ciphertextEnvelopeJson)
    return decryptItem(
      handle,
      item.getJSONObject("encryptedItemKey").toString(),
      item.getJSONObject("encryptedPayload").toString(),
      record.recordId,
    )
  }

  private fun loginMatches(item: JSONObject, target: AutofillTarget): Boolean {
    target.webOrigin?.let { requested ->
      if (normalizedHttpsOrigin(item.optString("origin")) != normalizedHttpsOrigin(requested)) return false
    }
    target.packageName?.let { packageName ->
      val certificate = target.signingCertSha256 ?: return false
      val associations = item.optJSONArray("androidAssociations") ?: JSONArray()
      var match = false
      for (index in 0 until associations.length()) {
        val association = associations.optJSONObject(index) ?: continue
        if (association.optString("packageName") == packageName &&
          association.optString("signingCertificateSha256").uppercase(Locale.ROOT) == certificate.uppercase(Locale.ROOT)
        ) {
          match = true
          break
        }
      }
      if (!match) return false
    }
    return true
  }

  private fun validateAutofillTarget(target: AutofillTarget) {
    require((target.webOrigin != null) xor (target.packageName != null)) { "Exactly one Autofill target is required" }
    target.webOrigin?.let(::normalizedHttpsOrigin)
    target.packageName?.let {
      require(ANDROID_PACKAGE_NAME.matches(it)) { "Android package is invalid" }
      require(SHA256_HEX.matches(target.signingCertSha256.orEmpty())) { "Signing certificate is invalid" }
    }
  }

  private fun normalizedHttpsOrigin(value: String): String {
    val uri = runCatching { URI(value) }.getOrElse { throw IllegalArgumentException("Invalid HTTPS origin") }
    require(uri.scheme?.lowercase(Locale.ROOT) == "https" && !uri.host.isNullOrBlank()) { "HTTPS origin is required" }
    require(uri.userInfo == null && uri.query == null && uri.fragment == null) { "Origin contains unsupported components" }
    val port = if (uri.port == -1 || uri.port == 443) "" else ":${uri.port}"
    return "https://${uri.host.lowercase(Locale.ROOT)}$port"
  }

  private data class OpaqueOperation(val handle: String, val email: String)
  private data class OpaqueAuthorization(
    val email: String,
    val kind: OpaqueAuthorizationKind,
    val completedAtMs: Long,
  )
  private data class PendingLoginDevice(
    val deviceId: String,
    val credential: String,
    val publicKey: String,
    val fingerprint: String,
  )
  private enum class OpaqueAuthorizationKind { LOGIN, REGISTRATION }

  private companion object {
    const val OPAQUE_SERVER_IDENTIFIER = "zero-vault"
    const val MAX_ITEM_BYTES = 1024 * 1024
    const val MAX_RECOVERY_TRANSCRIPT_BYTES = 64 * 1024
    const val OPAQUE_AUTHORIZATION_TTL_MS = 2 * 60 * 1000L
    const val UNLOCK_GRANT_TTL_MS = 2 * 60 * 1000L
    val SECURE_RANDOM = SecureRandom()
    val CONFLICT_RESOLUTIONS = setOf("keep_local", "accept_remote", "create_copy", "skip")
    val DEVICE_CREDENTIAL = Regex("^[A-Za-z0-9_-]{43}$")
  }
}

private fun CiphertextRecord.toEntity() = CiphertextRecordEntity(
  accountId, recordId, ciphertextEnvelopeJson, itemRevision, lastSyncedAt, hasConflict, itemType, isDeleted,
)

private fun CiphertextRecordEntity.toDomain() = CiphertextRecord(
  accountId, recordId, ciphertextEnvelopeJson, itemRevision, lastSyncedAt, hasConflict, itemType, isDeleted,
)

private fun SyncCursor.toEntity() = SyncCursorEntity(accountId, serverRevision, lastSyncedAt, serverCursor, 2)
private fun SyncCursorEntity.toDomain() = SyncCursor(accountId, serverRevision, lastSyncedAt, serverCursor)
private fun PendingMutationEntity.toDomain() = PendingMutation(
  accountId, clientMutationId, recordId, operation, baseItemRevision, ciphertextEnvelopeJson,
  createdAt, attemptCount, lastErrorCode,
)
private fun SyncConflict.toEntity() = SyncConflictEntity(
  accountId, recordId, reason, localCiphertextEnvelopeJson, remoteCiphertextEnvelopeJson,
  serverRevision, serverItemRevision, status, createdAt,
)
private fun SyncConflictEntity.toDomain() = SyncConflict(
  accountId, recordId, reason, localCiphertextEnvelopeJson, remoteCiphertextEnvelopeJson,
  serverRevision, serverItemRevision, status, createdAt,
)

private fun validate(record: CiphertextRecord) {
  requireIdentifier(record.accountId, "account")
  requireIdentifier(record.recordId, "record")
  require(record.ciphertextEnvelopeJson.length <= 1_048_576) { "Ciphertext envelope is too large" }
  requireSafeRevision(record.itemRevision)
  requireTimestamp(record.lastSyncedAt)
  validateCiphertextEnvelope(record)
}

private fun validateCursor(cursor: SyncCursor) {
  requireIdentifier(cursor.accountId, "account")
  requireSafeRevision(cursor.serverRevision)
  cursor.lastSyncedAt?.let(::requireTimestamp)
  requireSafeRevision(cursor.serverCursor)
}

private fun validateConflict(conflict: SyncConflict) {
  requireIdentifier(conflict.accountId, "account")
  requireIdentifier(conflict.recordId, "record")
  require(
    conflict.reason in setOf(
      "invalid_server_revision",
      "item_revision_advanced",
      "item_revision_mismatch",
      "item_owner_mismatch",
      "mutation_id_reused",
    ),
  )
  requireSafeRevision(conflict.serverRevision)
  requireSafeRevision(conflict.serverItemRevision)
  requireTimestamp(conflict.createdAt)
}

private fun validateCiphertextEnvelope(record: CiphertextRecord) {
  try {
    val item = JSONObject(record.ciphertextEnvelopeJson)
    require(item.keys().asSequence().toSet() == ITEM_ENVELOPE_KEYS) { "Ciphertext item contains unsupported fields" }
    require(item.getString("id") == record.recordId) { "Ciphertext item identifier mismatch" }
    require(item.getString("ownerUserId") == record.accountId) { "Ciphertext item owner mismatch" }
    require(item.getLong("revision") == record.itemRevision) { "Ciphertext item revision mismatch" }
    require(item.getString("createdAt").isNotBlank() && item.getString("updatedAt").isNotBlank())
    validateCryptoEnvelope(item.getJSONObject("encryptedItemKey"))
    validateCryptoEnvelope(item.getJSONObject("encryptedPayload"))
    val searchTokens = item.getJSONArray("encryptedSearchTokens")
    for (index in 0 until searchTokens.length()) validateCryptoEnvelope(searchTokens.getJSONObject(index))
  } catch (error: JSONException) {
    throw IllegalArgumentException("Ciphertext envelope has an invalid shape", error)
  }
}

private fun validateCryptoEnvelope(envelope: JSONObject) {
  val keys = envelope.keys().asSequence().toSet()
  require(keys == CRYPTO_ENVELOPE_KEYS || keys == CRYPTO_ENVELOPE_KEYS_WITH_AAD)
  require(envelope.getString("alg") in SUPPORTED_ALGORITHMS)
  decodeBase64Url(envelope.getString("nonce"))
  decodeBase64Url(envelope.getString("ciphertext"))
  if (envelope.has("aad")) decodeBase64Url(envelope.getString("aad"))
}

private fun recordFromEnvelope(accountId: String, envelopeJson: String, timestamp: String): CiphertextRecord {
  val item = JSONObject(envelopeJson)
  return CiphertextRecord(
    accountId = accountId,
    recordId = item.getString("id"),
    ciphertextEnvelopeJson = envelopeJson,
    itemRevision = item.getLong("revision"),
    lastSyncedAt = timestamp,
    hasConflict = false,
  ).also(::validate)
}

private fun encodeCryptoEnvelopeJson(bytes: ByteArray): String {
  require(bytes.size >= 24 + 16) { "Ciphertext envelope is too short" }
  return JSONObject()
    .put("alg", "XCHACHA20_POLY1305")
    .put("nonce", encodeBase64Url(bytes.copyOfRange(0, 24)))
    .put("ciphertext", encodeBase64Url(bytes.copyOfRange(24, bytes.size)))
    .toString()
}

private fun encodeRecoveryPacketV2(rawPacket: ByteArray): String {
  require(rawPacket.size == RECOVERY_V2_PACKET_BYTES) { "Recovery packet is invalid" }
  return JSONObject()
    .put("version", 2)
    .put("alg", "XCHACHA20_POLY1305")
    .put(
      "kdf",
      JSONObject()
        .put("alg", "ARGON2ID_V13")
        .put("salt", encodeBase64Url(rawPacket.copyOfRange(0, 16)))
        .put("memoryKib", 65_536)
        .put("iterations", 3)
        .put("parallelism", 4),
    )
    .put("nonce", encodeBase64Url(rawPacket.copyOfRange(16, 40)))
    .put("ciphertext", encodeBase64Url(rawPacket.copyOfRange(40, rawPacket.size)))
    .toString()
}

private fun decodeRecoveryPacketV2Json(packetJson: String): ByteArray = try {
  require(packetJson.length <= 4_096) { "Recovery packet is too large" }
  val packet = JSONObject(packetJson)
  require(packet.keys().asSequence().toSet() == RECOVERY_V2_PACKET_KEYS) {
    "Recovery packet contains unsupported fields"
  }
  require(packet.getInt("version") == 2) { "Recovery packet version is unsupported" }
  require(packet.getString("alg") == "XCHACHA20_POLY1305") {
    "Recovery packet algorithm is unsupported"
  }
  val kdf = packet.getJSONObject("kdf")
  require(kdf.keys().asSequence().toSet() == RECOVERY_V2_KDF_KEYS) {
    "Recovery KDF contains unsupported fields"
  }
  require(kdf.getString("alg") == "ARGON2ID_V13") { "Recovery KDF is unsupported" }
  require(kdf.getInt("memoryKib") == 65_536 && kdf.getInt("iterations") == 3 && kdf.getInt("parallelism") == 4) {
    "Recovery KDF parameters are unsupported"
  }
  val salt = decodeCanonicalBase64Url(kdf.getString("salt"), 16)
  val nonce = decodeCanonicalBase64Url(packet.getString("nonce"), 24)
  val ciphertext = decodeCanonicalBase64Url(packet.getString("ciphertext"), 81)
  require(salt.size == 16 && nonce.size == 24 && ciphertext.size == 81) {
    "Recovery packet is invalid"
  }
  salt + nonce + ciphertext
} catch (error: JSONException) {
  throw IllegalArgumentException("Recovery packet has an invalid shape", error)
}

private fun encodeDevicePacket(
  recipientDeviceId: String,
  recipientPublicKey: String,
  rawPacket: ByteArray,
): String {
  requireUuid(recipientDeviceId, "recipient device")
  require(decodeBase64Url(recipientPublicKey).size == 32) { "Recipient public key is invalid" }
  require(rawPacket.size == DEVICE_VAULT_KEY_PACKET_BYTES) { "Device vault key packet is invalid" }
  val nonce = rawPacket.copyOfRange(0, 24)
  val ephemeralPublicKey = rawPacket.copyOfRange(24, 56)
  val innerCiphertext = rawPacket.copyOfRange(56, rawPacket.size)
  return JSONObject()
    .put("version", 1)
    .put("recipientDeviceId", recipientDeviceId)
    .put("recipientPublicKey", recipientPublicKey)
    .put("ephemeralPublicKey", encodeBase64Url(ephemeralPublicKey))
    .put(
      "encryptedVaultKey",
      JSONObject()
        .put("alg", "XCHACHA20_POLY1305")
        .put("nonce", encodeBase64Url(nonce))
        .put("ciphertext", encodeBase64Url(innerCiphertext)),
    )
    .toString()
}

private fun decodeDevicePacket(
  packetJson: String,
  expectedDeviceId: String,
  expectedPublicKey: String,
): ByteArray {
  require(packetJson.length <= 16_384) { "Device vault key packet is too large" }
  val packet = JSONObject(packetJson)
  require(packet.keys().asSequence().toSet() == DEVICE_PACKET_KEYS) { "Device packet contains unsupported fields" }
  require(packet.getInt("version") == 1) { "Device packet version is unsupported" }
  require(packet.getString("recipientDeviceId") == expectedDeviceId) { "Device packet recipient mismatch" }
  require(packet.getString("recipientPublicKey") == expectedPublicKey) { "Device packet public key mismatch" }
  require(decodeBase64Url(expectedPublicKey).size == 32) { "Device public key is invalid" }
  val ephemeralPublicKey = decodeBase64Url(packet.getString("ephemeralPublicKey"))
  require(ephemeralPublicKey.size == 32) { "Ephemeral public key is invalid" }
  val encrypted = packet.getJSONObject("encryptedVaultKey")
  require(encrypted.keys().asSequence().toSet() == CRYPTO_ENVELOPE_KEYS) {
    "Encrypted vault key contains unsupported fields"
  }
  require(encrypted.getString("alg") == "XCHACHA20_POLY1305") { "Device packet algorithm is unsupported" }
  val nonce = decodeBase64Url(encrypted.getString("nonce"))
  val innerCiphertext = decodeBase64Url(encrypted.getString("ciphertext"))
  require(nonce.size == 24 && innerCiphertext.size == 48) { "Encrypted vault key is invalid" }
  return nonce + ephemeralPublicKey + innerCiphertext
}

private fun decodeCryptoEnvelopeJson(json: String): ByteArray {
  val envelope = JSONObject(json)
  validateCryptoEnvelope(envelope)
  require(envelope.getString("alg") == "XCHACHA20_POLY1305") { "Unsupported native cipher" }
  val nonce = decodeBase64Url(envelope.getString("nonce"))
  val ciphertext = decodeBase64Url(envelope.getString("ciphertext"))
  require(nonce.size == 24 && ciphertext.size >= 16) { "Ciphertext envelope is invalid" }
  return nonce + ciphertext
}

private fun encodeBase64Url(value: ByteArray): String = Base64.encodeToString(
  value,
  Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
)

private fun decodeBase64Url(value: String): ByteArray {
  require(value.isNotBlank() && value.length <= 2_000_000 && BASE64_URL.matches(value)) { "Invalid base64url value" }
  return runCatching { Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) }
    .getOrElse { throw IllegalArgumentException("Invalid base64url value") }
}

private fun decodeCanonicalBase64Url(value: String, expectedOrMaximumBytes: Int): ByteArray {
  require(
    value.isNotEmpty() &&
      value.length <= ((expectedOrMaximumBytes + 2) / 3) * 4 &&
      BASE64_URL_UNPADDED.matches(value),
  ) { "Invalid canonical base64url value" }
  val decoded = runCatching {
    Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
  }.getOrElse { throw IllegalArgumentException("Invalid canonical base64url value") }
  require(decoded.size <= expectedOrMaximumBytes && encodeBase64Url(decoded) == value) {
    "Invalid canonical base64url value"
  }
  return decoded
}

private fun sha256Hex(value: ByteArray): String = MessageDigest.getInstance("SHA-256")
  .digest(value)
  .joinToString("") { "%02X".format(it) }

private fun validateEmail(value: String) {
  require(value.length in 3..320 && value.count { it == '@' } == 1 && !value.any(Char::isWhitespace)) {
    "Email address is invalid"
  }
}

private fun normalizedEmail(value: String): String = value.trim().lowercase(Locale.ROOT)

private fun requireIdentifier(value: String, name: String) {
  require(value.isNotBlank() && value.length <= 256) { "$name identifier is invalid" }
}

private fun requireUuid(value: String, name: String) {
  require(runCatching { UUID.fromString(value).toString().equals(value, ignoreCase = true) }.getOrDefault(false)) {
    "$name identifier is invalid"
  }
}

private fun requireSafeRevision(value: Long?) {
  require(value == null || value in 0..9_007_199_254_740_991) { "Revision is invalid" }
}

private fun requireTimestamp(value: String) {
  require(value.isNotBlank() && value.length <= 64 && runCatching { Instant.parse(value) }.isSuccess) {
    "Timestamp is invalid"
  }
}

private fun validateImportedVaultItem(item: JSONObject) {
  val type = item.getString("type")
  val allowed = when (type) {
    "login" -> IMPORT_ITEM_BASE_KEYS + setOf("origin", "username", "password", "totp", "androidAssociations")
    "secure_note" -> IMPORT_ITEM_BASE_KEYS + "noteBody"
    "credit_card" -> IMPORT_ITEM_BASE_KEYS + setOf(
      "cardholderName", "cardNumber", "expirationMonth", "expirationYear", "cvv", "brand",
    )
    else -> throw IllegalArgumentException("Backup item type is unsupported")
  }
  require(item.keys().asSequence().all { it in allowed }) {
    "Backup item contains unsupported fields"
  }
  require(IMPORT_ITEM_BASE_KEYS.all(item::has)) { "Backup item is missing required fields" }
  requireUuid(item.getString("id"), "record")
  requireStringLength(item, "title", 2_048)
  requireStringLength(item, "folder", 256)
  requireStringLength(item, "notes", 16_384)
  requireTimestamp(item.getString("createdAt"))
  requireTimestamp(item.getString("updatedAt"))
  val customFields = item.getJSONArray("customFields")
  require(customFields.length() <= 1_000)
  for (index in 0 until customFields.length()) {
    val field = customFields.getJSONObject(index)
    require(field.keys().asSequence().toSet() == IMPORT_CUSTOM_FIELD_KEYS)
    require(field.getString("name").length in 1..256)
    requireStringLength(field, "value", 4_096)
    require(field.getString("fieldType") in setOf("text", "hidden", "boolean"))
  }
  when (type) {
    "login" -> {
      requireStringLength(item, "origin", 4_096)
      requireStringLength(item, "username", 1_024)
      requireStringLength(item, "password", 4_096)
      if (item.has("totp")) requireStringLength(item, "totp", 1_024)
      if (item.has("androidAssociations")) {
        val associations = item.getJSONArray("androidAssociations")
        require(associations.length() <= 32)
        val unique = mutableSetOf<String>()
        for (index in 0 until associations.length()) {
          val association = associations.getJSONObject(index)
          require(association.keys().asSequence().toSet() == IMPORT_ANDROID_ASSOCIATION_KEYS)
          val packageName = association.getString("packageName")
          val certificate = association.getString("signingCertificateSha256")
          require(packageName.length <= 255 && ANDROID_PACKAGE_NAME.matches(packageName))
          require(SHA256_HEX.matches(certificate))
          require(unique.add("$packageName:${certificate.uppercase(Locale.ROOT)}"))
        }
      }
    }
    "secure_note" -> requireStringLength(item, "noteBody", 65_536)
    "credit_card" -> {
      requireStringLength(item, "cardholderName", 256)
      requireStringLength(item, "cardNumber", 32)
      requireStringLength(item, "expirationMonth", 2)
      requireStringLength(item, "expirationYear", 4)
      requireStringLength(item, "cvv", 8)
      requireStringLength(item, "brand", 32)
    }
  }
}

private fun requireStringLength(value: JSONObject, key: String, maximum: Int) {
  require(value.getString(key).length <= maximum) { "Backup item field is too large" }
}

private val ANDROID_PACKAGE_NAME = Regex("^[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+$")
private val SHA256_HEX = Regex("^[A-Fa-f0-9]{64}$")

private val ITEM_ENVELOPE_KEYS = setOf(
  "id", "ownerUserId", "revision", "createdAt", "updatedAt", "encryptedItemKey",
  "encryptedPayload", "encryptedSearchTokens",
)
private val CRYPTO_ENVELOPE_KEYS = setOf("alg", "nonce", "ciphertext")
private val CRYPTO_ENVELOPE_KEYS_WITH_AAD = CRYPTO_ENVELOPE_KEYS + "aad"
private val SUPPORTED_ALGORITHMS = setOf("XCHACHA20_POLY1305", "AES_256_GCM", "HMAC_SHA256")
private const val MAX_CRYPTO_CORE_BACKUP_BYTES = 8 * 1_048_576
private const val MAX_CRYPTO_CORE_BACKUP_ITEMS = 10_000
private val CRYPTO_CORE_BACKUP_KEYS = setOf("schemaVersion", "runtime", "kdf", "cipher", "itemCount", "updatedAt")
private val CRYPTO_CORE_BACKUP_KDF_KEYS = setOf("alg", "memoryKib", "iterations", "parallelism", "salt")
private val CRYPTO_CORE_BACKUP_CIPHER_KEYS = setOf("alg", "nonce", "ciphertext")
private val CRYPTO_CORE_SNAPSHOT_KEYS = setOf("schemaVersion", "createdAt", "updatedAt", "items")
private val IMPORT_ITEM_BASE_KEYS = setOf("id", "type", "title", "folder", "notes", "customFields", "createdAt", "updatedAt")
private val IMPORT_CUSTOM_FIELD_KEYS = setOf("name", "value", "fieldType")
private val IMPORT_ANDROID_ASSOCIATION_KEYS = setOf("packageName", "signingCertificateSha256")
private const val MOBILE_ENCRYPTED_BACKUP_FORMAT = "zero-vault-mobile-encrypted-backup"
private const val MAX_ENCRYPTED_BACKUP_BYTES = 50 * 1_048_576
private const val MAX_ENCRYPTED_BACKUP_PLAINTEXT_BYTES = 32 * 1_048_576
private const val MAX_ENCRYPTED_BACKUP_ITEMS = 100_000
private val MOBILE_ENCRYPTED_BACKUP_KEYS = setOf("format", "version", "createdAt", "items", "pendingMutations", "sync")
private val MOBILE_ENCRYPTED_BACKUP_ENVELOPE_KEYS = setOf("format", "version", "nonce", "ciphertext")
private val MOBILE_ENCRYPTED_BACKUP_ITEM_KEYS = setOf(
  "recordId", "ciphertext", "itemRevision", "lastSyncedAt", "isDeleted",
)
private val MOBILE_ENCRYPTED_BACKUP_MUTATION_KEYS = setOf(
  "clientMutationId", "recordId", "operation", "baseItemRevision", "ciphertext", "createdAt",
)
private val MOBILE_ENCRYPTED_BACKUP_SYNC_KEYS = setOf("serverRevision", "lastSyncedAt", "serverCursor")
private val BASE64_URL = Regex("^[A-Za-z0-9_-]+={0,2}$")
private val BASE64_URL_UNPADDED = Regex("^[A-Za-z0-9_-]+$")
private val DEVICE_PACKET_KEYS = setOf(
  "version",
  "recipientDeviceId",
  "recipientPublicKey",
  "ephemeralPublicKey",
  "encryptedVaultKey",
)
private const val RECOVERY_V2_PACKET_BYTES = 16 + 24 + 81
private const val DEVICE_VAULT_KEY_PACKET_BYTES = 24 + 32 + 48
private val RECOVERY_V2_PACKET_KEYS = setOf("version", "alg", "kdf", "nonce", "ciphertext")
private val RECOVERY_V2_KDF_KEYS = setOf("alg", "salt", "memoryKib", "iterations", "parallelism")

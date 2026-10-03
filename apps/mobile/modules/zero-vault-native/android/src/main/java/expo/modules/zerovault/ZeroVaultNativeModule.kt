package expo.modules.zerovault

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.provider.Settings
import android.view.autofill.AutofillManager
import androidx.biometric.BiometricManager
import androidx.credentials.CredentialManager
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.zerovault.autofill.TargetSecurity
import expo.modules.zerovault.credential.ZeroVaultCredentialProviderService
import java.time.Instant
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class ZeroVaultNativeModule : Module() {
  private var pendingBackupDocument: CompletableDeferred<Uri?>? = null
  private var pendingOpenBackupDocument: CompletableDeferred<Uri?>? = null
  private val backupDocumentMutex = Mutex()

  private val repository: VaultRepository by lazy {
    val context = appContext.reactContext?.applicationContext
      ?: throw CodedException("NATIVE_UNAVAILABLE", "Android application context is unavailable", null)
    VaultRepositoryProvider.get(context)
  }

  private val backupStageStoreDelegate = lazy {
    val context = appContext.reactContext?.applicationContext
      ?: throw CodedException("NATIVE_UNAVAILABLE", "Android application context is unavailable", null)
    NativeBackupStageStore(context)
  }
  private val backupStageStore by backupStageStoreDelegate

  override fun definition() = ModuleDefinition {
    Name("ZeroVaultNative")

    Function("getStatus") {
      try {
        val protocolVersion = repository.protocolVersion()
        val rustReady = protocolVersion >= 2
        val available = OPAQUE_INTEROP_VERIFIED && rustReady
        mapOf(
          "available" to available,
          "code" to when {
            !OPAQUE_INTEROP_VERIFIED -> "OPAQUE_INTEROP_UNVERIFIED"
            !rustReady -> "NATIVE_UNAVAILABLE"
            else -> "READY"
          },
          "room" to true,
          "keystore" to true,
          "rustCrypto" to rustReady,
          "opaqueInteropVerified" to OPAQUE_INTEROP_VERIFIED,
          "protocolVersion" to protocolVersion,
        )
      } catch (_: LinkageError) {
        unavailableNativeStatus()
      } catch (_: Exception) {
        unavailableNativeStatus()
      }
    }

    Function("getAutofillConfiguration") { getAutofillConfiguration() }

    AsyncFunction("openAutofillSettings").Coroutine<Boolean> {
      repositoryCall { openAutofillSettings() }
    }

    AsyncFunction("openCredentialProviderSettings").Coroutine<Boolean> {
      repositoryCall { openCredentialProviderSettings() }
    }

    AsyncFunction("listInstalledApps").Coroutine<List<Map<String, String>>> {
      repositoryCall {
        withContext(Dispatchers.IO) { listInstalledApps() }
      }
    }

    Function("generateUuid") { UUID.randomUUID().toString() }

    Function("copySensitive") { value: String, ttlMs: Long -> copySensitive(value, ttlMs) }

    AsyncFunction("createEncryptedBackup") Coroutine { accountId: String, backupId: String ->
      repositoryCall { repository.createEncryptedBackup(accountId, backupId) }
    }

    AsyncFunction("saveEncryptedBackupDocument") Coroutine { suggestedName: String, json: String ->
      repositoryCall { saveEncryptedBackupDocumentExclusive(suggestedName, json) }
    }

    AsyncFunction("restoreEncryptedBackup") Coroutine { accountId: String, backupId: String, snapshotJson: String ->
      repositoryCall { repository.restoreEncryptedBackup(accountId, backupId, snapshotJson) }
    }

    AsyncFunction("importCryptoCoreBackup") Coroutine {
        accountId: String,
        backupJson: String,
        password: String,
      ->
      repositoryCall {
        mapOf("importedCount" to repository.importCryptoCoreBackup(accountId, backupJson, password))
      }
    }

    AsyncFunction("exportEncryptedBackupDocument") Coroutine { accountId: String ->
      repositoryCall { exportEncryptedBackupDocument(accountId) }
    }

    AsyncFunction("stageBackupDocument") Coroutine { kindValue: String ->
      repositoryCall { stageBackupDocument(kindValue) }
    }

    AsyncFunction("restoreStagedEncryptedBackup") Coroutine { accountId: String, operationId: String ->
      repositoryCall { restoreStagedEncryptedBackup(accountId, operationId) }
    }

    AsyncFunction("importStagedCryptoCoreBackup") Coroutine {
        accountId: String,
        operationId: String,
        password: String,
      ->
      repositoryCall {
        mapOf(
          "importedCount" to importStagedCryptoCoreBackup(accountId, operationId, password),
        )
      }
    }

    AsyncFunction("discardStagedBackup") Coroutine { operationId: String ->
      repositoryCall {
        backupStageStore.discard(operationId)
        Unit
      }
    }

    AsyncFunction("opaqueStartLogin") Coroutine { email: String, password: String ->
      requireOpaqueInterop()
      repositoryCall {
        mapOf("startLoginRequest" to repository.opaqueStartLogin(email, password).request)
      }
    }

    AsyncFunction("opaqueFinishLogin") Coroutine { email: String, loginResponse: String ->
      requireOpaqueInterop()
      repositoryCall {
        mapOf("finishLoginRequest" to repository.opaqueFinishLogin(email, loginResponse))
      }
    }

    Function("opaqueCancelLogin") { repository.opaqueCancelLogin() }

    AsyncFunction("opaqueStartRegistration") Coroutine { email: String, password: String ->
      requireOpaqueInterop()
      repositoryCall {
        mapOf("registrationRequest" to repository.opaqueStartRegistration(email, password).request)
      }
    }

    AsyncFunction("opaqueFinishRegistration") Coroutine { email: String, registrationResponse: String ->
      requireOpaqueInterop()
      repositoryCall {
        repository.opaqueFinishRegistration(email, registrationResponse).let {
          mapOf(
            "registrationRecord" to it.registrationRecord,
            "serverStaticPublicKey" to it.serverStaticPublicKey,
          )
        }
      }
    }

    Function("opaqueCancelRegistration") { repository.opaqueCancelRegistration() }

    AsyncFunction("prepareDevice") Coroutine { email: String ->
      repositoryCall {
        repository.prepareDevice(email).let {
          mapOf(
            "deviceId" to it.deviceId,
            "credential" to it.credential,
            "publicKey" to it.publicKey,
            "fingerprint" to it.fingerprint,
          )
        }
      }
    }

    AsyncFunction("getRecoveryContinuationDevice") Coroutine { email: String ->
      repositoryCall {
        repository.getRecoveryContinuationDevice(email)?.let {
          mapOf(
            "deviceId" to it.deviceId,
            "credential" to it.credential,
            "publicKey" to it.publicKey,
            "fingerprint" to it.fingerprint,
          )
        }
      }
    }

    AsyncFunction("abandonRecoveryContinuation") Coroutine { email: String, deviceId: String ->
      repositoryCall { repository.abandonRecoveryContinuation(email, deviceId) }
    }

    AsyncFunction("bindDevice") Coroutine {
        email: String,
        accountId: String,
        deviceId: String,
      ->
      repositoryCall {
        repository.bindDevice(email, accountId, deviceId).let {
          mapOf("deviceId" to it.deviceId, "publicKey" to it.publicKey, "fingerprint" to it.fingerprint)
        }
      }
    }

    AsyncFunction("prepareDeviceLogin") Coroutine { email: String ->
      repositoryCall {
        repository.prepareDeviceLogin(email).let {
          mapOf(
            "accountId" to it.accountId,
            "deviceId" to it.deviceId,
            "credential" to it.credential,
            "publicKey" to it.publicKey,
            "fingerprint" to it.fingerprint,
          )
        }
      }
    }

    AsyncFunction("completeDeviceLogin") Coroutine { email: String, accountId: String ->
      repositoryCall { repository.completeDeviceLogin(email, accountId) }
    }

    AsyncFunction("resetDeviceLogin") Coroutine { email: String ->
      repositoryCall { repository.resetDeviceLogin(email) }
    }

    AsyncFunction("bootstrapInitialVault") Coroutine { email: String ->
      repositoryCall {
        repository.bootstrapInitialVault(email).let {
          mapOf(
            "sessionHandle" to it.sessionHandle,
            "encryptedVaultKeyPacketJson" to it.encryptedVaultKeyPacketJson,
            "recoveryCode" to it.recoveryCode,
            "recoveryPacketJson" to it.recoveryPacketJson,
            "recoverySigningPublicKey" to it.recoverySigningPublicKey,
          )
        }
      }
    }

    AsyncFunction("getPendingRecovery") Coroutine { email: String ->
      repositoryCall {
        repository.getPendingRecovery(email)?.let {
          mapOf(
            "recoveryCode" to it.recoveryCode,
            "recoveryPacketJson" to it.recoveryPacketJson,
            "recoverySigningPublicKey" to it.recoverySigningPublicKey,
          )
        }
      }
    }

    AsyncFunction("getBoundPendingRecovery") Coroutine { email: String ->
      repositoryCall {
        repository.getBoundPendingRecovery(email)?.let {
          mapOf(
            "recoveryCode" to it.recoveryCode,
            "recoveryPacketJson" to it.recoveryPacketJson,
            "recoverySigningPublicKey" to it.recoverySigningPublicKey,
          )
        }
      }
    }

    AsyncFunction("acknowledgePendingRecovery") Coroutine { email: String ->
      repositoryCall { repository.acknowledgePendingRecovery(email) }
    }

    AsyncFunction("installEncryptedVaultKey") Coroutine { accountId: String, packetJson: String ->
      repositoryCall { repository.installEncryptedVaultKey(accountId, packetJson) }
    }

    AsyncFunction("hasVaultKey") Coroutine { accountId: String ->
      repositoryCall { repository.hasVaultKey(accountId) }
    }

    AsyncFunction("getLocalDeviceSecurityState") Coroutine { accountId: String ->
      repositoryCall {
        val state = repository.getLocalDeviceSecurityState(accountId)
        val unlockState = if (
          state.unlockState == LocalDeviceUnlockState.BIOMETRIC_READY &&
          strongBiometricAvailability() != BiometricManager.BIOMETRIC_SUCCESS
        ) {
          "BIOMETRIC_UNAVAILABLE"
        } else {
          state.unlockState.name
        }
        mapOf(
          "fingerprint" to state.fingerprint,
          "unlockState" to unlockState,
        )
      }
    }

    AsyncFunction("unlockWithDevice") Coroutine { accountId: String ->
      repositoryCall { repository.unlockWithDevice(accountId).value }
    }

    AsyncFunction("enableBiometric") Coroutine { accountId: String ->
      repositoryCall { repository.enableBiometric(requireFragmentActivity(), accountId) }
    }

    AsyncFunction("unlockWithBiometric") Coroutine { accountId: String ->
      repositoryCall { repository.unlockWithBiometric(requireFragmentActivity(), accountId).value }
    }

    AsyncFunction("shareVaultKey") Coroutine {
        sessionHandle: String,
        recipientDeviceId: String,
        recipientPublicKey: String,
      ->
      repositoryCall {
        repository.shareVaultKey(
          VaultSessionHandle(sessionHandle),
          recipientDeviceId,
          recipientPublicKey,
        )
      }
    }

    AsyncFunction("openSession") Coroutine { accountId: String ->
      repositoryCall { repository.openSession(accountId).value }
    }

    AsyncFunction("closeSession") Coroutine { sessionHandle: String ->
      repositoryCall { repository.closeSession(VaultSessionHandle(sessionHandle)) }
    }

    Function("lockAll") { repository.lockAll() }

    AsyncFunction("encryptItem") Coroutine { sessionHandle: String, itemJson: String, itemId: String ->
      repositoryCall {
        repository.encryptItem(VaultSessionHandle(sessionHandle), itemJson, itemId).let {
          mapOf(
            "encryptedItemKeyJson" to it.encryptedItemKeyJson,
            "encryptedPayloadJson" to it.encryptedPayloadJson,
          )
        }
      }
    }

    AsyncFunction("decryptItem") Coroutine {
        sessionHandle: String,
        encryptedItemKeyJson: String,
        encryptedPayloadJson: String,
        itemId: String,
      ->
      repositoryCall {
        repository.decryptItem(
          VaultSessionHandle(sessionHandle),
          encryptedItemKeyJson,
          encryptedPayloadJson,
          itemId,
        )
      }
    }

    AsyncFunction("generateRecoveryPacket") Coroutine { sessionHandle: String, recoveryCode: String ->
      repositoryCall {
        repository.generateRecoveryPacket(VaultSessionHandle(sessionHandle), recoveryCode)
      }
    }

    AsyncFunction("restoreRecoveryPacket") Coroutine {
        accountId: String,
        recoveryCode: String,
        recoveryPacketJson: String,
      ->
      repositoryCall {
        repository.restoreRecoveryPacket(accountId, recoveryCode, recoveryPacketJson).value
      }
    }

    AsyncFunction("openRecoveryV2") Coroutine { recoveryCode: String, recoveryPacketJson: String ->
      repositoryCall {
        repository.openRecoveryV2(recoveryCode, recoveryPacketJson).let {
          mapOf(
            "sessionHandle" to it.sessionHandle,
            "recoveryProofHandle" to it.recoveryProofHandle,
            "signingPublicKey" to it.signingPublicKey,
          )
        }
      }
    }

    AsyncFunction("prepareRecoveryRotation") Coroutine { email: String, sessionHandle: String ->
      repositoryCall {
        repository.prepareRecoveryRotation(email, VaultSessionHandle(sessionHandle)).let {
          mapOf(
            "recoveryCode" to it.recoveryCode,
            "recoveryPacketJson" to it.recoveryPacketJson,
            "signingPublicKey" to it.signingPublicKey,
          )
        }
      }
    }

    AsyncFunction("signRecoveryFinish") Coroutine {
        recoveryProofHandle: String,
        transcriptBase64Url: String,
      ->
      repositoryCall { repository.signRecoveryFinish(recoveryProofHandle, transcriptBase64Url) }
    }

    AsyncFunction("cancelRecovery") Coroutine { recoveryProofHandle: String, sessionHandle: String ->
      repositoryCall {
        repository.cancelRecovery(recoveryProofHandle, VaultSessionHandle(sessionHandle))
      }
    }

    Function("generatePassword") {
        length: Int,
        includeUpper: Boolean,
        includeLower: Boolean,
        includeDigits: Boolean,
        includeSymbols: Boolean,
      ->
      repository.generatePassword(length, includeUpper, includeLower, includeDigits, includeSymbols)
    }

    Function("generateTotp") { secretOrUri: String, timestampSeconds: Long ->
      repository.generateTotp(secretOrUri, timestampSeconds).let {
        mapOf("code" to it.code, "validForSeconds" to it.validForSeconds)
      }
    }

    AsyncFunction("listCiphertexts") Coroutine { accountId: String ->
      repositoryCall { repository.listCiphertexts(accountId).map(CiphertextRecord::toBridge) }
    }

    AsyncFunction("getCiphertext") Coroutine { accountId: String, itemId: String ->
      repositoryCall { repository.getCiphertext(accountId, itemId)?.toBridge() }
    }

    AsyncFunction("upsertCiphertext") Coroutine {
        accountId: String,
        itemId: String,
        ciphertextEnvelopeJson: String,
        itemRevision: Long,
        lastSyncedAt: String,
        hasConflict: Boolean,
      ->
      repositoryCall {
        repository.putCiphertext(
          CiphertextRecord(accountId, itemId, ciphertextEnvelopeJson, itemRevision, lastSyncedAt, hasConflict),
        )
      }
    }

    AsyncFunction("deleteCiphertext") Coroutine { accountId: String, itemId: String ->
      repositoryCall { repository.deleteCiphertext(accountId, itemId) }
    }

    AsyncFunction("getSyncMetadata") Coroutine { accountId: String ->
      repositoryCall {
        repository.getSyncCursor(accountId)?.toBridge()
          ?: mapOf("serverRevision" to 0L, "lastSyncedAt" to null, "serverCursor" to null)
      }
    }

    AsyncFunction("setSyncMetadata") Coroutine {
        accountId: String,
        serverRevision: Long,
        lastSyncedAt: String?,
        serverCursor: Long?,
      ->
      repositoryCall {
        repository.setSyncCursor(SyncCursor(accountId, serverRevision, lastSyncedAt, serverCursor))
      }
    }

    AsyncFunction("setConflictIds") Coroutine { accountId: String, itemIds: List<String> ->
      repositoryCall { repository.setConflictIds(accountId, itemIds) }
    }

    AsyncFunction("clearCiphertexts") Coroutine { accountId: String ->
      repositoryCall { repository.clearCiphertexts(accountId) }
    }

    AsyncFunction("upsertLocalCiphertextAndEnqueue") Coroutine {
        accountId: String,
        itemId: String,
        ciphertextEnvelopeJson: String,
        itemRevision: Long,
        lastSyncedAt: String,
        baseItemRevision: Long?,
        clientMutationId: String,
      ->
      repositoryCall {
        repository.upsertLocalCiphertextAndEnqueue(
          CiphertextRecord(accountId, itemId, ciphertextEnvelopeJson, itemRevision, lastSyncedAt, false),
          baseItemRevision,
          clientMutationId,
        )
      }
    }

    AsyncFunction("deleteLocalAndEnqueue") Coroutine {
        accountId: String,
        itemId: String,
        baseItemRevision: Long?,
        clientMutationId: String,
        createdAt: String,
      ->
      repositoryCall {
        repository.deleteLocalAndEnqueue(accountId, itemId, baseItemRevision, clientMutationId, createdAt)
      }
    }

    AsyncFunction("listPendingMutations") Coroutine { accountId: String ->
      repositoryCall { repository.listPendingMutations(accountId).map(PendingMutation::toBridge) }
    }

    AsyncFunction("ackMutations") Coroutine {
        accountId: String,
        acknowledgementsJson: String,
        serverRevision: Long,
        timestamp: String,
      ->
      repositoryCall {
        repository.ackMutations(
          accountId,
          parseMutationAcknowledgements(acknowledgementsJson),
          serverRevision,
          timestamp,
        )
      }
    }

    AsyncFunction("applyPull") Coroutine {
        accountId: String,
        itemsJson: String,
        deletedItemsJson: String,
        serverRevision: Long,
        cursor: Long,
        timestamp: String,
      ->
      repositoryCall {
        repository.applyPull(
          accountId,
          parseCiphertextRecords(accountId, itemsJson, timestamp),
          parseDeletedItems(deletedItemsJson),
          serverRevision,
          cursor,
          timestamp,
        )
      }
    }

    AsyncFunction("saveConflicts") Coroutine { accountId: String, conflictsJson: String ->
      repositoryCall { repository.saveConflicts(parseConflicts(accountId, conflictsJson)) }
    }

    AsyncFunction("listConflicts") Coroutine { accountId: String ->
      repositoryCall { repository.listConflicts(accountId).map(SyncConflict::toBridge) }
    }

    AsyncFunction("resolveConflict") Coroutine {
        accountId: String,
        itemId: String,
        resolution: String,
        replacementJson: String?,
        clientMutationId: String?,
      ->
      repositoryCall {
        repository.resolveConflict(
          accountId,
          itemId,
          resolution,
          replacementJson?.let { parseCiphertextRecord(accountId, JSONObject(it), InstantString.now()) },
          clientMutationId,
        )
      }
    }

    OnActivityResult { _, payload ->
      val pending = when (payload.requestCode) {
        CREATE_BACKUP_DOCUMENT_REQUEST_CODE -> pendingBackupDocument
        OPEN_BACKUP_DOCUMENT_REQUEST_CODE -> pendingOpenBackupDocument
        else -> null
      }
      if (pending != null && !pending.isCompleted) {
        when {
          payload.resultCode == Activity.RESULT_CANCELED -> pending.complete(null)
          payload.resultCode == Activity.RESULT_OK &&
            payload.data?.data?.scheme == ContentResolver.SCHEME_CONTENT ->
            pending.complete(payload.data?.data)
          else -> pending.completeExceptionally(
            VaultRepositoryException("BACKUP_DOCUMENT_FAILED", "Android did not return a usable backup document"),
          )
        }
      }
    }

    OnActivityDestroys {
      pendingBackupDocument?.cancel()
      pendingBackupDocument = null
      pendingOpenBackupDocument?.cancel()
      pendingOpenBackupDocument = null
      if (backupStageStoreDelegate.isInitialized()) backupStageStore.discardAll()
    }
  }

  private suspend fun exportEncryptedBackupDocument(accountId: String): Map<String, Any> {
    lockBackupDocumentOperation()
    try {
      val backupId = UUID.randomUUID().toString()
      val createdAt = Instant.now().toString()
      val encryptedSnapshot = repository.createEncryptedBackup(accountId, backupId)
      val wrapper = NativeBackupDocumentCodec.encode(
        accountId = accountId,
        backupId = backupId,
        createdAt = createdAt,
        encryptedSnapshot = encryptedSnapshot,
      )
      val suggestedName = "zero-vault-backup-${createdAt.substring(0, 10)}-$backupId.json"
      val saved = saveEncryptedBackupDocument(suggestedName, wrapper)
      return mapOf(
        "saved" to saved,
        "backupId" to backupId,
        "createdAt" to createdAt,
      )
    } finally {
      backupDocumentMutex.unlock()
    }
  }

  private suspend fun stageBackupDocument(kindValue: String): Map<String, Any> {
    val kind = NativeBackupKind.fromBridge(kindValue)
    lockBackupDocumentOperation()
    try {
      if (backupStageStore.hasStagedBackup()) {
        throw VaultRepositoryException("BACKUP_OPERATION_IN_PROGRESS", "Another backup operation is active")
      }
      val uri = openBackupDocument() ?: return mapOf(
        "status" to "cancelled",
        "kind" to kind.bridgeValue,
      )
      var stagedForCleanup: StagedNativeBackup? = null
      try {
        val staged = withContext(Dispatchers.IO) {
          val resolver = appContext.reactContext?.applicationContext?.contentResolver
            ?: throw VaultRepositoryException("NATIVE_UNAVAILABLE", "Android application context is unavailable")
          resolver.openInputStream(uri)?.use { input ->
            backupStageStore.stage(input, kind).also { stagedForCleanup = it }
          } ?: throw VaultRepositoryException("BACKUP_OPEN_FAILED", "Android could not open the backup document")
        }
        return mutableMapOf<String, Any>(
          "status" to "ready",
          "operationId" to staged.operationId,
          "kind" to kind.bridgeValue,
        ).apply {
          staged.metadata?.let {
            put("accountId", it.accountId)
            put("backupId", it.backupId)
            put("createdAt", it.createdAt)
          }
        }
      } catch (error: CancellationException) {
        stagedForCleanup?.operationId?.let(backupStageStore::discard)
        throw error
      }
    } finally {
      backupDocumentMutex.unlock()
    }
  }

  private suspend fun saveEncryptedBackupDocumentExclusive(suggestedName: String, json: String): Boolean {
    lockBackupDocumentOperation()
    try {
      return saveEncryptedBackupDocument(suggestedName, json)
    } finally {
      backupDocumentMutex.unlock()
    }
  }

  private fun lockBackupDocumentOperation() {
    if (!backupDocumentMutex.tryLock()) {
      throw VaultRepositoryException("BACKUP_OPERATION_IN_PROGRESS", "Another backup operation is active")
    }
  }

  private suspend fun restoreStagedEncryptedBackup(accountId: String, operationId: String) {
    val staged = backupStageStore.claim(operationId, NativeBackupKind.ANDROID)
    try {
      val (metadata, encryptedSnapshot) = withContext(Dispatchers.IO) {
        NativeBackupDocumentCodec.encryptedSnapshot(
          staged.file.readText(Charsets.UTF_8),
          accountId,
        )
      }
      repository.restoreEncryptedBackup(accountId, metadata.backupId, encryptedSnapshot)
    } finally {
      staged.file.delete()
    }
  }

  private suspend fun importStagedCryptoCoreBackup(
    accountId: String,
    operationId: String,
    password: String,
  ): Int {
    val staged = backupStageStore.claim(operationId, NativeBackupKind.CRYPTO_CORE)
    try {
      val serialized = withContext(Dispatchers.IO) { staged.file.readText(Charsets.UTF_8) }
      return repository.importCryptoCoreBackup(accountId, serialized, password)
    } finally {
      staged.file.delete()
    }
  }

  private suspend fun saveEncryptedBackupDocument(suggestedName: String, json: String): Boolean {
    if (!BACKUP_FILENAME.matches(suggestedName)) {
      throw VaultRepositoryException("INVALID_ARGUMENT", "Backup filename is invalid")
    }
    val bytes = json.toByteArray(Charsets.UTF_8)
    if (bytes.isEmpty() || bytes.size > MAX_BACKUP_DOCUMENT_BYTES) {
      throw VaultRepositoryException("INVALID_ARGUMENT", "Encrypted backup is empty or too large")
    }

    try {
      val uri = createBackupDocument(suggestedName) ?: return false
      try {
        withContext(Dispatchers.IO) {
          val resolver = appContext.reactContext?.applicationContext?.contentResolver
            ?: throw VaultRepositoryException("NATIVE_UNAVAILABLE", "Android application context is unavailable")
          resolver.openOutputStream(uri, "w")?.use { output ->
            output.write(bytes)
            output.flush()
          } ?: throw VaultRepositoryException("BACKUP_SAVE_FAILED", "Android could not open the backup document")
        }
      } catch (error: Exception) {
        runCatching {
          appContext.reactContext?.applicationContext?.contentResolver?.delete(uri, null, null)
        }
        if (error is CancellationException) throw error
        throw VaultRepositoryException("BACKUP_SAVE_FAILED", "Encrypted backup could not be written")
      }
      return true
    } finally {
      bytes.fill(0)
    }
  }

  @Suppress("DEPRECATION")
  private suspend fun createBackupDocument(suggestedName: String): Uri? =
    withContext(Dispatchers.Main.immediate) {
      if (pendingBackupDocument != null || pendingOpenBackupDocument != null) {
        throw VaultRepositoryException("BACKUP_SAVE_IN_PROGRESS", "Another backup save request is active")
      }
      val activity = requireFragmentActivity()
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = BACKUP_DOCUMENT_MIME_TYPE
        putExtra(Intent.EXTRA_TITLE, suggestedName)
        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      }
      if (intent.resolveActivity(activity.packageManager) == null) {
        throw VaultRepositoryException("BACKUP_DOCUMENT_UNAVAILABLE", "Android document storage is unavailable")
      }

      val pending = CompletableDeferred<Uri?>()
      pendingBackupDocument = pending
      try {
        activity.startActivityForResult(intent, CREATE_BACKUP_DOCUMENT_REQUEST_CODE)
        pending.await()
      } catch (error: CancellationException) {
        throw error
      } catch (error: VaultRepositoryException) {
        throw error
      } catch (_: Exception) {
        throw VaultRepositoryException("BACKUP_DOCUMENT_UNAVAILABLE", "Android document storage is unavailable")
      } finally {
        if (pendingBackupDocument === pending) pendingBackupDocument = null
      }
    }

  @Suppress("DEPRECATION")
  private suspend fun openBackupDocument(): Uri? =
    withContext(Dispatchers.Main.immediate) {
      if (pendingBackupDocument != null || pendingOpenBackupDocument != null) {
        throw VaultRepositoryException("BACKUP_OPERATION_IN_PROGRESS", "Another backup document request is active")
      }
      val activity = requireFragmentActivity()
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = BACKUP_DOCUMENT_MIME_TYPE
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      if (intent.resolveActivity(activity.packageManager) == null) {
        throw VaultRepositoryException("BACKUP_DOCUMENT_UNAVAILABLE", "Android document storage is unavailable")
      }

      val pending = CompletableDeferred<Uri?>()
      pendingOpenBackupDocument = pending
      try {
        activity.startActivityForResult(intent, OPEN_BACKUP_DOCUMENT_REQUEST_CODE)
        pending.await()
      } catch (error: CancellationException) {
        throw error
      } catch (error: VaultRepositoryException) {
        throw error
      } catch (_: Exception) {
        throw VaultRepositoryException("BACKUP_DOCUMENT_UNAVAILABLE", "Android document storage is unavailable")
      } finally {
        if (pendingOpenBackupDocument === pending) pendingOpenBackupDocument = null
      }
    }

  private fun strongBiometricAvailability(): Int {
    val context = appContext.reactContext?.applicationContext
      ?: throw CodedException("NATIVE_UNAVAILABLE", "Android application context is unavailable", null)
    return BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
  }

  private fun requireOpaqueInterop() {
    if (!OPAQUE_INTEROP_VERIFIED) {
      throw CodedException(
        "OPAQUE_INTEROP_UNVERIFIED",
        "Native OPAQUE interoperability has not passed the release gate",
        null,
      )
    }
  }

  private fun requireFragmentActivity(): FragmentActivity =
    appContext.currentActivity as? FragmentActivity
      ?: throw VaultRepositoryException("AUTH_UNAVAILABLE", "Biometric authentication requires an active screen")

  private fun listInstalledApps(): List<Map<String, String>> {
    val context = appContext.reactContext?.applicationContext
      ?: throw VaultRepositoryException("NATIVE_UNAVAILABLE", "Android application context is unavailable")
    val packageManager = context.packageManager
    val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val launchableActivities = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.queryIntentActivities(
        launcherIntent,
        PackageManager.ResolveInfoFlags.of(0L),
      )
    } else {
      @Suppress("DEPRECATION")
      packageManager.queryIntentActivities(launcherIntent, 0)
    }

    val appsByPackage = linkedMapOf<String, InstalledAppAssociation>()
    launchableActivities.forEach { resolveInfo ->
      val activityInfo = resolveInfo.activityInfo ?: return@forEach
      val applicationInfo = activityInfo.applicationInfo ?: return@forEach
      val packageName = applicationInfo.packageName
      if (
        packageName == context.packageName ||
        !activityInfo.enabled ||
        !activityInfo.exported ||
        !applicationInfo.enabled ||
        appsByPackage.containsKey(packageName)
      ) {
        return@forEach
      }
      val certificateSha256 = try {
        TargetSecurity.packageCertificateSha256(context, packageName)
      } catch (_: Exception) {
        null
      } ?: return@forEach
      val loadedLabel = try {
        applicationInfo.loadLabel(packageManager).toString().trim()
      } catch (_: Exception) {
        ""
      }
      val label = loadedLabel.takeIf {
        it.length <= MAX_INSTALLED_APP_LABEL_LENGTH && it.isSafeInstalledAppLabel()
      }
        ?: packageName
      appsByPackage[packageName] = InstalledAppAssociation(
        label = label,
        packageName = packageName,
        signingCertificateSha256 = certificateSha256,
      )
    }

    return appsByPackage.values
      .sortedWith(
        compareBy<InstalledAppAssociation> { it.label.lowercase(Locale.ROOT) }
          .thenBy { it.label }
          .thenBy { it.packageName },
      )
      .map(InstalledAppAssociation::toBridge)
  }

  private fun getAutofillConfiguration(): Map<String, Any> {
    val context = appContext.reactContext?.applicationContext
      ?: return unavailableAutofillConfiguration()
    val autofillManager = context.getSystemService(AutofillManager::class.java)
    val autofillSupported = runCatching { autofillManager?.isAutofillSupported == true }.getOrDefault(false)
    val autofillEnabled = autofillSupported &&
      runCatching { autofillManager?.hasEnabledAutofillServices() == true }.getOrDefault(false)
    val credentialProviderSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
    val credentialProviderEnabled = credentialProviderSupported && credentialProviderEnabled(context)
    return mapOf(
      "availability" to runCatching { repository.autofillStatus().name }
        .getOrDefault(AutofillStatus.UNAVAILABLE.name),
      "autofillSupported" to autofillSupported,
      "autofillEnabled" to autofillEnabled,
      "credentialProviderSupported" to credentialProviderSupported,
      "credentialProviderEnabled" to credentialProviderEnabled,
    )
  }

  private suspend fun openAutofillSettings(): Boolean = withContext(Dispatchers.Main.immediate) {
    if (repository.autofillStatus() == AutofillStatus.UNAVAILABLE) {
      throw VaultRepositoryException("AUTOFILL_UNAVAILABLE", "Autofill requires strong biometric protection")
    }
    val activity = requireFragmentActivity()
    val manager = activity.getSystemService(AutofillManager::class.java)
      ?: throw VaultRepositoryException("AUTOFILL_UNSUPPORTED", "Autofill is unavailable on this device")
    if (!manager.isAutofillSupported) {
      throw VaultRepositoryException("AUTOFILL_UNSUPPORTED", "Autofill is unavailable on this device")
    }
    if (manager.hasEnabledAutofillServices()) return@withContext false
    val intent = Intent(
      Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE,
      Uri.parse("package:${activity.packageName}"),
    )
    if (intent.resolveActivity(activity.packageManager) == null) {
      throw VaultRepositoryException("SETTINGS_UNAVAILABLE", "Autofill settings are unavailable")
    }
    activity.startActivity(intent)
    true
  }

  private suspend fun openCredentialProviderSettings(): Boolean = withContext(Dispatchers.Main.immediate) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      throw VaultRepositoryException(
        "CREDENTIAL_PROVIDER_UNSUPPORTED",
        "Credential Provider requires Android 14 or newer",
      )
    }
    if (repository.autofillStatus() == AutofillStatus.UNAVAILABLE) {
      throw VaultRepositoryException("AUTOFILL_UNAVAILABLE", "Credential Provider requires strong biometric protection")
    }
    val activity = requireFragmentActivity()
    if (credentialProviderEnabled(activity)) return@withContext false
    CredentialManager.create(activity).createSettingsPendingIntent().send()
    true
  }

  private fun credentialProviderEnabled(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return false
    return runCatching {
      val manager = context.getSystemService(android.credentials.CredentialManager::class.java)
        ?: return@runCatching false
      manager.isEnabledCredentialProviderService(
        ComponentName(context, ZeroVaultCredentialProviderService::class.java),
      )
    }.getOrDefault(false)
  }

  private fun unavailableAutofillConfiguration(): Map<String, Any> = mapOf(
    "availability" to AutofillStatus.UNAVAILABLE.name,
    "autofillSupported" to false,
    "autofillEnabled" to false,
    "credentialProviderSupported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE),
    "credentialProviderEnabled" to false,
  )

  private fun unavailableNativeStatus(): Map<String, Any> = mapOf(
    "available" to false,
    "code" to "NATIVE_UNAVAILABLE",
    "room" to false,
    "keystore" to false,
    "rustCrypto" to false,
    "opaqueInteropVerified" to false,
    "protocolVersion" to 0,
  )

  private fun copySensitive(value: String, ttlMs: Long) {
    require(value.isNotEmpty() && value.length <= 65_536) { "Clipboard value is invalid" }
    require(ttlMs in 1_000..60_000) { "Clipboard timeout is invalid" }
    val context = appContext.reactContext?.applicationContext
      ?: throw CodedException("NATIVE_UNAVAILABLE", "Android application context is unavailable", null)
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val marker = "Zero Vault:${UUID.randomUUID()}"
    val clip = ClipData.newPlainText(marker, value)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      clip.description.extras = PersistableBundle().apply {
        putBoolean("android.content.extra.IS_SENSITIVE", true)
      }
    }
    clipboard.setPrimaryClip(clip)
    Handler(Looper.getMainLooper()).postDelayed({
      if (clipboard.primaryClipDescription?.label?.toString() == marker) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          clipboard.clearPrimaryClip()
        } else {
          @Suppress("DEPRECATION")
          clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
        }
      }
    }, ttlMs)
  }

  private suspend fun <T> repositoryCall(block: suspend () -> T): T = try {
    block()
  } catch (error: VaultRepositoryException) {
    throw CodedException(error.code, error.safeMessage, null)
  } catch (error: IllegalArgumentException) {
    throw CodedException("INVALID_ARGUMENT", "Invalid native vault request", null)
  } catch (error: org.json.JSONException) {
    throw CodedException("INVALID_ARGUMENT", "Invalid native vault request", null)
  } catch (error: CancellationException) {
    throw error
  } catch (_: Exception) {
    throw CodedException("NATIVE_FAILURE", "Native vault operation failed", null)
  }

  companion object {
    // Flip only after an actual @serenity-kit/opaque 1.1.0 cross-implementation test passes remotely.
    const val OPAQUE_INTEROP_VERIFIED = true
    private const val BACKUP_DOCUMENT_MIME_TYPE = "application/json"
    private const val MAX_BACKUP_DOCUMENT_BYTES = 52 * 1_048_576
    private const val MAX_INSTALLED_APP_LABEL_LENGTH = 512
    private const val CREATE_BACKUP_DOCUMENT_REQUEST_CODE = 0x5A56
    private const val OPEN_BACKUP_DOCUMENT_REQUEST_CODE = 0x5A57
    private val BACKUP_FILENAME = Regex("""[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.json""")
  }
}

private data class InstalledAppAssociation(
  val label: String,
  val packageName: String,
  val signingCertificateSha256: String,
) {
  fun toBridge(): Map<String, String> = mapOf(
    "label" to label,
    "packageName" to packageName,
    "signingCertificateSha256" to signingCertificateSha256,
  )
}

private fun String.isSafeInstalledAppLabel(): Boolean =
  isNotEmpty() && none { character ->
    Character.isISOControl(character) ||
      character in '\u202A'..'\u202E' ||
      character in '\u2066'..'\u2069'
  }

private fun CiphertextRecord.toBridge() = mapOf(
  "itemId" to recordId,
  "ciphertextEnvelopeJson" to ciphertextEnvelopeJson,
  "itemRevision" to itemRevision,
  "lastSyncedAt" to lastSyncedAt,
  "hasConflict" to hasConflict,
  "itemType" to itemType,
  "isDeleted" to isDeleted,
)

private fun SyncCursor.toBridge() = mapOf(
  "serverRevision" to serverRevision,
  "lastSyncedAt" to lastSyncedAt,
  "serverCursor" to serverCursor,
)

private fun PendingMutation.toBridge() = mapOf(
  "clientMutationId" to clientMutationId,
  "itemId" to recordId,
  "operation" to operation,
  "baseItemRevision" to baseItemRevision,
  "ciphertextEnvelopeJson" to ciphertextEnvelopeJson,
  "createdAt" to createdAt,
  "attemptCount" to attemptCount,
  "lastErrorCode" to lastErrorCode,
)

private fun SyncConflict.toBridge() = mapOf(
  "itemId" to recordId,
  "reason" to reason,
  "localCiphertextEnvelopeJson" to localCiphertextEnvelopeJson,
  "remoteCiphertextEnvelopeJson" to remoteCiphertextEnvelopeJson,
  "serverRevision" to serverRevision,
  "serverItemRevision" to serverItemRevision,
  "status" to status,
  "createdAt" to createdAt,
)

private fun parseCiphertextRecords(accountId: String, json: String, timestamp: String): List<CiphertextRecord> {
  val array = JSONArray(json)
  return List(array.length()) { index -> parseCiphertextRecord(accountId, array.getJSONObject(index), timestamp) }
}

private fun parseDeletedItems(json: String): List<RemoteDeletedItem> {
  val array = JSONArray(json)
  return List(array.length()) { index ->
    val item = array.getJSONObject(index)
    require(item.keys().asSequence().toSet() == setOf("id", "revision", "deletedAt")) {
      "Deleted item contains unsupported fields"
    }
    RemoteDeletedItem(
      recordId = item.getString("id"),
      itemRevision = item.getLong("revision"),
      deletedAt = item.getString("deletedAt"),
    )
  }
}

private fun parseCiphertextRecord(accountId: String, item: JSONObject, timestamp: String): CiphertextRecord =
  CiphertextRecord(
    accountId = accountId,
    recordId = item.getString("id"),
    ciphertextEnvelopeJson = item.toString(),
    itemRevision = item.getLong("revision"),
    lastSyncedAt = timestamp,
    hasConflict = false,
  )

private fun parseConflicts(accountId: String, json: String): List<SyncConflict> {
  val array = JSONArray(json)
  return List(array.length()) { index ->
    val item = array.getJSONObject(index)
    SyncConflict(
      accountId = accountId,
      recordId = item.getString("itemId"),
      reason = item.getString("reason"),
      localCiphertextEnvelopeJson = item.optString("localCiphertextEnvelopeJson").takeIf(String::isNotBlank),
      remoteCiphertextEnvelopeJson = item.optString("remoteCiphertextEnvelopeJson").takeIf(String::isNotBlank),
      serverRevision = item.getLong("serverRevision"),
      serverItemRevision = if (item.has("serverItemRevision") && !item.isNull("serverItemRevision")) {
        item.getLong("serverItemRevision")
      } else null,
      createdAt = item.getString("createdAt"),
    )
  }
}

private fun parseMutationAcknowledgements(json: String): List<MutationAcknowledgement> {
  val array = JSONArray(json)
  return List(array.length()) { index ->
    val item = array.getJSONObject(index)
    require(item.keys().asSequence().toSet() == setOf("clientMutationId", "appliedItemRevision")) {
      "Mutation acknowledgement contains unsupported fields"
    }
    MutationAcknowledgement(
      clientMutationId = item.getString("clientMutationId"),
      appliedItemRevision = item.getLong("appliedItemRevision"),
    )
  }
}

private object InstantString {
  fun now(): String = java.time.Instant.now().toString()
}

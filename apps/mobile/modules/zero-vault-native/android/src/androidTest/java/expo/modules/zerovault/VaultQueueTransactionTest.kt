package expo.modules.zerovault

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VaultQueueTransactionTest {
  private val context: Context = ApplicationProvider.getApplicationContext()
  private lateinit var database: ZeroVaultDatabase
  private lateinit var repository: DefaultVaultRepository

  @Before
  fun setUp() {
    context.deleteDatabase(TEST_DATABASE)
    openRepository()
  }

  @After
  fun tearDown() {
    database.close()
    context.deleteDatabase(TEST_DATABASE)
  }

  @Test
  fun localCreateThenDeleteCompactsOutEvenWithTentativeUiRevision() = runBlocking {
    val mutation = UUID.randomUUID().toString()
    repository.upsertLocalCiphertextAndEnqueue(record(1, "created"), null, mutation)
    repository.deleteLocalAndEnqueue(
      ACCOUNT_ID,
      ITEM_ID,
      1,
      UUID.randomUUID().toString(),
      NOW,
    )

    assertNull(database.ciphertexts().get(ACCOUNT_ID, ITEM_ID))
    assertEquals(emptyList<PendingMutationEntity>(), database.pendingMutations().list(ACCOUNT_ID))
  }

  @Test
  fun repeatedOfflineEditsAndDeleteKeepTheOriginalServerBase() = runBlocking {
    repository.putCiphertext(record(7, "server"))
    repository.upsertLocalCiphertextAndEnqueue(record(8, "first-edit"), 7, UUID.randomUUID().toString())
    repository.upsertLocalCiphertextAndEnqueue(record(9, "second-edit"), 8, UUID.randomUUID().toString())

    val edited = database.pendingMutations().getForRecord(ACCOUNT_ID, ITEM_ID)
    assertEquals("upsert", edited?.operation)
    assertEquals(7L, edited?.baseItemRevision)
    assertEquals(9L, JSONObject(edited?.ciphertextEnvelopeJson!!).getLong("revision"))

    repository.deleteLocalAndEnqueue(
      ACCOUNT_ID,
      ITEM_ID,
      9,
      UUID.randomUUID().toString(),
      NOW,
    )
    val deleted = database.pendingMutations().getForRecord(ACCOUNT_ID, ITEM_ID)
    assertEquals("delete", deleted?.operation)
    assertEquals(7L, deleted?.baseItemRevision)
  }

  @Test
  fun acknowledgedRevisionSurvivesProcessRestartBeforeTheNextEdit() = runBlocking {
    repository.putCiphertext(record(7, "server"))
    val mutation = UUID.randomUUID().toString()
    repository.upsertLocalCiphertextAndEnqueue(record(8, "offline-edit"), 7, mutation)
    repository.ackMutations(
      ACCOUNT_ID,
      listOf(MutationAcknowledgement(mutation, 11)),
      11,
      NOW,
    )

    database.close()
    openRepository()
    val acknowledged = database.ciphertexts().get(ACCOUNT_ID, ITEM_ID)
    assertEquals(11L, acknowledged?.itemRevision)
    assertEquals(11L, JSONObject(acknowledged?.ciphertextEnvelopeJson!!).getLong("revision"))
    assertEquals(emptyList<PendingMutationEntity>(), database.pendingMutations().list(ACCOUNT_ID))

    repository.upsertLocalCiphertextAndEnqueue(record(12, "after-restart"), 11, UUID.randomUUID().toString())
    assertEquals(11L, database.pendingMutations().getForRecord(ACCOUNT_ID, ITEM_ID)?.baseItemRevision)
  }

  @Test
  fun pulledDeleteKeepsLocalTombstoneAndPersistsRemoteItemRevisionOnConflict() = runBlocking {
    repository.putCiphertext(record(7, "server"))
    repository.deleteLocalAndEnqueue(
      ACCOUNT_ID,
      ITEM_ID,
      7,
      UUID.randomUUID().toString(),
      NOW,
    )

    repository.applyPull(
      ACCOUNT_ID,
      emptyList(),
      listOf(RemoteDeletedItem(ITEM_ID, 9, NOW)),
      9,
      1,
      NOW,
    )

    val tombstone = database.ciphertexts().get(ACCOUNT_ID, ITEM_ID)
    assertEquals(true, tombstone?.isDeleted)
    assertEquals(true, tombstone?.hasConflict)
    val conflict = database.syncConflicts().get(ACCOUNT_ID, ITEM_ID)
    assertEquals(9L, conflict?.serverItemRevision)
    assertNull(conflict?.remoteCiphertextEnvelopeJson)
  }

  @Test
  fun pulledDeleteWithoutPendingMutationRemovesTheLocalCiphertext() = runBlocking {
    repository.putCiphertext(record(7, "server"))

    repository.applyPull(
      ACCOUNT_ID,
      emptyList(),
      listOf(RemoteDeletedItem(ITEM_ID, 9, NOW)),
      9,
      1,
      NOW,
    )

    assertNull(database.ciphertexts().get(ACCOUNT_ID, ITEM_ID))
    assertNull(database.syncConflicts().get(ACCOUNT_ID, ITEM_ID))
  }

  private fun openRepository() {
    database = Room.databaseBuilder(context, ZeroVaultDatabase::class.java, TEST_DATABASE)
      .addMigrations(*ZeroVaultDatabase.ALL_MIGRATIONS)
      .build()
    repository = DefaultVaultRepository(
      database,
      UnsupportedRustCrypto(),
      AndroidKeyStore(),
      SecureMaterialStore(context),
      BiometricGate(),
      InMemoryVaultSessionGenerationStore(),
    )
  }

  private fun record(revision: Long, marker: String): CiphertextRecord {
    val crypto = JSONObject()
      .put("alg", "XCHACHA20_POLY1305")
      .put("nonce", "AA")
      .put("ciphertext", marker.encodeToByteArray().let(::base64Url))
    val envelope = JSONObject()
      .put("id", ITEM_ID)
      .put("ownerUserId", ACCOUNT_ID)
      .put("revision", revision)
      .put("createdAt", NOW)
      .put("updatedAt", NOW)
      .put("encryptedItemKey", crypto)
      .put("encryptedPayload", JSONObject(crypto.toString()))
      .put("encryptedSearchTokens", org.json.JSONArray())
      .toString()
    return CiphertextRecord(ACCOUNT_ID, ITEM_ID, envelope, revision, NOW, false)
  }

  private fun base64Url(value: ByteArray): String = android.util.Base64.encodeToString(
    value,
    android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING,
  )

  private companion object {
    const val TEST_DATABASE = "zero-vault-queue-test.db"
    const val ACCOUNT_ID = "11111111-1111-4111-8111-111111111111"
    const val ITEM_ID = "22222222-2222-4222-8222-222222222222"
    val NOW: String = Instant.parse("2026-07-16T00:00:00Z").toString()
  }
}

private class UnsupportedRustCrypto : RustCrypto {
  override fun protocolVersion(): Int = unsupported()
  override fun opaqueStartLogin(password: String, clientIdentifier: String, serverIdentifier: String) = unsupported<RustOpaqueStart>()
  override fun opaqueFinishLogin(stateHandle: String, response: String) = unsupported<String>()
  override fun opaqueStartRegistration(password: String, clientIdentifier: String, serverIdentifier: String) = unsupported<RustOpaqueStart>()
  override fun opaqueFinishRegistration(stateHandle: String, response: String) = unsupported<RustOpaqueRegistrationFinish>()
  override fun opaqueCancel(stateHandle: String) = unsupported<Unit>()
  override fun generateDeviceKeyPair() = unsupported<RustDeviceKeyPair>()
  override fun createVaultForDevice(devicePublicKey: ByteArray) = unsupported<RustNewVault>()
  override fun shareVaultKey(sessionHandle: String, devicePublicKey: ByteArray) = unsupported<ByteArray>()
  override fun unlockWithPassword(password: String, salt: ByteArray, memoryKiB: Int, iterations: Int, parallelism: Int) = unsupported<String>()
  override fun openDeviceVault(devicePrivateKey: ByteArray, encryptedVaultKey: ByteArray) = unsupported<String>()
  override fun encryptItem(sessionHandle: String, plaintext: ByteArray, itemId: String) = unsupported<RustEncryptedItem>()
  override fun decryptItem(sessionHandle: String, encryptedItemKey: ByteArray, encryptedPayload: ByteArray, itemId: String) = unsupported<ByteArray>()
  override fun encryptBackup(sessionHandle: String, accountId: String, backupId: String, plaintext: ByteArray) = unsupported<ByteArray>()
  override fun decryptBackup(sessionHandle: String, accountId: String, backupId: String, encryptedBackup: ByteArray) = unsupported<ByteArray>()
  override fun decryptCryptoCoreBackup(
    password: String,
    salt: ByteArray,
    memoryKiB: Int,
    iterations: Int,
    parallelism: Int,
    encryptedSnapshot: ByteArray,
  ) = unsupported<ByteArray>()
  override fun generateRecoveryCode() = unsupported<String>()
  override fun generateRecoveryPacket(sessionHandle: String, recoveryCode: String) = unsupported<ByteArray>()
  override fun restoreRecoveryPacket(recoveryCode: String, packet: ByteArray) = unsupported<String>()
  override fun openRecoveryV2(recoveryCode: String, packet: ByteArray) = unsupported<RustRecoveryV2Open>()
  override fun prepareRecoveryRotation(sessionHandle: String) = unsupported<RustRecoveryV2Rotation>()
  override fun signRecoveryFinish(recoveryProofHandle: String, transcript: ByteArray) = unsupported<ByteArray>()
  override fun discardRecoveryProof(recoveryProofHandle: String) = unsupported<Unit>()
  override fun cancelRecovery(recoveryProofHandle: String, sessionHandle: String) = unsupported<Unit>()
  override fun isSessionValid(sessionHandle: String) = unsupported<Boolean>()
  override fun lock(sessionHandle: String) = unsupported<Unit>()
  override fun lockAll() = unsupported<Unit>()
  override fun generatePassword(length: Int, upper: Boolean, lower: Boolean, digits: Boolean, symbols: Boolean) = unsupported<String>()
  override fun generateTotp(secretOrUri: String, timestampSeconds: Long) = unsupported<RustTotp>()

  private fun <T> unsupported(): T = error("Rust crypto is outside this Room transaction test")
}

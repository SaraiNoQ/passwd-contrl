package expo.modules.zerovault

import android.util.Base64
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DeviceRegistrationInstrumentedTest {
  @Test
  fun pendingRegistrationReusesTheServerCredentialEncoding() {
    val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    val database = Room.inMemoryDatabaseBuilder(context, ZeroVaultDatabase::class.java).build()
    val keyStore = AndroidKeyStore()
    val secureMaterials = SecureMaterialStore(context)
    val repository = DefaultVaultRepository(
      database,
      UniFfiRustCrypto(),
      keyStore,
      secureMaterials,
      BiometricGate(),
      InMemoryVaultSessionGenerationStore(),
    )
    val email = "registration-credential@example.invalid"

    secureMaterials.clearPendingDevice()
    keyStore.delete(secureMaterials.pendingAlias())
    try {
      val prepared = repository.prepareDevice(email)
      val restored = repository.prepareDevice(email)
      assertEquals(43, prepared.credential.length)
      assertEquals(prepared, restored)
    } finally {
      repository.lockAll()
      secureMaterials.clearPendingDevice()
      keyStore.delete(secureMaterials.pendingAlias())
      database.close()
    }
  }

  @Test
  fun recoveryBootstrapSharesOnlyWithItsPreparedReplacementDevice() = runBlocking {
    val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    val database = Room.inMemoryDatabaseBuilder(context, ZeroVaultDatabase::class.java).build()
    val keyStore = AndroidKeyStore()
    val secureMaterials = SecureMaterialStore(context)
    val repository = DefaultVaultRepository(
      database,
      UniFfiRustCrypto(),
      keyStore,
      secureMaterials,
      BiometricGate(),
      InMemoryVaultSessionGenerationStore(),
    )
    val email = "recovery-bootstrap@example.invalid"

    secureMaterials.clearPendingDevice()
    secureMaterials.clearPendingRecovery(email)
    keyStore.delete(secureMaterials.pendingAlias())
    keyStore.delete(secureMaterials.pendingRecoveryAlias())
    try {
      val prepared = repository.prepareDevice(email)
      val initial = repository.bootstrapInitialVault(email)
      repository.lockAll()
      val opened = repository.openRecoveryV2(initial.recoveryCode, initial.recoveryPacketJson)
      val packet = repository.shareVaultKey(
        VaultSessionHandle(opened.sessionHandle),
        prepared.deviceId,
        prepared.publicKey,
      )
      val packetJson = JSONObject(packet)
      assertEquals(prepared.deviceId, packetJson.getString("recipientDeviceId"))
      assertEquals(prepared.publicKey, packetJson.getString("recipientPublicKey"))

      val wrongDeviceError = try {
        repository.shareVaultKey(
          VaultSessionHandle(opened.sessionHandle),
          "11111111-1111-4111-8111-111111111111",
          prepared.publicKey,
        )
        null
      } catch (caught: VaultRepositoryException) {
        caught
      }
      assertEquals("DEVICE_IDENTITY_MISMATCH", wrongDeviceError?.code)

      val wrongPublicKey = Base64.encodeToString(
        ByteArray(32) { 0x5A.toByte() },
        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
      )
      val wrongKeyError = try {
        repository.shareVaultKey(
          VaultSessionHandle(opened.sessionHandle),
          prepared.deviceId,
          wrongPublicKey,
        )
        null
      } catch (caught: VaultRepositoryException) {
        caught
      }
      assertEquals("DEVICE_IDENTITY_MISMATCH", wrongKeyError?.code)

      repository.cancelRecovery(
        opened.recoveryProofHandle,
        VaultSessionHandle(opened.sessionHandle),
      )
      val cancelledError = try {
        repository.shareVaultKey(
          VaultSessionHandle(opened.sessionHandle),
          prepared.deviceId,
          prepared.publicKey,
        )
        null
      } catch (caught: VaultRepositoryException) {
        caught
      }
      assertEquals("VAULT_LOCKED", cancelledError?.code)
    } finally {
      repository.lockAll()
      secureMaterials.clearPendingDevice()
      secureMaterials.clearPendingRecovery(email)
      keyStore.delete(secureMaterials.pendingAlias())
      keyStore.delete(secureMaterials.pendingRecoveryAlias())
      database.close()
    }
  }
}

package expo.modules.zerovault

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BiometricSecurityStateInstrumentedTest {
  @Test
  fun missingBiometricAliasStaysFailClosedAndRequiresRecovery() = runBlocking {
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
    val accountId = "biometric-invalidated-test-account"
    val biometricAlias = secureMaterials.biometricAlias(accountId)

    database.deviceState().upsert(
      DeviceStateEntity(
        accountId = accountId,
        deviceId = "00000000-0000-4000-8000-000000000091",
        publicKey = "AA",
        fingerprint = "11".repeat(32),
        encryptedVaultKey = null,
        createdAt = Instant.EPOCH.toString(),
      ),
    )
    secureMaterials.putDevicePrivateKey(
      accountId,
      WrappedSecret(ByteArray(12) { 1 }, ByteArray(16) { 2 }),
      biometric = true,
    )
    secureMaterials.setBiometricRequired(accountId, true)
    keyStore.delete(biometricAlias)

    try {
      val state = repository.getLocalDeviceSecurityState(accountId)
      assertEquals(LocalDeviceUnlockState.BIOMETRIC_INVALIDATED, state.unlockState)
      assertEquals("11".repeat(32), state.fingerprint)
      assertNull(secureMaterials.getDevicePrivateKey(accountId, biometric = true))
      assertFalse(keyStore.contains(biometricAlias))

      try {
        repository.unlockWithDevice(accountId)
        fail("Password/device unlock must not bypass an invalidated biometric policy")
      } catch (error: VaultRepositoryException) {
        assertEquals("BIOMETRIC_REQUIRED", error.code)
      }
    } finally {
      repository.lockAll()
      secureMaterials.deleteAccount(accountId)
      keyStore.delete(secureMaterials.wrappingAlias(accountId))
      keyStore.delete(biometricAlias)
      database.close()
    }
  }
}

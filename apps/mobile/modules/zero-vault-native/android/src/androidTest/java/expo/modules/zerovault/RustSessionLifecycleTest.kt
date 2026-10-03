package expo.modules.zerovault

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RustSessionLifecycleTest {
  @Test
  fun lockAllInvalidatesEveryOpaqueVaultHandle() {
    val rust = UniFfiRustCrypto()
    val handle = rust.unlockWithPassword("test password", ByteArray(16) { 7 }, 8192, 1, 1)
    assertTrue(rust.isSessionValid(handle))
    rust.lockAll()
    assertFalse(rust.isSessionValid(handle))
  }

  @Test
  fun recoveryV2ProofIsOneTimeAndBoundToTheRecoveredSession() {
    val rust = UniFfiRustCrypto()
    val device = rust.generateDeviceKeyPair()
    val vault = rust.createVaultForDevice(device.publicKey)
    device.privateKey.fill(0)
    val rotation = rust.prepareRecoveryRotation(vault.sessionHandle)
    val opened = rust.openRecoveryV2(rotation.recoveryCode, rotation.encryptedRecoveryPacket)
    assertEquals(32, opened.signingPublicKey.size)
    val transcript = "zero-vault/recovery-finish/v2\u0000instrumented".toByteArray()
    assertEquals(64, rust.signRecoveryFinish(opened.recoveryProofHandle, transcript).size)
    try {
      rust.signRecoveryFinish(opened.recoveryProofHandle, transcript)
      throw AssertionError("Expected recovery proof reuse to fail closed")
    } catch (error: VaultRepositoryException) {
      assertEquals("RECOVERY_AUTH_EXPIRED", error.code)
    } finally {
      rust.lockAll()
    }
  }

  @Test
  fun encryptedBackupRejectsTamperAndCrossObjectReplay() {
    val rust = UniFfiRustCrypto()
    val device = rust.generateDeviceKeyPair()
    val vault = rust.createVaultForDevice(device.publicKey)
    device.privateKey.fill(0)
    val accountId = "11111111-1111-4111-8111-111111111111"
    val backupId = "22222222-2222-4222-8222-222222222222"
    val plaintext = "ciphertext snapshot metadata".toByteArray()
    val encrypted = rust.encryptBackup(vault.sessionHandle, accountId, backupId, plaintext)
    assertEquals(
      plaintext.toList(),
      rust.decryptBackup(vault.sessionHandle, accountId, backupId, encrypted).toList(),
    )

    val tampered = encrypted.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
    expectBackupAuthenticationFailure {
      rust.decryptBackup(vault.sessionHandle, accountId, backupId, tampered)
    }
    expectBackupAuthenticationFailure {
      rust.decryptBackup(
        vault.sessionHandle,
        accountId,
        "33333333-3333-4333-8333-333333333333",
        encrypted,
      )
    }
    expectBackupAuthenticationFailure {
      rust.decryptBackup(
        vault.sessionHandle,
        "44444444-4444-4444-8444-444444444444",
        backupId,
        encrypted,
      )
    }
    plaintext.fill(0)
    rust.lockAll()
  }

  private fun expectBackupAuthenticationFailure(operation: () -> Unit) {
    try {
      operation()
      throw AssertionError("Expected authenticated backup verification to fail closed")
    } catch (_: VaultRepositoryException) {
      // Expected stable native error mapping; plaintext is never returned.
    }
  }
}

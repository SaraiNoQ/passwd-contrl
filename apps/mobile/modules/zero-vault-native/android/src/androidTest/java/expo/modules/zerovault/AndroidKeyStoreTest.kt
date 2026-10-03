package expo.modules.zerovault

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.UUID
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidKeyStoreTest {
  @Test
  fun wrappedDeviceMaterialRoundTripsAndDeletionInvalidatesIt() {
    val keyStore = AndroidKeyStore()
    val alias = AndroidKeyStore.WRAP_ALIAS_PREFIX + UUID.randomUUID()
    val plaintext = ByteArray(32) { it.toByte() }
    try {
      val wrapped = keyStore.wrap(alias, plaintext)
      assertArrayEquals(plaintext, keyStore.unwrap(alias, wrapped))
      keyStore.delete(alias)
      try {
        keyStore.unwrap(alias, wrapped)
        throw AssertionError("Expected deleted key to fail closed")
      } catch (error: VaultRepositoryException) {
        assertEquals("KEY_INVALIDATED", error.code)
      }
    } finally {
      plaintext.fill(0)
      keyStore.delete(alias)
    }
  }

  @Test
  fun tamperedWrappedMaterialFailsAuthentication() {
    val keyStore = AndroidKeyStore()
    val alias = AndroidKeyStore.WRAP_ALIAS_PREFIX + UUID.randomUUID()
    try {
      val wrapped = keyStore.wrap(alias, ByteArray(32) { 3 })
      wrapped.ciphertext[0] = (wrapped.ciphertext[0].toInt() xor 1).toByte()
      try {
        keyStore.unwrap(alias, wrapped)
        throw AssertionError("Expected tamper rejection")
      } catch (error: VaultRepositoryException) {
        assertEquals("CIPHERTEXT_TAMPERED", error.code)
      }
    } finally {
      keyStore.delete(alias)
    }
  }
}

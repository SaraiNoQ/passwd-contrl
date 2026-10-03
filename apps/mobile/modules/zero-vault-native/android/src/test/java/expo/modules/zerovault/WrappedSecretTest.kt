package expo.modules.zerovault

import org.junit.Assert.assertArrayEquals
import org.junit.Test

class WrappedSecretTest {
  @Test
  fun encodedSecretRoundTrips() {
    val original = WrappedSecret(ByteArray(12) { it.toByte() }, ByteArray(32) { (it + 7).toByte() })
    val decoded = WrappedSecret.decode(original.encode())
    assertArrayEquals(original.iv, decoded.iv)
    assertArrayEquals(original.ciphertext, decoded.ciphertext)
  }

  @Test(expected = IllegalArgumentException::class)
  fun truncatedSecretFailsClosed() {
    WrappedSecret.decode(byteArrayOf(1, 12, 3))
  }
}

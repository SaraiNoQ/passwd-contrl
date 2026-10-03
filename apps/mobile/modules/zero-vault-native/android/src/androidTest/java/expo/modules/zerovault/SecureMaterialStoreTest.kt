package expo.modules.zerovault

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecureMaterialStoreTest {
  private val context: Context = ApplicationProvider.getApplicationContext()
  private lateinit var store: SecureMaterialStore

  @Before
  fun setUp() {
    clearPreferences()
    store = SecureMaterialStore(context)
  }

  @After
  fun tearDown() {
    clearPreferences()
  }

  @Test
  fun emailBindingIsNormalizedAndSelectsTheMatchingAccount() {
    store.bindEmail("Alice@Example.COM", "account-alice")
    store.bindEmail("bob@example.com", "account-bob")

    assertEquals("account-alice", store.accountIdForEmail("alice@example.com"))
    assertEquals("account-bob", store.accountIdForEmail("BOB@EXAMPLE.COM"))
    assertNull(store.accountIdForEmail("carol@example.com"))
  }

  @Test
  fun rebindingAndDeletingRemoveStaleLookups() {
    store.bindEmail("alice@example.com", "account-old")
    store.bindEmail("alice@example.com", "account-new")
    store.deleteAccount("account-new")

    assertNull(store.accountIdForEmail("alice@example.com"))
  }

  @Test
  fun pendingRecoveryPersistsPacketAndSigningKeyAtomically() {
    val wrappedCode = WrappedSecret(ByteArray(12) { 1 }, ByteArray(16) { 2 })
    val wrappedPacket = WrappedSecret(ByteArray(12) { 3 }, ByteArray(16) { 4 })
    val signingPublicKey = "A".repeat(43)
    store.putPendingRecovery(
      "alice@example.com",
      wrappedCode,
      wrappedPacket,
      signingPublicKey,
    )

    assertNotNull(store.pendingRecoveryCode())
    assertNotNull(store.pendingRecoveryPacket())
    assertEquals(signingPublicKey, store.pendingRecoverySigningPublicKey())
    store.bindPendingRecoveryAccount("alice@example.com", "account-old")
    assertTrue(store.isPendingRecoveryBoundTo("alice@example.com", "account-old"))

    store.putPendingRecovery(
      "alice@example.com",
      wrappedCode,
      wrappedPacket,
      signingPublicKey,
    )
    assertFalse(store.isPendingRecoveryBound("alice@example.com"))
    assertFalse(store.isPendingRecoveryBoundTo("alice@example.com", "account-old"))

    store.clearPendingRecovery("alice@example.com")
    assertNull(store.pendingRecoverySigningPublicKey())
  }

  @Test
  fun accountScopedRecoveryCleanupDoesNotClearAnotherAccount() {
    val wrapped = WrappedSecret(ByteArray(12) { 1 }, ByteArray(16) { 2 })
    store.putPendingRecovery("alice@example.com", wrapped, wrapped, "A".repeat(43))
    store.bindPendingRecoveryAccount("alice@example.com", "account-alice")
    assertTrue(store.isPendingRecoveryBoundToAccount("account-alice"))

    assertFalse(store.clearPendingRecoveryForAccount("account-bob"))
    assertNotNull(store.pendingRecoveryCode())

    assertTrue(store.clearPendingRecoveryForAccount("account-alice"))
    assertNull(store.pendingRecoveryCode())
    assertNull(store.pendingRecoveryPacket())
    assertNull(store.pendingRecoverySigningPublicKey())
  }

  private fun clearPreferences() {
    context.getSharedPreferences(SecureMaterialStore.PREFERENCES_NAME, Context.MODE_PRIVATE)
      .edit()
      .clear()
      .commit()
  }
}

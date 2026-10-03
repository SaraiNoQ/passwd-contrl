package expo.modules.zerovault.autofill

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AutofillSecurityInstrumentedTest {
  private val context: Context = ApplicationProvider.getApplicationContext()

  @Test
  fun normalizesOnlyExactHttpsOrigins() {
    assertEquals("https://xn--bcher-kva.example", TargetSecurity.normalizeHttpsOrigin("https://BÜCHER.example/"))
    assertEquals("https://example.com:8443", TargetSecurity.normalizeHttpsOrigin("https://EXAMPLE.com:8443"))
    assertNull(TargetSecurity.normalizeHttpsOrigin("http://example.com"))
    assertNull(TargetSecurity.normalizeHttpsOrigin("https://user@example.com"))
    assertNull(TargetSecurity.normalizeHttpsOrigin("https://example.com/login"))
    assertNull(TargetSecurity.normalizeHttpsOrigin("https://example.com?next=login"))
  }

  @Test
  fun signingFingerprintRejectsMultipleCurrentSigners() {
    val first = Signature(byteArrayOf(1, 2, 3))
    val second = Signature(byteArrayOf(4, 5, 6))
    val fingerprint = TargetSecurity.certificateSha256(arrayOf(first))
    assertNotNull(fingerprint)
    assertEquals(64, fingerprint!!.length)
    assertNotEquals(fingerprint, TargetSecurity.certificateSha256(arrayOf(second)))
    assertNull(TargetSecurity.certificateSha256(arrayOf(first, second)))
  }

  @Test
  fun autofillComponentsAreRegisteredWithoutBroadPackageVisibility() {
    assertEquals(
      PackageManager.PERMISSION_DENIED,
      context.packageManager.checkPermission(
        "android.permission.QUERY_ALL_PACKAGES",
        context.packageName,
      ),
    )
    val service = context.packageManager.getServiceInfo(
      ComponentName(context.packageName, "expo.modules.zerovault.autofill.ZeroVaultAutofillService"),
      PackageManager.GET_META_DATA,
    )
    assertTrue(service.exported)
    assertEquals("android.permission.BIND_AUTOFILL_SERVICE", service.permission)
    assertEquals("${context.packageName}:vault_system", service.processName)
    assertNotNull(service.metaData)
    assertTrue(service.metaData.getInt("android.autofill") != 0)

    val activity = context.packageManager.getActivityInfo(
      ComponentName(context.packageName, "expo.modules.zerovault.autofill.ZeroVaultAutofillAuthActivity"),
      0,
    )
    assertFalse(activity.exported)
    assertEquals("${context.packageName}:vault_system", activity.processName)
  }
}

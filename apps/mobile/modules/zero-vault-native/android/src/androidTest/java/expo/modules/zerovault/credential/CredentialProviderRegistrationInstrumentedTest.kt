package expo.modules.zerovault.credential

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CredentialProviderRegistrationInstrumentedTest {
  private val context: Context = ApplicationProvider.getApplicationContext()

  @Test
  fun passwordProviderAndSecureActivityAreRegisteredOnApi34() {
    assumeTrue(Build.VERSION.SDK_INT >= 34)
    val service = context.packageManager.getServiceInfo(
      ComponentName(
        context.packageName,
        "expo.modules.zerovault.credential.ZeroVaultCredentialProviderService",
      ),
      PackageManager.GET_META_DATA,
    )
    assertTrue(service.exported)
    assertEquals("android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE", service.permission)
    assertEquals("${context.packageName}:vault_system", service.processName)
    assertNotNull(service.metaData)
    assertTrue(service.metaData.getInt("android.credentials.provider") != 0)

    val activity = context.packageManager.getActivityInfo(
      ComponentName(
        context.packageName,
        "expo.modules.zerovault.credential.ZeroVaultCredentialActivity",
      ),
      0,
    )
    assertFalse(activity.exported)
    assertEquals("${context.packageName}:vault_system", activity.processName)
  }
}

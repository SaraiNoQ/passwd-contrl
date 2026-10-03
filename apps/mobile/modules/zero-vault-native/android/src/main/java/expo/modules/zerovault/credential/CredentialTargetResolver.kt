package expo.modules.zerovault.credential

import android.content.Context
import androidx.credentials.provider.CallingAppInfo
import expo.modules.zerovault.AutofillTarget
import expo.modules.zerovault.autofill.TargetSecurity

object CredentialTargetResolver {
  fun resolve(context: Context, callingAppInfo: CallingAppInfo?): AutofillTarget? {
    val caller = callingAppInfo ?: return null
    val target = if (caller.isOriginPopulated()) {
      val origin = try {
        caller.getOrigin(TargetSecurity.loadPrivilegedCallerAllowlist(context))
      } catch (_: Exception) {
        null
      } ?: return null
      val normalizedOrigin = TargetSecurity.normalizeHttpsOrigin(origin) ?: return null
      AutofillTarget(webOrigin = normalizedOrigin)
    } else {
      val certificate = TargetSecurity.certificateSha256(
        caller.signingInfo.apkContentsSigners,
      ) ?: return null
      AutofillTarget(
        packageName = caller.packageName,
        signingCertSha256 = certificate,
      )
    }
    return target.takeIf { TargetSecurity.canonicalKey(it) != null }
  }
}


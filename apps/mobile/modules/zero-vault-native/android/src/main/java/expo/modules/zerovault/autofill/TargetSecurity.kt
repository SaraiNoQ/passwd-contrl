package expo.modules.zerovault.autofill

import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import expo.modules.zerovault.AutofillTarget
import org.json.JSONObject
import java.net.IDN
import java.net.URI
import java.security.MessageDigest
import java.util.Locale

/** Security-sensitive target normalization shared by Autofill and Credential Provider. */
object TargetSecurity {
  private val SHA256_PATTERN = Regex("^[0-9A-F]{64}$")
  private val PACKAGE_PATTERN = Regex("^[A-Za-z][A-Za-z0-9_.]{1,254}$")

  fun normalizeHttpsOrigin(rawOrigin: String): String? {
    val uri = try {
      URI(rawOrigin.trim())
    } catch (_: Exception) {
      return null
    }
    if (!uri.scheme.equals("https", ignoreCase = true)) return null
    if (uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null) return null
    if (uri.rawPath !in listOf(null, "", "/")) return null
    val authority = uri.rawAuthority?.takeIf(String::isNotBlank) ?: return null
    if ('@' in authority || authority.startsWith('[')) return null
    val lastColon = authority.lastIndexOf(':')
    val hasPort = lastColon > 0
    val rawHost = if (hasPort) authority.substring(0, lastColon) else authority
    val port = if (hasPort) authority.substring(lastColon + 1).toIntOrNull() ?: return null else -1
    if (port != -1 && port !in 1..65_535) return null

    val host = try {
      IDN.toASCII(rawHost.trimEnd('.'), IDN.USE_STD3_ASCII_RULES)
        .lowercase(Locale.ROOT)
    } catch (_: IllegalArgumentException) {
      return null
    }
    if (host.isBlank() || host.length > 253) return null
    val portSuffix = if (port == -1 || port == 443) "" else ":$port"
    return "https://$host$portSuffix"
  }

  fun canonicalKey(target: AutofillTarget): String? = when {
    target.webOrigin != null && target.packageName == null && target.signingCertSha256 == null ->
      normalizeHttpsOrigin(target.webOrigin)?.let { "web:$it" }
    target.webOrigin == null &&
      target.packageName?.matches(PACKAGE_PATTERN) == true &&
      target.signingCertSha256?.uppercase(Locale.ROOT)?.matches(SHA256_PATTERN) == true ->
      "app:${target.packageName}:${target.signingCertSha256.uppercase(Locale.ROOT)}"
    else -> null
  }

  fun packageCertificateSha256(context: Context, packageName: String): String? {
    if (!packageName.matches(PACKAGE_PATTERN)) return null
    val signatures = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val info = context.packageManager.getPackageInfo(
          packageName,
          PackageManager.GET_SIGNING_CERTIFICATES,
        )
        info.signingInfo?.apkContentsSigners
      } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES).signatures
      }
    } catch (_: PackageManager.NameNotFoundException) {
      null
    }
    return certificateSha256(signatures)
  }

  fun certificateSha256(signatures: Array<Signature>?): String? {
    // Multi-signer packages are deliberately not accepted. This keeps an association tied to one
    // current signing identity and fails closed if the package's signer set changes.
    val signature = signatures?.singleOrNull() ?: return null
    return MessageDigest.getInstance("SHA-256")
      .digest(signature.toByteArray())
      .joinToString(separator = "") { byte -> "%02X".format(byte.toInt() and 0xff) }
  }

  fun loadPrivilegedCallerAllowlist(context: Context): String {
    val resource = context.resources.getIdentifier(
      "zero_vault_privileged_callers",
      "raw",
      context.packageName,
    )
    if (resource == 0) return EMPTY_ALLOWLIST
    return context.resources.openRawResource(resource).bufferedReader().use { reader ->
      reader.readText().take(MAX_ALLOWLIST_BYTES)
    }
  }

  fun isTrustedPrivilegedCaller(
    context: Context,
    packageName: String,
    certificateSha256: String,
  ): Boolean {
    val normalizedCertificate = certificateSha256.uppercase(Locale.ROOT)
    if (!normalizedCertificate.matches(SHA256_PATTERN)) return false
    return try {
      val apps = JSONObject(loadPrivilegedCallerAllowlist(context)).getJSONArray("apps")
      for (index in 0 until apps.length()) {
        val app = apps.getJSONObject(index)
        if (app.getString("type") != "android") continue
        val info = app.getJSONObject("info")
        if (info.getString("package_name") != packageName) continue
        val signatures = info.getJSONArray("signatures")
        for (signatureIndex in 0 until signatures.length()) {
          val signature = signatures.getJSONObject(signatureIndex)
          val build = signature.getString("build")
          if (build != "release" && !(build == "userdebug" && Build.TYPE == "userdebug")) continue
          val expected = signature.getString("cert_fingerprint_sha256")
            .replace(":", "")
            .uppercase(Locale.ROOT)
          if (MessageDigest.isEqual(expected.toByteArray(), normalizedCertificate.toByteArray())) {
            return true
          }
        }
      }
      false
    } catch (_: Exception) {
      false
    }
  }

  private const val MAX_ALLOWLIST_BYTES = 256 * 1024
  private const val EMPTY_ALLOWLIST = "{\"apps\":[]}"
}

package expo.modules.zerovault.autofill

import android.app.assist.AssistStructure
import android.content.Context
import android.os.Build
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import expo.modules.zerovault.AutofillTarget
import java.net.IDN
import java.util.ArrayDeque
import java.util.Locale

data class ParsedAutofillRequest(
  val target: AutofillTarget,
  val usernameId: AutofillId?,
  val passwordId: AutofillId,
) {
  val fieldIds: Array<AutofillId>
    get() = listOfNotNull(usernameId, passwordId).toTypedArray()
}

object AutofillRequestParser {
  fun parse(context: Context, structure: AssistStructure): ParsedAutofillRequest? {
    val packageName = structure.activityComponent?.packageName ?: return null
    val certificate = TargetSecurity.packageCertificateSha256(context, packageName) ?: return null
    val usernameIds = linkedSetOf<AutofillId>()
    val passwordIds = linkedSetOf<AutofillId>()
    val webOrigins = linkedSetOf<String>()
    var visited = 0

    val pending = ArrayDeque<AssistStructure.ViewNode>()
    for (windowIndex in 0 until structure.windowNodeCount) {
      pending.add(structure.getWindowNodeAt(windowIndex).rootViewNode)
    }
    while (pending.isNotEmpty()) {
      val node = pending.removeFirst()
      visited += 1
      if (visited > MAX_VIEW_NODES) return null
      val webOrigin = collectWebOrigin(node)
      if (webOrigin != null) webOrigins.add(webOrigin)
      else if (!node.webDomain.isNullOrBlank()) return null

      if (isEligibleTextField(node)) {
        val id = node.autofillId
        when (classify(node)) {
          FieldPurpose.USERNAME -> if (id != null) usernameIds.add(id)
          FieldPurpose.PASSWORD -> if (id != null) passwordIds.add(id)
          FieldPurpose.IGNORE -> Unit
        }
      }
      for (childIndex in 0 until node.childCount) {
        pending.add(node.getChildAt(childIndex))
      }
    }

    if (passwordIds.size != 1 || usernameIds.size > 1 || webOrigins.size > 1) return null
    val target = if (webOrigins.isNotEmpty()) {
      if (!TargetSecurity.isTrustedPrivilegedCaller(context, packageName, certificate)) return null
      AutofillTarget(webOrigin = webOrigins.single())
    } else {
      AutofillTarget(packageName = packageName, signingCertSha256 = certificate)
    }
    if (TargetSecurity.canonicalKey(target) == null) return null
    return ParsedAutofillRequest(target, usernameIds.singleOrNull(), passwordIds.single())
  }

  private fun collectWebOrigin(node: AssistStructure.ViewNode): String? {
    val domain = node.webDomain?.trim()?.takeIf(String::isNotEmpty) ?: return null
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
    if (!node.webScheme.equals("https", ignoreCase = true)) return null
    val asciiDomain = try {
      IDN.toASCII(domain.trimEnd('.'), IDN.USE_STD3_ASCII_RULES).lowercase(Locale.ROOT)
    } catch (_: IllegalArgumentException) {
      return null
    }
    if (asciiDomain.isBlank() || asciiDomain.length > 253 || ':' in asciiDomain) return null
    return TargetSecurity.normalizeHttpsOrigin("https://$asciiDomain")
  }

  private fun isEligibleTextField(node: AssistStructure.ViewNode): Boolean =
    node.visibility == View.VISIBLE &&
      node.isEnabled &&
      node.width > 0 &&
      node.height > 0 &&
      node.autofillType == View.AUTOFILL_TYPE_TEXT

  private fun classify(node: AssistStructure.ViewNode): FieldPurpose {
    val hints = node.autofillHints
      ?.map { hint -> hint.lowercase(Locale.ROOT).replace("-", "").replace("_", "") }
      .orEmpty()
      .toSet()
    if (hints.any { hint -> hint in NEW_PASSWORD_HINTS }) return FieldPurpose.IGNORE
    if (hints.any { hint -> hint in PASSWORD_HINTS }) return FieldPurpose.PASSWORD
    if (hints.any { hint -> hint in USERNAME_HINTS }) return FieldPurpose.USERNAME

    val variation = node.inputType and InputType.TYPE_MASK_VARIATION
    val inputClass = node.inputType and InputType.TYPE_MASK_CLASS
    if (inputClass == InputType.TYPE_CLASS_TEXT && variation in PASSWORD_VARIATIONS) {
      return FieldPurpose.PASSWORD
    }

    val identifier = listOfNotNull(node.idEntry, node.hint)
      .joinToString(separator = " ")
      .lowercase(Locale.ROOT)
      .replace(Regex("[^a-z0-9]+"), " ")
      .trim()
    return when {
      identifier.split(' ').any { it in PASSWORD_IDENTIFIERS } -> FieldPurpose.PASSWORD
      identifier.split(' ').any { it in USERNAME_IDENTIFIERS } -> FieldPurpose.USERNAME
      else -> FieldPurpose.IGNORE
    }
  }

  private enum class FieldPurpose { USERNAME, PASSWORD, IGNORE }

  private val PASSWORD_VARIATIONS = setOf(
    InputType.TYPE_TEXT_VARIATION_PASSWORD,
    InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
    InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
  )
  private val PASSWORD_HINTS = setOf("password", "currentpassword")
  private val NEW_PASSWORD_HINTS = setOf("newpassword", "confirmpassword")
  private val USERNAME_HINTS = setOf("username", "email", "emailaddress")
  private val PASSWORD_IDENTIFIERS = setOf("password", "passwd", "pwd")
  private val USERNAME_IDENTIFIERS = setOf("username", "user", "email", "login")
  private const val MAX_VIEW_NODES = 10_000
}

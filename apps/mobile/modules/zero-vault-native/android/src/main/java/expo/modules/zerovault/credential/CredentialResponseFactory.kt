package expo.modules.zerovault.credential

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.credentials.provider.AuthenticationAction
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.PasswordCredentialEntry
import expo.modules.zerovault.AutofillTarget
import expo.modules.zerovault.R
import expo.modules.zerovault.VaultRepository
import expo.modules.zerovault.autofill.TargetSecurity
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger

object CredentialResponseFactory {
  fun locked(
    context: Context,
    target: AutofillTarget,
  ): BeginGetCredentialResponse {
    val targetKey = TargetSecurity.canonicalKey(target) ?: error("Invalid credential target")
    val pendingIntent = CredentialPendingIntents.create(
      context = context,
      mode = CredentialPendingIntents.MODE_UNLOCK,
      candidateId = null,
      targetKey = targetKey,
    )
    return BeginGetCredentialResponse.Builder()
      .addAuthenticationAction(
        AuthenticationAction(context.getString(R.string.unlock_zero_vault), pendingIntent),
      )
      .build()
  }

  suspend fun candidates(
    context: Context,
    request: BeginGetCredentialRequest,
    target: AutofillTarget,
    repository: VaultRepository,
  ): BeginGetCredentialResponse {
    val targetKey = TargetSecurity.canonicalKey(target) ?: error("Invalid credential target")
    val candidates = repository.findAutofillCandidates(target).take(MAX_CANDIDATES)
    val builder = BeginGetCredentialResponse.Builder()
    for (option in request.beginGetCredentialOptions) {
      if (option !is BeginGetPasswordOption) continue
      val allowedUserIds = option.allowedUserIds
      for (candidate in candidates) {
        if (
          candidate.id.isBlank() ||
          candidate.id.length > MAX_CANDIDATE_ID_LENGTH ||
          candidate.username.isBlank() ||
          candidate.username.length > MAX_USERNAME_LENGTH
        ) continue
        if (allowedUserIds.isNotEmpty() && candidate.username !in allowedUserIds) continue
        val pendingIntent = CredentialPendingIntents.create(
          context = context,
          mode = CredentialPendingIntents.MODE_CANDIDATE,
          candidateId = candidate.id,
          targetKey = targetKey,
        )
        val entry = PasswordCredentialEntry.Builder(
          context,
          candidate.username,
          pendingIntent,
          option,
        )
          .setDisplayName(
            candidate.title
              .ifBlank { context.getString(R.string.zero_vault_name) }
              .take(MAX_LABEL_LENGTH),
          )
          .setAffiliatedDomain(target.webOrigin ?: target.packageName)
          .setAutoSelectAllowed(false)
          .build()
        builder.addCredentialEntry(entry)
      }
    }
    return builder.build()
  }

  private const val MAX_CANDIDATES = 50
  private const val MAX_LABEL_LENGTH = 256
  private const val MAX_CANDIDATE_ID_LENGTH = 256
  private const val MAX_USERNAME_LENGTH = 4_096
}

object CredentialPendingIntents {
  const val EXTRA_MODE = "expo.modules.zerovault.credential.MODE"
  const val EXTRA_CANDIDATE_ID = "expo.modules.zerovault.credential.CANDIDATE_ID"
  const val EXTRA_TARGET_KEY = "expo.modules.zerovault.credential.TARGET_KEY"
  const val MODE_UNLOCK = "unlock"
  const val MODE_CANDIDATE = "candidate"

  private val requestCodes = AtomicInteger(8_192)

  fun create(
    context: Context,
    mode: String,
    candidateId: String?,
    targetKey: String,
  ): PendingIntent {
    require(mode == MODE_UNLOCK || mode == MODE_CANDIDATE)
    val identity = sha256("$mode|${candidateId.orEmpty()}|$targetKey")
    val intent = Intent(context, ZeroVaultCredentialActivity::class.java).apply {
      data = Uri.Builder()
        .scheme("zerovault-internal")
        .authority("credential")
        .appendPath(mode)
        .appendPath(identity)
        .build()
      putExtra(EXTRA_MODE, mode)
      putExtra(EXTRA_TARGET_KEY, targetKey)
      candidateId?.let { putExtra(EXTRA_CANDIDATE_ID, it) }
    }
    return PendingIntent.getActivity(
      context,
      requestCodes.getAndIncrement(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
    )
  }

  private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8))
    .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
}

package expo.modules.zerovault.autofill

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.autofill.Dataset
import android.service.autofill.FillResponse
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import expo.modules.zerovault.AutofillCandidate
import expo.modules.zerovault.R
import expo.modules.zerovault.RevealedCredential
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger

object AutofillResponseFactory {
  fun locked(
    context: Context,
    request: ParsedAutofillRequest,
    inlineRequest: Any?,
  ): FillResponse {
    val pendingIntent = AutofillPendingIntents.create(
      context = context,
      mode = AutofillPendingIntents.MODE_UNLOCK,
      candidateId = null,
      targetKey = TargetSecurity.canonicalKey(request.target) ?: error("Invalid target"),
    )
    val unlockTitle = context.getString(R.string.unlock_zero_vault)
    val presentation = presentation(
      context,
      unlockTitle,
      context.getString(R.string.autofill_choose_credential),
    )
    val builder = FillResponse.Builder()
    val hasInline = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
      inlineRequest != null &&
      AutofillInlineApi.setResponseAuthentication(
        builder,
        request.fieldIds,
        pendingIntent,
        presentation,
        inlineRequest,
        unlockTitle,
        context.getString(R.string.verify_identity),
      )
    if (!hasInline) {
      builder.setAuthentication(request.fieldIds, pendingIntent.intentSender, presentation)
    }
    return builder.build()
  }

  fun candidates(
    context: Context,
    request: ParsedAutofillRequest,
    candidates: List<AutofillCandidate>,
    inlineRequest: Any?,
  ): FillResponse? {
    val targetKey = TargetSecurity.canonicalKey(request.target) ?: return null
    val builder = FillResponse.Builder()
    var added = 0
    for (candidate in candidates.take(MAX_CANDIDATES)) {
      if (
        candidate.id.isBlank() ||
        candidate.id.length > MAX_CANDIDATE_ID_LENGTH ||
        candidate.username.isBlank() ||
        candidate.username.length > MAX_USERNAME_LENGTH
      ) continue
      val pendingIntent = AutofillPendingIntents.create(
        context = context,
        mode = AutofillPendingIntents.MODE_CANDIDATE,
        candidateId = candidate.id,
        targetKey = targetKey,
      )
      val title = candidate.title
        .ifBlank { context.getString(R.string.zero_vault_name) }
        .take(MAX_LABEL_LENGTH)
      val username = candidate.username.take(MAX_LABEL_LENGTH)
      val presentation = presentation(context, title, username)
      @Suppress("DEPRECATION")
      val dataset = Dataset.Builder(presentation).apply {
        setValue(request.passwordId, null)
        request.usernameId?.let { setValue(it, null) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && inlineRequest != null) {
          AutofillInlineApi.setDatasetPresentation(
            this,
            inlineRequest,
            pendingIntent,
            title,
            username,
          )
        }
        setAuthentication(pendingIntent.intentSender)
      }.build()
      builder.addDataset(dataset)
      added += 1
    }
    return if (added == 0) null else builder.build()
  }

  fun revealed(
    context: Context,
    request: ParsedAutofillRequest,
    credential: RevealedCredential,
  ): Dataset {
    require(credential.password.isNotEmpty() && credential.password.length <= MAX_SECRET_LENGTH)
    require(credential.username.length <= MAX_USERNAME_LENGTH)
    val presentation = presentation(
      context,
      context.getString(R.string.zero_vault_name),
      credential.username.take(MAX_LABEL_LENGTH),
    )
    @Suppress("DEPRECATION")
    return Dataset.Builder(presentation).apply {
      setValue(request.passwordId, AutofillValue.forText(credential.password))
      request.usernameId?.let { usernameId ->
        setValue(usernameId, AutofillValue.forText(credential.username))
      }
    }.build()
  }

  private fun presentation(context: Context, title: String, subtitle: String): RemoteViews =
    RemoteViews(context.packageName, R.layout.zero_vault_autofill_presentation).apply {
      setTextViewText(R.id.zero_vault_autofill_title, title)
      setTextViewText(R.id.zero_vault_autofill_subtitle, subtitle)
    }

  private const val MAX_CANDIDATES = 50
  private const val MAX_LABEL_LENGTH = 256
  private const val MAX_CANDIDATE_ID_LENGTH = 256
  private const val MAX_USERNAME_LENGTH = 4_096
  private const val MAX_SECRET_LENGTH = 65_536
}

object AutofillPendingIntents {
  const val EXTRA_MODE = "expo.modules.zerovault.autofill.MODE"
  const val EXTRA_CANDIDATE_ID = "expo.modules.zerovault.autofill.CANDIDATE_ID"
  const val EXTRA_TARGET_KEY = "expo.modules.zerovault.autofill.TARGET_KEY"
  const val MODE_UNLOCK = "unlock"
  const val MODE_CANDIDATE = "candidate"

  private val requestCodes = AtomicInteger(4_096)

  fun create(
    context: Context,
    mode: String,
    candidateId: String?,
    targetKey: String,
  ): PendingIntent {
    require(mode == MODE_UNLOCK || mode == MODE_CANDIDATE)
    val identity = sha256("$mode|${candidateId.orEmpty()}|$targetKey")
    val intent = Intent(context, ZeroVaultAutofillAuthActivity::class.java).apply {
      data = Uri.Builder()
        .scheme("zerovault-internal")
        .authority("autofill")
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

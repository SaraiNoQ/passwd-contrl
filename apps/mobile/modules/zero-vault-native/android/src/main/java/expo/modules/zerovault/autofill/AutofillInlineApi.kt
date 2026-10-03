package expo.modules.zerovault.autofill

import android.app.PendingIntent
import android.os.Build
import android.service.autofill.Dataset
import android.service.autofill.FillResponse
import android.service.autofill.InlinePresentation
import android.view.autofill.AutofillId
import android.view.inputmethod.InlineSuggestionsRequest
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import androidx.autofill.inline.UiVersions
import androidx.autofill.inline.v1.InlineSuggestionUi

/** Keeps API 30-only classes out of service method signatures used on API 26-29. */
@RequiresApi(Build.VERSION_CODES.R)
object AutofillInlineApi {
  fun request(request: android.service.autofill.FillRequest): Any? =
    request.inlineSuggestionsRequest

  @Suppress("DEPRECATION")
  fun setResponseAuthentication(
    builder: FillResponse.Builder,
    ids: Array<AutofillId>,
    authentication: PendingIntent,
    presentation: RemoteViews,
    rawRequest: Any,
    title: String,
    subtitle: String,
  ): Boolean {
    val inline = build(rawRequest, authentication, title, subtitle) ?: return false
    builder.setAuthentication(ids, authentication.intentSender, presentation, inline)
    return true
  }

  @Suppress("DEPRECATION")
  fun setDatasetPresentation(
    builder: Dataset.Builder,
    rawRequest: Any,
    attributionIntent: PendingIntent,
    title: String,
    subtitle: String,
  ): Boolean {
    val inline = build(rawRequest, attributionIntent, title, subtitle) ?: return false
    builder.setInlinePresentation(inline)
    return true
  }

  private fun build(
    rawRequest: Any,
    attributionIntent: PendingIntent,
    title: String,
    subtitle: String,
  ): InlinePresentation? {
    val request = rawRequest as? InlineSuggestionsRequest ?: return null
    val spec = request.inlinePresentationSpecs.firstOrNull { candidate ->
      UiVersions.getVersions(candidate.style).contains(UiVersions.INLINE_UI_VERSION_1)
    } ?: return null
    val content = InlineSuggestionUi.newContentBuilder(attributionIntent)
      .setTitle(title)
      .setSubtitle(subtitle)
      .setContentDescription("$title, $subtitle")
      .build()
    return InlinePresentation(content.slice, spec, false)
  }
}


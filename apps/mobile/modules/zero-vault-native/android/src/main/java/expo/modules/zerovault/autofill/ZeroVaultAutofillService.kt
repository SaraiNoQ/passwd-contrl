package expo.modules.zerovault.autofill

import android.os.CancellationSignal
import android.os.Build
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import expo.modules.zerovault.AutofillStatus
import expo.modules.zerovault.VaultRepositoryProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class ZeroVaultAutofillService : AutofillService() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  override fun onFillRequest(
    request: FillRequest,
    cancellationSignal: CancellationSignal,
    callback: FillCallback,
  ) {
    val structure = request.fillContexts.lastOrNull()?.structure
    val parsed = structure?.let { AutofillRequestParser.parse(applicationContext, it) }
    if (parsed == null || cancellationSignal.isCanceled) {
      callback.onSuccess(null)
      return
    }

    val job: Job = scope.launch {
      val response = try {
        val repository = VaultRepositoryProvider.get(applicationContext)
        val inlineRequest = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          AutofillInlineApi.request(request)
        } else {
          null
        }
        when (repository.autofillStatus()) {
          AutofillStatus.LOCKED_BIOMETRIC -> AutofillResponseFactory.locked(
            applicationContext,
            parsed,
            inlineRequest,
          )
          AutofillStatus.READY -> AutofillResponseFactory.candidates(
            applicationContext,
            parsed,
            repository.findAutofillCandidates(parsed.target),
            inlineRequest,
          )
          AutofillStatus.UNAVAILABLE -> null
        }
      } catch (_: Exception) {
        null
      }
      if (!cancellationSignal.isCanceled) callback.onSuccess(response)
    }
    cancellationSignal.setOnCancelListener { job.cancel() }
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    // v1 is retrieval-only. Do not inspect or retain client form values.
    callback.onSuccess()
  }

  override fun onDestroy() {
    scope.cancel()
    super.onDestroy()
  }
}

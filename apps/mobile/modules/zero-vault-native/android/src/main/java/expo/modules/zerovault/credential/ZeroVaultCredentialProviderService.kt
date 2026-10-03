package expo.modules.zerovault.credential

import android.os.CancellationSignal
import android.os.OutcomeReceiver
import androidx.annotation.RequiresApi
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialUnsupportedException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import expo.modules.zerovault.AutofillStatus
import expo.modules.zerovault.VaultRepositoryProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@RequiresApi(34)
class ZeroVaultCredentialProviderService : CredentialProviderService() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  override fun onBeginGetCredentialRequest(
    request: BeginGetCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>,
  ) {
    if (request.beginGetCredentialOptions.none { it is BeginGetPasswordOption }) {
      callback.onError(NoCredentialException())
      return
    }
    val target = CredentialTargetResolver.resolve(applicationContext, request.callingAppInfo)
    if (target == null || cancellationSignal.isCanceled) {
      callback.onError(NoCredentialException())
      return
    }

    val job: Job = scope.launch {
      try {
        val repository = VaultRepositoryProvider.get(applicationContext)
        val response = when (repository.autofillStatus()) {
          AutofillStatus.LOCKED_BIOMETRIC -> CredentialResponseFactory.locked(applicationContext, target)
          AutofillStatus.READY -> CredentialResponseFactory.candidates(
            applicationContext,
            request,
            target,
            repository,
          )
          AutofillStatus.UNAVAILABLE -> throw NoCredentialException()
        }
        if (!cancellationSignal.isCanceled) callback.onResult(response)
      } catch (_: Exception) {
        if (!cancellationSignal.isCanceled) callback.onError(NoCredentialException())
      }
    }
    cancellationSignal.setOnCancelListener { job.cancel() }
  }

  override fun onBeginCreateCredentialRequest(
    request: BeginCreateCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>,
  ) {
    // v1 is retrieval-only. Password creation and every passkey path are intentionally absent.
    callback.onError(CreateCredentialUnsupportedException("Zero Vault v1 is retrieval-only"))
  }

  override fun onClearCredentialStateRequest(
    request: ProviderClearCredentialStateRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<Void?, ClearCredentialException>,
  ) {
    // No caller-specific sticky selection state is retained.
    callback.onResult(null)
  }

  override fun onDestroy() {
    scope.cancel()
    super.onDestroy()
  }
}

package expo.modules.zerovault.credential

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.annotation.RequiresApi
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPasswordOption
import androidx.credentials.PasswordCredential
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.PendingIntentHandler
import androidx.credentials.provider.ProviderGetCredentialRequest
import androidx.fragment.app.FragmentActivity
import expo.modules.zerovault.AutofillStatus
import expo.modules.zerovault.VaultRepository
import expo.modules.zerovault.VaultRepositoryProvider
import expo.modules.zerovault.autofill.TargetSecurity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@RequiresApi(34)
class ZeroVaultCredentialActivity : FragmentActivity() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setResult(Activity.RESULT_CANCELED)

    scope.launch {
      try {
        when (intent.getStringExtra(CredentialPendingIntents.EXTRA_MODE)) {
          CredentialPendingIntents.MODE_UNLOCK -> handleUnlock()
          CredentialPendingIntents.MODE_CANDIDATE -> handleCandidate()
          else -> finish()
        }
      } catch (_: Exception) {
        finish()
      }
    }
  }

  private suspend fun handleUnlock() {
    val request = PendingIntentHandler.retrieveBeginGetCredentialRequest(intent) ?: return finish()
    if (request.beginGetCredentialOptions.none { it is BeginGetPasswordOption }) return finish()
    val target = verifiedTarget(request) ?: return finish()
    val repository = VaultRepositoryProvider.get(applicationContext)
    ensureUnlocked(repository)
    val response = withContext(Dispatchers.IO) {
      CredentialResponseFactory.candidates(
        applicationContext,
        request,
        target,
        repository,
      )
    }
    val result = Intent()
    PendingIntentHandler.setBeginGetCredentialResponse(result, response)
    setResult(Activity.RESULT_OK, result)
    finish()
  }

  private suspend fun handleCandidate() {
    val request = PendingIntentHandler.retrieveProviderGetCredentialRequest(intent) ?: return finish()
    val target = verifiedTarget(request) ?: return finish()
    val candidateId = intent.getStringExtra(CredentialPendingIntents.EXTRA_CANDIDATE_ID)
      ?.takeIf(String::isNotBlank)
      ?: return finish()
    val repository = VaultRepositoryProvider.get(applicationContext)
    ensureUnlocked(repository)
    val credential = withContext(Dispatchers.IO) {
      repository.revealAutofillCredential(candidateId, target)
    }
    if (
      credential.username.isEmpty() ||
      credential.username.length > MAX_USERNAME_LENGTH ||
      credential.password.isEmpty() ||
      credential.password.length > MAX_SECRET_LENGTH
    ) return finish()
    if (request.credentialOptions
      .filterIsInstance<GetPasswordOption>()
      .none { option ->
        option.allowedUserIds.isEmpty() || credential.username in option.allowedUserIds
      }
    ) return finish()

    val result = Intent()
    PendingIntentHandler.setGetCredentialResponse(
      result,
      GetCredentialResponse(PasswordCredential(credential.username, credential.password)),
    )
    setResult(Activity.RESULT_OK, result)
    finish()
  }

  private suspend fun ensureUnlocked(repository: VaultRepository) {
    when (repository.autofillStatus()) {
      AutofillStatus.READY -> return
      AutofillStatus.LOCKED_BIOMETRIC -> repository.unlockActiveAccountWithBiometric(this)
      AutofillStatus.UNAVAILABLE -> error("Credential provider is unavailable")
    }
    check(repository.autofillStatus() == AutofillStatus.READY)
  }

  private fun verifiedTarget(request: BeginGetCredentialRequest) =
    CredentialTargetResolver.resolve(applicationContext, request.callingAppInfo)
      ?.takeIf(::matchesExpectedTarget)

  private fun verifiedTarget(request: ProviderGetCredentialRequest) =
    CredentialTargetResolver.resolve(applicationContext, request.callingAppInfo)
      ?.takeIf(::matchesExpectedTarget)

  private fun matchesExpectedTarget(target: expo.modules.zerovault.AutofillTarget): Boolean {
    val expected = intent.getStringExtra(CredentialPendingIntents.EXTRA_TARGET_KEY) ?: return false
    return TargetSecurity.canonicalKey(target) == expected
  }

  override fun onDestroy() {
    scope.cancel()
    super.onDestroy()
  }

  private companion object {
    const val MAX_USERNAME_LENGTH = 4_096
    const val MAX_SECRET_LENGTH = 65_536
  }
}

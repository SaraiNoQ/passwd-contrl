package expo.modules.zerovault.autofill

import android.app.Activity
import android.app.assist.AssistStructure
import android.content.Intent
import android.os.Bundle
import android.view.autofill.AutofillManager
import androidx.fragment.app.FragmentActivity
import expo.modules.zerovault.AutofillStatus
import expo.modules.zerovault.VaultRepository
import expo.modules.zerovault.VaultRepositoryProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ZeroVaultAutofillAuthActivity : FragmentActivity() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setResult(Activity.RESULT_CANCELED)

    val structure = authenticationStructure() ?: return finish()
    val parsed = AutofillRequestParser.parse(applicationContext, structure) ?: return finish()
    val expectedTarget = intent.getStringExtra(AutofillPendingIntents.EXTRA_TARGET_KEY)
    if (expectedTarget == null || TargetSecurity.canonicalKey(parsed.target) != expectedTarget) {
      return finish()
    }

    scope.launch {
      try {
        val repository = VaultRepositoryProvider.get(applicationContext)
        ensureUnlocked(repository)
        when (intent.getStringExtra(AutofillPendingIntents.EXTRA_MODE)) {
          AutofillPendingIntents.MODE_UNLOCK -> returnUnlockedCandidates(repository, parsed)
          AutofillPendingIntents.MODE_CANDIDATE -> returnCredential(repository, parsed)
          else -> finish()
        }
      } catch (_: Exception) {
        finish()
      }
    }
  }

  private suspend fun ensureUnlocked(repository: VaultRepository) {
    when (repository.autofillStatus()) {
      AutofillStatus.READY -> return
      AutofillStatus.LOCKED_BIOMETRIC -> repository.unlockActiveAccountWithBiometric(this)
      AutofillStatus.UNAVAILABLE -> error("Autofill is unavailable")
    }
    check(repository.autofillStatus() == AutofillStatus.READY)
  }

  private suspend fun returnUnlockedCandidates(
    repository: VaultRepository,
    parsed: ParsedAutofillRequest,
  ) {
    val response = withContext(Dispatchers.IO) {
      AutofillResponseFactory.candidates(
        applicationContext,
        parsed,
        repository.findAutofillCandidates(parsed.target),
        inlineRequest = null,
      )
    } ?: return finish()
    returnAuthenticationResult(response)
  }

  private suspend fun returnCredential(
    repository: VaultRepository,
    parsed: ParsedAutofillRequest,
  ) {
    val candidateId = intent.getStringExtra(AutofillPendingIntents.EXTRA_CANDIDATE_ID)
      ?.takeIf(String::isNotBlank)
      ?: return finish()
    val credential = withContext(Dispatchers.IO) {
      repository.revealAutofillCredential(candidateId, parsed.target)
    }
    returnAuthenticationResult(
      AutofillResponseFactory.revealed(applicationContext, parsed, credential),
    )
  }

  private fun returnAuthenticationResult(value: android.os.Parcelable) {
    val result = Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, value)
    setResult(Activity.RESULT_OK, result)
    finish()
  }

  @Suppress("DEPRECATION")
  private fun authenticationStructure(): AssistStructure? =
    intent.getParcelableExtra(AutofillManager.EXTRA_ASSIST_STRUCTURE)

  override fun onDestroy() {
    scope.cancel()
    super.onDestroy()
  }
}

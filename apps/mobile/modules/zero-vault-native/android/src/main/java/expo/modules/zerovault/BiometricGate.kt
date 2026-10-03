package expo.modules.zerovault

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import javax.crypto.Cipher
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

class BiometricGate {
  suspend fun authenticate(
    activity: FragmentActivity,
    cipher: Cipher,
    title: String,
  ): Cipher = withContext(Dispatchers.Main.immediate) {
    suspendCancellableCoroutine { continuation ->
      if (BiometricManager.from(activity).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) !=
        BiometricManager.BIOMETRIC_SUCCESS
      ) {
        continuation.resumeWithException(
          VaultRepositoryException("BIOMETRIC_UNAVAILABLE", "Strong biometric authentication is unavailable"),
        )
        return@suspendCancellableCoroutine
      }
      val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(activity),
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            if (!continuation.isActive) return
            val authenticatedCipher = result.cryptoObject?.cipher
            if (authenticatedCipher == null) {
              continuation.resumeWithException(
                VaultRepositoryException("AUTH_FAILED", "Biometric authentication did not authorize the key"),
              )
            } else {
              continuation.resume(authenticatedCipher)
            }
          }

          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            if (continuation.isActive) {
              continuation.resumeWithException(
                VaultRepositoryException("AUTH_CANCELLED", "Biometric authentication was cancelled"),
              )
            }
          }
        },
      )
      continuation.invokeOnCancellation {
        activity.runOnUiThread { runCatching { prompt.cancelAuthentication() } }
      }
      prompt.authenticate(
        BiometricPrompt.PromptInfo.Builder()
          .setTitle(title)
          .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
          .setNegativeButtonText(activity.getString(R.string.biometric_cancel))
          .build(),
        BiometricPrompt.CryptoObject(cipher),
      )
    }
  }
}

package expo.modules.zerovault

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import java.security.MessageDigest
import java.util.Locale

class SecureMaterialStore(context: Context) {
  private val preferences = context.applicationContext.getSharedPreferences(
    PREFERENCES_NAME,
    Context.MODE_PRIVATE,
  )

  fun putDevicePrivateKey(accountId: String, wrapped: WrappedSecret, biometric: Boolean = false) {
    preferences.edit()
      .putString(secretKey(accountId, biometric), Base64.encodeToString(wrapped.encode(), Base64.NO_WRAP))
      .commitOrThrow()
  }

  fun getDevicePrivateKey(accountId: String, biometric: Boolean = false): WrappedSecret? =
    preferences.getString(secretKey(accountId, biometric), null)?.let {
      runCatching { WrappedSecret.decode(Base64.decode(it, Base64.NO_WRAP)) }
        .getOrElse {
          throw VaultRepositoryException("CIPHERTEXT_TAMPERED", "Protected device material is invalid")
        }
    }

  fun clearDevicePrivateKey(accountId: String, biometric: Boolean = false) {
    preferences.edit().remove(secretKey(accountId, biometric)).commitOrThrow()
  }

  fun setBiometricRequired(accountId: String, required: Boolean) {
    preferences.edit().putBoolean(biometricPolicyKey(accountId), required).commitOrThrow()
  }

  fun isBiometricRequired(accountId: String): Boolean =
    preferences.getBoolean(biometricPolicyKey(accountId), false)

  fun putDeviceCredential(accountId: String, wrapped: WrappedSecret) {
    preferences.edit()
      .putString(credentialKey(accountId), Base64.encodeToString(wrapped.encode(), Base64.NO_WRAP))
      .commitOrThrow()
  }

  fun getDeviceCredential(accountId: String): WrappedSecret? =
    preferences.getString(credentialKey(accountId), null)?.let {
      runCatching { WrappedSecret.decode(Base64.decode(it, Base64.NO_WRAP)) }
        .getOrElse {
          throw VaultRepositoryException("CIPHERTEXT_TAMPERED", "Protected device credential is invalid")
        }
    }

  fun clearDeviceCredential(accountId: String) {
    preferences.edit().remove(credentialKey(accountId)).commitOrThrow()
  }

  /**
   * Bind a canonical login identifier to its local account without persisting the email itself.
   * The mapping is metadata only; the device credential remains Keystore-wrapped separately.
   */
  fun bindEmail(email: String, accountId: String) {
    val emailHash = emailHash(email)
    val accountEmailKey = accountEmailHashKey(accountId)
    val previousEmailHash = preferences.getString(accountEmailKey, null)
    val previousAccountId = preferences.getString(emailAccountKey(emailHash), null)
    preferences.edit().apply {
      if (previousEmailHash != null && previousEmailHash != emailHash) {
        remove(emailAccountKey(previousEmailHash))
      }
      if (previousAccountId != null && previousAccountId != accountId) {
        remove(accountEmailHashKey(previousAccountId))
      }
      putString(emailAccountKey(emailHash), accountId)
      putString(accountEmailKey, emailHash)
    }.commitOrThrow()
  }

  fun accountIdForEmail(email: String): String? =
    preferences.getString(emailAccountKey(emailHash(email)), null)

  fun clearEmailBinding(accountId: String) {
    val accountEmailKey = accountEmailHashKey(accountId)
    val emailHash = preferences.getString(accountEmailKey, null)
    preferences.edit().apply {
      remove(accountEmailKey)
      if (emailHash != null && preferences.getString(emailAccountKey(emailHash), null) == accountId) {
        remove(emailAccountKey(emailHash))
      }
    }.commitOrThrow()
  }

  fun deleteAccount(accountId: String) {
    clearEmailBinding(accountId)
    preferences.edit().apply {
      remove(secretKey(accountId, false))
      remove(secretKey(accountId, true))
      remove(credentialKey(accountId))
      remove(biometricPolicyKey(accountId))
    }.commitOrThrow()
    if (activeAccountId() == accountId) setActiveAccount(null)
  }

  fun setActiveAccount(accountId: String?) {
    preferences.edit().apply {
      if (accountId == null) remove(ACTIVE_ACCOUNT_KEY) else putString(ACTIVE_ACCOUNT_KEY, accountId)
    }.commitOrThrow()
  }

  fun activeAccountId(): String? = preferences.getString(ACTIVE_ACCOUNT_KEY, null)

  fun putPendingDevice(
    email: String,
    deviceId: String,
    wrappedPrivateKey: WrappedSecret,
    wrappedCredential: WrappedSecret?,
    publicKey: String,
    fingerprint: String,
  ) {
    preferences.edit().apply {
      putString(PENDING_DEVICE_ID, deviceId)
      putString(PENDING_PRIVATE_KEY, Base64.encodeToString(wrappedPrivateKey.encode(), Base64.NO_WRAP))
      putString(PENDING_EMAIL_HASH, emailHash(email))
      putString(PENDING_PUBLIC_KEY, publicKey)
      putString(PENDING_FINGERPRINT, fingerprint)
      if (wrappedCredential == null) {
        remove(PENDING_DEVICE_CREDENTIAL)
      } else {
        putString(
          PENDING_DEVICE_CREDENTIAL,
          Base64.encodeToString(wrappedCredential.encode(), Base64.NO_WRAP),
        )
      }
    }.commitOrThrow()
  }

  fun pendingDevicePrivateKey(): WrappedSecret? = preferences.getString(PENDING_PRIVATE_KEY, null)?.let {
    runCatching { WrappedSecret.decode(Base64.decode(it, Base64.NO_WRAP)) }
      .getOrElse {
        throw VaultRepositoryException("CIPHERTEXT_TAMPERED", "Pending device material is invalid")
      }
  }

  fun pendingDevicePublicKey(): String? = preferences.getString(PENDING_PUBLIC_KEY, null)

  fun pendingDeviceCredential(): WrappedSecret? = preferences.getString(PENDING_DEVICE_CREDENTIAL, null)?.let {
    runCatching { WrappedSecret.decode(Base64.decode(it, Base64.NO_WRAP)) }
      .getOrElse {
        throw VaultRepositoryException("CIPHERTEXT_TAMPERED", "Pending device credential is invalid")
      }
  }

  fun pendingDeviceId(): String? = preferences.getString(PENDING_DEVICE_ID, null)

  fun pendingDeviceFingerprint(): String? = preferences.getString(PENDING_FINGERPRINT, null)

  fun pendingDeviceMatches(email: String): Boolean =
    preferences.getString(PENDING_EMAIL_HASH, null) == emailHash(email)

  fun clearPendingDevice() {
    preferences.edit()
      .remove(PENDING_PRIVATE_KEY)
      .remove(PENDING_DEVICE_CREDENTIAL)
      .remove(PENDING_DEVICE_ID)
      .remove(PENDING_EMAIL_HASH)
      .remove(PENDING_PUBLIC_KEY)
      .remove(PENDING_FINGERPRINT)
      .commitOrThrow()
  }

  fun putPendingRecovery(
    email: String,
    wrappedRecoveryCode: WrappedSecret,
    wrappedRecoveryPacket: WrappedSecret,
    signingPublicKey: String,
  ) {
    preferences.edit()
      .putString(PENDING_RECOVERY_EMAIL_HASH, emailHash(email))
      .putString(
        PENDING_RECOVERY_CODE,
        Base64.encodeToString(wrappedRecoveryCode.encode(), Base64.NO_WRAP),
      )
      .putString(
        PENDING_RECOVERY_PACKET,
        Base64.encodeToString(wrappedRecoveryPacket.encode(), Base64.NO_WRAP),
      )
      .putString(PENDING_RECOVERY_SIGNING_PUBLIC_KEY, signingPublicKey)
      .remove(PENDING_RECOVERY_ACCOUNT_HASH)
      .commitOrThrow()
  }

  fun pendingRecoveryMatches(email: String): Boolean =
    preferences.getString(PENDING_RECOVERY_EMAIL_HASH, null) == emailHash(email)

  fun isPendingRecoveryBound(email: String): Boolean =
    pendingRecoveryMatches(email) && preferences.contains(PENDING_RECOVERY_ACCOUNT_HASH)

  fun isPendingRecoveryBoundTo(email: String, accountId: String): Boolean =
    pendingRecoveryMatches(email) &&
      preferences.getString(PENDING_RECOVERY_ACCOUNT_HASH, null) == accountHash(accountId)

  fun isPendingRecoveryBoundToAccount(accountId: String): Boolean =
    preferences.getString(PENDING_RECOVERY_ACCOUNT_HASH, null) == accountHash(accountId)

  fun clearPendingRecoveryForAccount(accountId: String): Boolean {
    if (!isPendingRecoveryBoundToAccount(accountId)) return false
    preferences.edit()
      .remove(PENDING_RECOVERY_EMAIL_HASH)
      .remove(PENDING_RECOVERY_ACCOUNT_HASH)
      .remove(PENDING_RECOVERY_CODE)
      .remove(PENDING_RECOVERY_PACKET)
      .remove(PENDING_RECOVERY_SIGNING_PUBLIC_KEY)
      .commitOrThrow()
    return true
  }

  fun pendingRecoveryCode(): WrappedSecret? = wrappedPreference(PENDING_RECOVERY_CODE)

  fun pendingRecoveryPacket(): WrappedSecret? = wrappedPreference(PENDING_RECOVERY_PACKET)

  fun pendingRecoverySigningPublicKey(): String? =
    preferences.getString(PENDING_RECOVERY_SIGNING_PUBLIC_KEY, null)

  fun bindPendingRecoveryAccount(email: String, accountId: String) {
    if (pendingRecoveryMatches(email)) {
      preferences.edit().putString(PENDING_RECOVERY_ACCOUNT_HASH, accountHash(accountId)).commitOrThrow()
    }
  }

  fun clearPendingRecovery(email: String) {
    if (!pendingRecoveryMatches(email)) return
    preferences.edit()
      .remove(PENDING_RECOVERY_EMAIL_HASH)
      .remove(PENDING_RECOVERY_ACCOUNT_HASH)
      .remove(PENDING_RECOVERY_CODE)
      .remove(PENDING_RECOVERY_PACKET)
      .remove(PENDING_RECOVERY_SIGNING_PUBLIC_KEY)
      .commitOrThrow()
  }

  fun wrappingAlias(accountId: String): String = AndroidKeyStore.WRAP_ALIAS_PREFIX + accountHash(accountId)

  fun biometricAlias(accountId: String): String =
    AndroidKeyStore.BIOMETRIC_ALIAS_PREFIX + accountHash(accountId)

  fun pendingAlias(): String = AndroidKeyStore.WRAP_ALIAS_PREFIX + "pending-device"

  fun pendingRecoveryAlias(): String = AndroidKeyStore.WRAP_ALIAS_PREFIX + "pending-recovery"

  private fun secretKey(accountId: String, biometric: Boolean): String =
    (if (biometric) "device-private-biometric-" else "device-private-") + accountHash(accountId)

  private fun credentialKey(accountId: String): String = "device-credential-" + accountHash(accountId)

  private fun biometricPolicyKey(accountId: String): String = "biometric-required-" + accountHash(accountId)

  private fun emailAccountKey(emailHash: String): String = "email-account-$emailHash"

  private fun accountEmailHashKey(accountId: String): String = "account-email-hash-" + accountHash(accountId)

  private fun emailHash(email: String): String = MessageDigest.getInstance("SHA-256")
    .digest(email.trim().lowercase(Locale.ROOT).toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it) }

  private fun wrappedPreference(key: String): WrappedSecret? = preferences.getString(key, null)?.let {
    runCatching { WrappedSecret.decode(Base64.decode(it, Base64.NO_WRAP)) }
      .getOrElse {
        throw VaultRepositoryException("CIPHERTEXT_TAMPERED", "Protected recovery material is invalid")
      }
  }

  private fun accountHash(accountId: String): String = MessageDigest.getInstance("SHA-256")
    .digest(accountId.toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it) }

  companion object {
    const val PREFERENCES_NAME = "zero_vault_native_secure_material"
    private const val ACTIVE_ACCOUNT_KEY = "active-account-id"
    private const val PENDING_PRIVATE_KEY = "pending-device-private"
    private const val PENDING_DEVICE_CREDENTIAL = "pending-device-credential"
    private const val PENDING_DEVICE_ID = "pending-device-id"
    private const val PENDING_EMAIL_HASH = "pending-device-email-hash"
    private const val PENDING_PUBLIC_KEY = "pending-device-public"
    private const val PENDING_FINGERPRINT = "pending-device-fingerprint"
    private const val PENDING_RECOVERY_EMAIL_HASH = "pending-recovery-email-hash"
    private const val PENDING_RECOVERY_ACCOUNT_HASH = "pending-recovery-account-hash"
    private const val PENDING_RECOVERY_CODE = "pending-recovery-code"
    private const val PENDING_RECOVERY_PACKET = "pending-recovery-packet"
    private const val PENDING_RECOVERY_SIGNING_PUBLIC_KEY = "pending-recovery-signing-public-key"
  }
}

private fun SharedPreferences.Editor.commitOrThrow() {
  if (!commit()) {
    throw VaultRepositoryException("SECURE_STORAGE_FAILURE", "Protected device material could not be persisted")
  }
}

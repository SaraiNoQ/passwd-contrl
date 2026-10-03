package expo.modules.zerovault

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import java.security.KeyStore
import java.security.ProviderException
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class WrappedSecret(
  val iv: ByteArray,
  val ciphertext: ByteArray,
) {
  fun encode(): ByteArray {
    require(iv.size in 12..32 && ciphertext.isNotEmpty())
    return byteArrayOf(1, iv.size.toByte()) + iv + ciphertext
  }

  companion object {
    fun decode(value: ByteArray): WrappedSecret {
      require(value.size >= 2 + 12 + 16 && value[0] == 1.toByte()) { "Invalid wrapped secret" }
      val ivLength = value[1].toInt() and 0xff
      require(ivLength in 12..32 && value.size > 2 + ivLength) { "Invalid wrapped secret" }
      return WrappedSecret(
        iv = value.copyOfRange(2, 2 + ivLength),
        ciphertext = value.copyOfRange(2 + ivLength, value.size),
      )
    }
  }
}

class AndroidKeyStore {
  private val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

  fun wrap(alias: String, plaintext: ByteArray): WrappedSecret {
    val cipher = createEncryptCipher(alias, requireBiometric = false)
    return finishEncryption(cipher, plaintext)
  }

  fun unwrap(alias: String, wrapped: WrappedSecret): ByteArray = try {
    createDecryptCipher(alias, wrapped, requireBiometric = false).doFinal(wrapped.ciphertext)
  } catch (error: Exception) {
    throw mapError(error)
  }

  fun createEncryptCipher(alias: String, requireBiometric: Boolean): Cipher = try {
    Cipher.getInstance(TRANSFORMATION).apply {
      init(Cipher.ENCRYPT_MODE, getOrCreateKey(alias, requireBiometric))
    }
  } catch (error: Exception) {
    throw mapError(error)
  }

  fun createDecryptCipher(
    alias: String,
    wrapped: WrappedSecret,
    requireBiometric: Boolean,
  ): Cipher = try {
    Cipher.getInstance(TRANSFORMATION).apply {
      init(
        Cipher.DECRYPT_MODE,
        getExistingKey(alias, requireBiometric),
        GCMParameterSpec(128, wrapped.iv),
      )
    }
  } catch (error: Exception) {
    throw mapError(error)
  }

  fun finishEncryption(cipher: Cipher, plaintext: ByteArray): WrappedSecret = try {
    WrappedSecret(cipher.iv.copyOf(), cipher.doFinal(plaintext))
  } catch (error: Exception) {
    throw mapError(error)
  }

  fun finishDecryption(cipher: Cipher, ciphertext: ByteArray): ByteArray = try {
    cipher.doFinal(ciphertext)
  } catch (error: Exception) {
    throw mapError(error)
  }

  fun delete(alias: String) {
    runCatching { keyStore.deleteEntry(alias) }
  }

  fun contains(alias: String): Boolean = keyStore.containsAlias(alias)

  private fun getExistingKey(alias: String, requireBiometric: Boolean): SecretKey {
    val key = keyStore.getKey(alias, null) as? SecretKey
      ?: throw VaultRepositoryException("KEY_INVALIDATED", "Device security key is unavailable")
    val expectedPrefix = if (requireBiometric) BIOMETRIC_ALIAS_PREFIX else WRAP_ALIAS_PREFIX
    require(alias.startsWith(expectedPrefix)) { "Keystore alias purpose mismatch" }
    return key
  }

  @Synchronized
  private fun getOrCreateKey(alias: String, requireBiometric: Boolean): SecretKey {
    if (keyStore.containsAlias(alias)) return getExistingKey(alias, requireBiometric)
    val strongBoxKey = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      tryGenerate(alias, requireBiometric, strongBox = true)
    } else {
      null
    }
    if (strongBoxKey != null) return strongBoxKey
    // A provider may leave a partial alias behind after rejecting StrongBox.
    delete(alias)
    return tryGenerate(alias, requireBiometric, strongBox = false)
      ?: throw VaultRepositoryException("KEY_INVALIDATED", "Device security key cannot be created")
  }

  private fun tryGenerate(alias: String, requireBiometric: Boolean, strongBox: Boolean): SecretKey? = try {
    val builder = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setRandomizedEncryptionRequired(true)
      .setUserAuthenticationRequired(requireBiometric)
    // setUnlockedDeviceRequired has destructive platform defects on API 31-34
    // (key creation can fail without a secure lock screen and removing the
    // lock screen can delete the key). API 26-34 are protected by the app's
    // own lock lifecycle and, for biometric aliases, per-use authentication.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      builder.setUnlockedDeviceRequired(true)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && strongBox) {
      builder.setIsStrongBoxBacked(true)
    }
    if (requireBiometric) {
      builder.setInvalidatedByBiometricEnrollment(true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
      } else {
        @Suppress("DEPRECATION")
        builder.setUserAuthenticationValidityDurationSeconds(-1)
      }
    }
    KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).apply {
      init(builder.build())
    }.generateKey()
  } catch (_: ProviderException) {
    if (strongBox) null else throw VaultRepositoryException(
      "KEY_INVALIDATED",
      "Device security key cannot be created",
    )
  }

  private fun mapError(error: Exception): VaultRepositoryException = when (error) {
    is VaultRepositoryException -> error
    is UserNotAuthenticatedException -> VaultRepositoryException(
      "AUTH_REQUIRED",
      "Biometric authentication is required",
    )
    is KeyPermanentlyInvalidatedException -> VaultRepositoryException(
      "KEY_INVALIDATED",
      "Device security key was invalidated",
    )
    is AEADBadTagException -> VaultRepositoryException(
      "CIPHERTEXT_TAMPERED",
      "Protected device material failed authentication",
    )
    else -> VaultRepositoryException("KEY_INVALIDATED", "Device security key is unavailable")
  }

  companion object {
    const val WRAP_ALIAS_PREFIX = "zero-vault-wrap-v1-"
    const val BIOMETRIC_ALIAS_PREFIX = "zero-vault-biometric-v1-"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
  }
}

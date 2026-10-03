package expo.modules.zerovault

import uniffi.crypto_core.MobileCryptoException
import uniffi.crypto_core.mobileCreateVaultForDevice
import uniffi.crypto_core.mobileCancelRecovery
import uniffi.crypto_core.mobileDecryptItem
import uniffi.crypto_core.mobileDecryptCryptoCoreBackup
import uniffi.crypto_core.mobileDecryptBackup
import uniffi.crypto_core.mobileEncryptBackup
import uniffi.crypto_core.mobileEncryptItem
import uniffi.crypto_core.mobileGenerateDeviceKeypair
import uniffi.crypto_core.mobileGeneratePassword
import uniffi.crypto_core.mobileGenerateRecoveryCode
import uniffi.crypto_core.mobileGenerateRecoveryPacket
import uniffi.crypto_core.mobileGenerateTotp
import uniffi.crypto_core.mobileLockAllVaults
import uniffi.crypto_core.mobileLockVault
import uniffi.crypto_core.mobileOpenDeviceVault
import uniffi.crypto_core.mobileOpenRecoveryV2
import uniffi.crypto_core.mobileOpaqueCancel
import uniffi.crypto_core.mobileOpaqueFinishLogin
import uniffi.crypto_core.mobileOpaqueFinishRegistration
import uniffi.crypto_core.mobileOpaqueStartLogin
import uniffi.crypto_core.mobileOpaqueStartRegistration
import uniffi.crypto_core.mobileProtocolVersion
import uniffi.crypto_core.mobilePrepareRecoveryRotation
import uniffi.crypto_core.mobileRecoveryDiscardProof
import uniffi.crypto_core.mobileRestoreRecoveryPacket
import uniffi.crypto_core.mobileSessionIsValid
import uniffi.crypto_core.mobileShareVaultKey
import uniffi.crypto_core.mobileSignRecoveryFinish
import uniffi.crypto_core.mobileUnlockVault

data class RustDeviceKeyPair(val privateKey: ByteArray, val publicKey: ByteArray)
data class RustNewVault(val sessionHandle: String, val encryptedVaultKey: ByteArray)
data class RustEncryptedItem(val encryptedItemKey: ByteArray, val encryptedPayload: ByteArray)
data class RustOpaqueStart(val stateHandle: String, val request: String)
data class RustOpaqueRegistrationFinish(
  val registrationRecord: String,
  val serverStaticPublicKey: String,
)
data class RustTotp(val code: String, val validForSeconds: Int)
data class RustRecoveryV2Open(
  val sessionHandle: String,
  val recoveryProofHandle: String,
  val signingPublicKey: ByteArray,
)
data class RustRecoveryV2Rotation(
  val recoveryCode: String,
  val encryptedRecoveryPacket: ByteArray,
  val signingPublicKey: ByteArray,
)

interface RustCrypto {
  fun protocolVersion(): Int
  fun opaqueStartLogin(password: String, clientIdentifier: String, serverIdentifier: String): RustOpaqueStart
  fun opaqueFinishLogin(stateHandle: String, response: String): String
  fun opaqueStartRegistration(password: String, clientIdentifier: String, serverIdentifier: String): RustOpaqueStart
  fun opaqueFinishRegistration(stateHandle: String, response: String): RustOpaqueRegistrationFinish
  fun opaqueCancel(stateHandle: String)
  fun generateDeviceKeyPair(): RustDeviceKeyPair
  fun createVaultForDevice(devicePublicKey: ByteArray): RustNewVault
  fun shareVaultKey(sessionHandle: String, devicePublicKey: ByteArray): ByteArray
  fun unlockWithPassword(password: String, salt: ByteArray, memoryKiB: Int, iterations: Int, parallelism: Int): String
  fun openDeviceVault(devicePrivateKey: ByteArray, encryptedVaultKey: ByteArray): String
  fun encryptItem(sessionHandle: String, plaintext: ByteArray, itemId: String): RustEncryptedItem
  fun decryptItem(sessionHandle: String, encryptedItemKey: ByteArray, encryptedPayload: ByteArray, itemId: String): ByteArray
  fun encryptBackup(sessionHandle: String, accountId: String, backupId: String, plaintext: ByteArray): ByteArray
  fun decryptBackup(sessionHandle: String, accountId: String, backupId: String, encryptedBackup: ByteArray): ByteArray
  fun decryptCryptoCoreBackup(
    password: String,
    salt: ByteArray,
    memoryKiB: Int,
    iterations: Int,
    parallelism: Int,
    encryptedSnapshot: ByteArray,
  ): ByteArray
  fun generateRecoveryCode(): String
  fun generateRecoveryPacket(sessionHandle: String, recoveryCode: String): ByteArray
  fun restoreRecoveryPacket(recoveryCode: String, packet: ByteArray): String
  fun openRecoveryV2(recoveryCode: String, packet: ByteArray): RustRecoveryV2Open
  fun prepareRecoveryRotation(sessionHandle: String): RustRecoveryV2Rotation
  fun signRecoveryFinish(recoveryProofHandle: String, transcript: ByteArray): ByteArray
  fun discardRecoveryProof(recoveryProofHandle: String)
  fun cancelRecovery(recoveryProofHandle: String, sessionHandle: String)
  fun isSessionValid(sessionHandle: String): Boolean
  fun lock(sessionHandle: String)
  fun lockAll()
  fun generatePassword(length: Int, upper: Boolean, lower: Boolean, digits: Boolean, symbols: Boolean): String
  fun generateTotp(secretOrUri: String, timestampSeconds: Long): RustTotp
}

class UniFfiRustCrypto : RustCrypto {
  override fun protocolVersion(): Int = rustCall { mobileProtocolVersion().toInt() }
  override fun opaqueStartLogin(
    password: String,
    clientIdentifier: String,
    serverIdentifier: String,
  ): RustOpaqueStart = rustCall {
    mobileOpaqueStartLogin(password, clientIdentifier, serverIdentifier).let {
      RustOpaqueStart(it.stateHandle, it.request)
    }
  }

  override fun opaqueFinishLogin(stateHandle: String, response: String): String = rustCall {
    mobileOpaqueFinishLogin(stateHandle, response).finishLoginRequest
  }

  override fun opaqueStartRegistration(
    password: String,
    clientIdentifier: String,
    serverIdentifier: String,
  ): RustOpaqueStart = rustCall {
    mobileOpaqueStartRegistration(password, clientIdentifier, serverIdentifier).let {
      RustOpaqueStart(it.stateHandle, it.request)
    }
  }

  override fun opaqueFinishRegistration(
    stateHandle: String,
    response: String,
  ): RustOpaqueRegistrationFinish = rustCall {
    mobileOpaqueFinishRegistration(stateHandle, response).let {
      RustOpaqueRegistrationFinish(
        it.registrationRecord,
        it.serverStaticPublicKey,
      )
    }
  }

  override fun opaqueCancel(stateHandle: String) = rustCall { mobileOpaqueCancel(stateHandle) }

  override fun generateDeviceKeyPair(): RustDeviceKeyPair = rustCall {
    mobileGenerateDeviceKeypair().let { RustDeviceKeyPair(it.privateKey, it.publicKey) }
  }

  override fun createVaultForDevice(devicePublicKey: ByteArray): RustNewVault = rustCall {
    mobileCreateVaultForDevice(devicePublicKey).let {
      RustNewVault(it.sessionHandle, it.encryptedVaultKey)
    }
  }

  override fun shareVaultKey(sessionHandle: String, devicePublicKey: ByteArray): ByteArray = rustCall {
    mobileShareVaultKey(sessionHandle, devicePublicKey)
  }

  override fun unlockWithPassword(
    password: String,
    salt: ByteArray,
    memoryKiB: Int,
    iterations: Int,
    parallelism: Int,
  ): String = rustCall {
    require(memoryKiB >= 0 && iterations >= 0 && parallelism >= 0)
    mobileUnlockVault(
      password,
      salt,
      memoryKiB.toUInt(),
      iterations.toUInt(),
      parallelism.toUInt(),
    )
  }

  override fun openDeviceVault(devicePrivateKey: ByteArray, encryptedVaultKey: ByteArray): String =
    rustCall { mobileOpenDeviceVault(devicePrivateKey, encryptedVaultKey) }

  override fun encryptItem(
    sessionHandle: String,
    plaintext: ByteArray,
    itemId: String,
  ): RustEncryptedItem = rustCall {
    mobileEncryptItem(sessionHandle, plaintext, itemId).let {
      RustEncryptedItem(it.encryptedItemKey, it.encryptedPayload)
    }
  }

  override fun decryptItem(
    sessionHandle: String,
    encryptedItemKey: ByteArray,
    encryptedPayload: ByteArray,
    itemId: String,
  ): ByteArray = rustCall {
    mobileDecryptItem(sessionHandle, encryptedItemKey, encryptedPayload, itemId)
  }

  override fun encryptBackup(
    sessionHandle: String,
    accountId: String,
    backupId: String,
    plaintext: ByteArray,
  ): ByteArray = rustCall { mobileEncryptBackup(sessionHandle, accountId, backupId, plaintext) }

  override fun decryptBackup(
    sessionHandle: String,
    accountId: String,
    backupId: String,
    encryptedBackup: ByteArray,
  ): ByteArray = rustCall { mobileDecryptBackup(sessionHandle, accountId, backupId, encryptedBackup) }

  override fun decryptCryptoCoreBackup(
    password: String,
    salt: ByteArray,
    memoryKiB: Int,
    iterations: Int,
    parallelism: Int,
    encryptedSnapshot: ByteArray,
  ): ByteArray = rustCall {
    require(memoryKiB >= 0 && iterations >= 0 && parallelism >= 0)
    mobileDecryptCryptoCoreBackup(
      password,
      salt,
      memoryKiB.toUInt(),
      iterations.toUInt(),
      parallelism.toUInt(),
      encryptedSnapshot,
    )
  }

  override fun generateRecoveryCode(): String = rustCall { mobileGenerateRecoveryCode() }

  override fun generateRecoveryPacket(sessionHandle: String, recoveryCode: String): ByteArray =
    rustCall { mobileGenerateRecoveryPacket(sessionHandle, recoveryCode) }

  override fun restoreRecoveryPacket(recoveryCode: String, packet: ByteArray): String = rustCall {
    mobileRestoreRecoveryPacket(recoveryCode, packet)
  }

  override fun openRecoveryV2(recoveryCode: String, packet: ByteArray): RustRecoveryV2Open = rustCall {
    mobileOpenRecoveryV2(recoveryCode, packet).let {
      RustRecoveryV2Open(it.sessionHandle, it.recoveryProofHandle, it.signingPublicKey)
    }
  }

  override fun prepareRecoveryRotation(sessionHandle: String): RustRecoveryV2Rotation = rustCall {
    mobilePrepareRecoveryRotation(sessionHandle).let {
      RustRecoveryV2Rotation(it.recoveryCode, it.encryptedRecoveryPacket, it.signingPublicKey)
    }
  }

  override fun signRecoveryFinish(recoveryProofHandle: String, transcript: ByteArray): ByteArray =
    rustCall { mobileSignRecoveryFinish(recoveryProofHandle, transcript) }

  override fun discardRecoveryProof(recoveryProofHandle: String) = rustCall {
    mobileRecoveryDiscardProof(recoveryProofHandle)
  }

  override fun cancelRecovery(recoveryProofHandle: String, sessionHandle: String) = rustCall {
    mobileCancelRecovery(recoveryProofHandle, sessionHandle)
  }

  override fun isSessionValid(sessionHandle: String): Boolean = rustCall {
    mobileSessionIsValid(sessionHandle)
  }

  override fun lock(sessionHandle: String) = rustCall { mobileLockVault(sessionHandle) }

  override fun lockAll() = rustCall { mobileLockAllVaults() }

  override fun generatePassword(
    length: Int,
    upper: Boolean,
    lower: Boolean,
    digits: Boolean,
    symbols: Boolean,
  ): String = rustCall {
    require(length >= 0)
    mobileGeneratePassword(length.toUInt(), upper, lower, digits, symbols)
  }

  override fun generateTotp(secretOrUri: String, timestampSeconds: Long): RustTotp = rustCall {
    require(timestampSeconds >= 0)
    mobileGenerateTotp(secretOrUri, timestampSeconds.toULong()).let {
      RustTotp(it.code, it.validForSeconds.toInt())
    }
  }

  private fun <T> rustCall(block: () -> T): T = try {
    block()
  } catch (error: MobileCryptoException) {
    throw error.toRepositoryException()
  } catch (error: IllegalArgumentException) {
    throw VaultRepositoryException("INVALID_ARGUMENT", "Invalid native crypto request")
  } catch (error: LinkageError) {
    throw VaultRepositoryException("NATIVE_UNAVAILABLE", "Rust crypto library is unavailable")
  }
}

private fun MobileCryptoException.toRepositoryException(): VaultRepositoryException = when (this) {
  is MobileCryptoException.InvalidKdfParams -> VaultRepositoryException("INVALID_KDF_PARAMS", "Invalid key derivation parameters")
  is MobileCryptoException.InvalidInput -> VaultRepositoryException("INVALID_ARGUMENT", "Invalid native crypto request")
  is MobileCryptoException.InvalidEnvelope -> VaultRepositoryException("UNSUPPORTED_VAULT_FORMAT", "Ciphertext envelope is invalid")
  is MobileCryptoException.AuthenticationFailed -> VaultRepositoryException("AUTH_INVALID", "Authentication failed")
  is MobileCryptoException.InvalidSession -> VaultRepositoryException("VAULT_LOCKED", "Vault is locked")
  is MobileCryptoException.OpaqueStateExpired -> VaultRepositoryException("AUTH_EXPIRED", "Authentication operation expired")
  is MobileCryptoException.RecoveryProofExpired -> VaultRepositoryException("RECOVERY_AUTH_EXPIRED", "Recovery authorization expired")
  is MobileCryptoException.Internal -> VaultRepositoryException("CRYPTO_FAILURE", "Native cryptographic operation failed")
}

package expo.modules.zerovault

import android.content.Context
import java.io.File
import java.io.RandomAccessFile
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicLong

/**
 * Cross-process revocation generation for native vault sessions.
 *
 * Rust sessions are process-local, so locking one process cannot directly erase
 * another process' Rust memory. Every session is therefore bound to this
 * generation and rejected after any process advances it.
 */
interface VaultSessionGenerationStore {
  fun current(): Long
  fun advance(): Long
}

internal class FileVaultSessionGenerationStore private constructor(
  private val file: File,
) : VaultSessionGenerationStore {
  constructor(context: Context) : this(
    File(context.noBackupFilesDir, FILE_NAME),
  )

  override fun current(): Long = withLockedFile { access ->
    readOrInitialize(access)
  }

  override fun advance(): Long = withLockedFile { access ->
    val current = readOrInitialize(access)
    check(current < Long.MAX_VALUE) { "Vault session generation is exhausted" }
    val next = current + 1

    // Persist an invalid marker first. If the final write fails, every process
    // fails closed instead of continuing to accept the previous generation.
    writeAndSync(access, INVALID_MARKER)
    writeAndSync(access, next.toString())
    next
  }

  private fun <T> withLockedFile(block: (RandomAccessFile) -> T): T =
    synchronized(PROCESS_FILE_LOCK) {
      file.parentFile?.let { parent ->
        check(parent.exists() || parent.mkdirs()) { "Vault session generation directory is unavailable" }
      }
      RandomAccessFile(file, "rw").use { access ->
        access.channel.lock().use {
          block(access)
        }
      }
    }

  private fun readOrInitialize(access: RandomAccessFile): Long {
    if (access.length() == 0L) {
      writeAndSync(access, INITIAL_GENERATION.toString())
      return INITIAL_GENERATION
    }
    check(access.length() <= MAX_GENERATION_BYTES) { "Vault session generation is invalid" }
    access.seek(0)
    val encoded = ByteArray(access.length().toInt())
    access.readFully(encoded)
    val value = encoded.toString(StandardCharsets.US_ASCII)
    check(value.matches(GENERATION_PATTERN)) { "Vault session generation is invalid" }
    return value.toLongOrNull()
      ?: throw IllegalStateException("Vault session generation is invalid")
  }

  private fun writeAndSync(access: RandomAccessFile, value: String) {
    val encoded = value.toByteArray(StandardCharsets.US_ASCII)
    access.seek(0)
    access.write(encoded)
    access.setLength(encoded.size.toLong())
    access.channel.force(true)
  }

  internal companion object {
    private const val FILE_NAME = "zero-vault-session-generation"
    private const val INITIAL_GENERATION = 0L
    private const val MAX_GENERATION_BYTES = 19L
    private const val INVALID_MARKER = "!"
    private val GENERATION_PATTERN = Regex("0|[1-9][0-9]{0,18}")
    private val PROCESS_FILE_LOCK = Any()

    internal fun forTest(file: File): FileVaultSessionGenerationStore =
      FileVaultSessionGenerationStore(file)
  }
}

internal class InMemoryVaultSessionGenerationStore(
  initial: Long = 0,
) : VaultSessionGenerationStore {
  private val generation = AtomicLong(initial)

  override fun current(): Long = generation.get()

  override fun advance(): Long = generation.updateAndGet { value ->
    check(value < Long.MAX_VALUE) { "Vault session generation is exhausted" }
    value + 1
  }
}

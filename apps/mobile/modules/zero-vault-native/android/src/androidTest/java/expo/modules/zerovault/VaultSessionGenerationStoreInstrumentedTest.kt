package expo.modules.zerovault

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VaultSessionGenerationStoreInstrumentedTest {
  private val context: Context = ApplicationProvider.getApplicationContext()

  @Test
  fun independentStoresObserveRevocationImmediately() = withGenerationFile { file ->
    val mainProcess = FileVaultSessionGenerationStore.forTest(file)
    val systemProcess = FileVaultSessionGenerationStore.forTest(file)

    assertEquals(0L, mainProcess.current())
    assertEquals(1L, mainProcess.advance())
    assertEquals(1L, systemProcess.current())
    assertEquals(2L, systemProcess.advance())
    assertEquals(2L, mainProcess.current())
  }

  @Test
  fun concurrentAdvancesCannotLoseARevocation() = withGenerationFile { file ->
    val workers = Executors.newFixedThreadPool(8)
    try {
      val advances = (1..64).map {
        Callable { FileVaultSessionGenerationStore.forTest(file).advance() }
      }
      val observed = workers.invokeAll(advances).map { it.get() }

      assertEquals((1L..64L).toSet(), observed.toSet())
      assertEquals(64L, FileVaultSessionGenerationStore.forTest(file).current())
    } finally {
      workers.shutdownNow()
    }
  }

  @Test
  fun malformedGenerationFailsClosed() = withGenerationFile { file ->
    file.writeText("!")

    assertThrows(IllegalStateException::class.java) {
      FileVaultSessionGenerationStore.forTest(file).current()
    }
  }

  private fun withGenerationFile(block: (File) -> Unit) {
    val file = File(context.noBackupFilesDir, "session-generation-test-${UUID.randomUUID()}")
    try {
      block(file)
    } finally {
      file.delete()
    }
  }
}

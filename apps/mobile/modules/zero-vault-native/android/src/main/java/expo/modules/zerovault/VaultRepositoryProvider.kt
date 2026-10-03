package expo.modules.zerovault

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Process-wide native source of truth used by RN, Autofill and Credential Provider. */
object VaultRepositoryProvider {
  @Volatile private var instance: VaultRepository? = null
  @Volatile private var initialization: FutureTask<VaultRepository>? = null

  fun get(context: Context): VaultRepository {
    instance?.let { return it }
    val applicationContext = context.applicationContext
    val task = synchronized(this) {
      instance?.let { return it }
      initialization ?: FutureTask {
        create(applicationContext).also { installLifecycleLock(applicationContext, it) }
      }.also { created ->
        initialization = created
        if (!Handler(Looper.getMainLooper()).post(created)) {
          initialization = null
          throw VaultRepositoryException("NATIVE_UNAVAILABLE", "Native lifecycle protection is unavailable")
        }
      }
    }
    // FutureTask.run() is idempotent. This avoids deadlocking the main thread
    // if a system service races the RN call before the posted task executes.
    if (Looper.myLooper() == Looper.getMainLooper()) task.run()
    val repository = try {
      task.get(10, TimeUnit.SECONDS)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      throw VaultRepositoryException("NATIVE_UNAVAILABLE", "Native vault initialization was interrupted")
    } catch (_: TimeoutException) {
      // Keep the single in-flight task so a later caller cannot register a
      // duplicate lifecycle observer or receiver.
      throw VaultRepositoryException("NATIVE_UNAVAILABLE", "Native vault initialization timed out")
    } catch (_: ExecutionException) {
      synchronized(this) { if (initialization === task) initialization = null }
      throw VaultRepositoryException("NATIVE_UNAVAILABLE", "Native vault initialization failed")
    } catch (_: CancellationException) {
      synchronized(this) { if (initialization === task) initialization = null }
      throw VaultRepositoryException("NATIVE_UNAVAILABLE", "Native vault initialization failed")
    }
    return synchronized(this) {
      (instance ?: repository.also { instance = it }).also {
        if (initialization === task) initialization = null
      }
    }
  }

  internal fun replaceForTests(repository: VaultRepository?) = synchronized(this) {
    initialization = null
    instance = repository
  }

  private fun create(context: Context): VaultRepository = DefaultVaultRepository(
    database = ZeroVaultDatabase.open(context),
    rust = UniFfiRustCrypto(),
    keyStore = AndroidKeyStore(),
    secureMaterials = SecureMaterialStore(context),
    biometricGate = BiometricGate(),
    sessionGenerationStore = FileVaultSessionGenerationStore(context),
  )

  private fun installLifecycleLock(context: Context, repository: VaultRepository) {
    val lifecycle = ProcessLifecycleOwner.get().lifecycle
    val observer = object : DefaultLifecycleObserver {
      override fun onStop(owner: LifecycleOwner) = repository.lockAll()
    }
    lifecycle.addObserver(observer)
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == Intent.ACTION_SCREEN_OFF || intent?.action == Intent.ACTION_SHUTDOWN) {
          repository.lockAll()
        }
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_SHUTDOWN)
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        @Suppress("DEPRECATION")
        context.registerReceiver(receiver, filter)
      }
    } catch (error: Throwable) {
      lifecycle.removeObserver(observer)
      throw error
    }
  }
}

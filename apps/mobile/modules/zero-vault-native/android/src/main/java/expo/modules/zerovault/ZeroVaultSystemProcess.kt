package expo.modules.zerovault

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Process
import java.io.File

/** Identifies the native-only process used by Android credential system surfaces. */
object ZeroVaultSystemProcess {
  private const val PROCESS_SUFFIX = ":vault_system"

  fun isCurrent(context: Context): Boolean =
    currentProcessName(context) == context.packageName + PROCESS_SUFFIX

  private fun currentProcessName(context: Context): String? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return Application.getProcessName()
    val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
    val pid = Process.myPid()
    return manager?.runningAppProcesses?.firstOrNull { it.pid == pid }?.processName
      ?: runCatching {
        File("/proc/self/cmdline").readText().substringBefore('\u0000').takeIf { it.isNotEmpty() }
      }.getOrNull()
  }
}

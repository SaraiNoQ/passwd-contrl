# UniFFI resolves generated bridge symbols reflectively through JNA. Keep the
# public binding surface in release builds; the Rust shared library is still
# stripped and its separate native debug symbols are archived by the release gate.
-keep class uniffi.crypto_core.** { *; }
-keep class com.sun.jna.** { *; }
-dontwarn com.sun.jna.**

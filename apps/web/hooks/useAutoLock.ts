"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type UseAutoLock = ReturnType<typeof useAutoLock>;

export function useAutoLock(autoLockTimeoutSec: number, unlocked: boolean, onLock: () => void) {
  const autoLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLockStartRef = useRef(Date.now());
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [autoLockRemaining, setAutoLockRemaining] = useState(autoLockTimeoutSec * 1000);

  const autoLockMs = autoLockTimeoutSec * 1000;

  const resetAutoLock = useCallback(() => {
    if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
    autoLockStartRef.current = Date.now();
    setAutoLockRemaining(autoLockMs);

    if (unlocked) {
      autoLockTimer.current = setTimeout(() => {
        onLock();
      }, autoLockMs);
    }
  }, [autoLockMs, unlocked, onLock]);

  // Countdown interval
  useEffect(() => {
    if (!unlocked) {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      return;
    }
    countdownRef.current = setInterval(() => {
      const elapsed = Date.now() - autoLockStartRef.current;
      setAutoLockRemaining(Math.max(0, autoLockMs - elapsed));
    }, 1000);
    return () => {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    };
  }, [unlocked, autoLockMs]);

  // Activity listeners
  useEffect(() => {
    if (!unlocked) return;
    const activity = () => resetAutoLock();
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    window.addEventListener("wheel", activity, { passive: true });
    window.addEventListener("touchstart", activity, { passive: true });
    resetAutoLock();
    return () => {
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("wheel", activity);
      window.removeEventListener("touchstart", activity);
      if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
    };
  }, [unlocked, resetAutoLock]);

  const forceLock = useCallback(() => {
    if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
    onLock();
  }, [onLock]);

  const updateRemaining = useCallback((seconds: number) => {
    setAutoLockRemaining(seconds * 1000);
    autoLockStartRef.current = Date.now();
  }, []);

  return { autoLockRemaining, resetAutoLock, forceLock, updateRemaining };
}

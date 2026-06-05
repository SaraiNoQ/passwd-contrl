"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearOfflineQueue,
  dequeueOfflineMutations,
  enqueueOfflineMutation,
  hasOfflineMutations,
  peekAllEntries,
  writeAllEntries,
  type OfflineMutationEntry,
} from "../lib/offline-queue";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 5;
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 30000]; // 1s, 2s, 4s, 8s, max 30s
const SUCCESS_BANNER_MS = 5000; // How long the success toast stays visible

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OfflineSyncState {
  /** Whether the browser reports being online. */
  isOnline: boolean;
  /** Number of queue entries that have not yet exceeded retry limit. */
  pendingCount: number;
  /** Number of queue entries that have exceeded retry limit (retryCount >= 5). */
  failedCount: number;
  /** True briefly after a retry cycle completes successfully. Dismiss with dismissRetrySuccess(). */
  showRetrySuccess: boolean;
  /** Dismiss the success banner. */
  dismissRetrySuccess: () => void;
  /** Enqueue a single item mutation for retry. Call inside syncNow on network error. */
  enqueueItem: (itemId: string, type: "upsert" | "delete") => void;
  /** Clear all pending mutations from the queue. Call inside syncNow on success. */
  dequeueAll: () => void;
  /** Manually trigger a retry cycle. */
  retryNow: () => void;
  /** Clear all failed entries (retryCount >= MAX_RETRIES). */
  clearFailed: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOfflineSync(
  syncFn: () => Promise<void>
): OfflineSyncState {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [showRetrySuccess, setShowRetrySuccess] = useState(false);

  // Stable ref to the latest syncFn so retry loop always calls current version
  const syncFnRef = useRef(syncFn);
  syncFnRef.current = syncFn;

  // Guards to prevent overlapping retry cycles
  const retryingRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -------------------------------------------------------------------------
  // Refresh React state from localStorage queue
  // -------------------------------------------------------------------------

  const refreshCounts = useCallback(() => {
    const entries = peekAllEntries();
    const now = Date.now();
    const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
    const active = entries.filter(
      (e) => now - new Date(e.timestamp).getTime() < EXPIRY_MS
    );
    setPendingCount(
      active.filter((e) => e.retryCount < MAX_RETRIES).length
    );
    setFailedCount(
      active.filter((e) => e.retryCount >= MAX_RETRIES).length
    );
  }, []);

  // Refresh on mount so counts are accurate before any interaction
  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  // -------------------------------------------------------------------------
  // Monitor online / offline status
  // -------------------------------------------------------------------------

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Retry loop shared by auto-retry (on back-online) and manual retry
  // -------------------------------------------------------------------------

  const runRetryCycle = useCallback(async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;

    let succeeded = false;

    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        // Snapshot the current queue before calling syncFn
        const beforeEntries = dequeueOfflineMutations();
        if (beforeEntries.length === 0) {
          // Nothing to retry
          return;
        }

        // Call syncFn — it will enqueue items on failure, clear on success
        try {
          await syncFnRef.current();
        } catch {
          // syncFn threw unexpectedly — treat as failure
        }

        // Check if syncFn enqueued items (failure) or cleared them (success)
        if (!hasOfflineMutations()) {
          // Queue is empty — sync succeeded
          succeeded = true;
          return;
        }

        // Sync failed — items were re-enqueued by syncFn.
        // Get the current batch and increment retryCount for next attempt.
        const afterEntries = dequeueOfflineMutations();

        if (attempt < MAX_RETRIES - 1) {
          // Re-enqueue with incremented retryCount
          const incremented: OfflineMutationEntry[] = afterEntries.map(
            (entry) => ({
              ...entry,
              retryCount: entry.retryCount + 1,
            })
          );
          writeAllEntries(incremented);

          // Exponential backoff before next attempt
          const delay = BACKOFF_DELAYS_MS[attempt] ?? 30000;
          await new Promise<void>((resolve) => {
            retryTimerRef.current = setTimeout(resolve, delay);
          });
        } else {
          // All retries exhausted — mark entries as failed
          const failed: OfflineMutationEntry[] = afterEntries.map(
            (entry) => ({
              ...entry,
              retryCount: MAX_RETRIES,
            })
          );
          writeAllEntries(failed);
        }
      }
    } finally {
      retryingRef.current = false;
      refreshCounts();

      // Show success banner if retry cycle succeeded
      if (succeeded) {
        setShowRetrySuccess(true);
        if (successTimerRef.current) {
          clearTimeout(successTimerRef.current);
        }
        successTimerRef.current = setTimeout(() => {
          setShowRetrySuccess(false);
        }, SUCCESS_BANNER_MS);
      }
    }
  }, [refreshCounts]);

  // -------------------------------------------------------------------------
  // Auto-retry when coming back online
  // -------------------------------------------------------------------------

  const prevOnlineRef = useRef(isOnline);

  useEffect(() => {
    const wasOffline = !prevOnlineRef.current;
    prevOnlineRef.current = isOnline;

    // Only trigger auto-retry when transitioning from offline to online
    if (isOnline && wasOffline) {
      if (!hasOfflineMutations()) {
        refreshCounts();
        return;
      }
      // Small delay to let the network stabilize
      const initTimer = setTimeout(() => {
        void runRetryCycle();
      }, 500);
      return () => clearTimeout(initTimer);
    }
  }, [isOnline, runRetryCycle, refreshCounts]);

  // -------------------------------------------------------------------------
  // Public API — stable callbacks
  // -------------------------------------------------------------------------

  const enqueueItem = useCallback(
    (itemId: string, type: "upsert" | "delete") => {
      enqueueOfflineMutation({
        type,
        itemId,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });
      refreshCounts();
    },
    [refreshCounts]
  );

  const dequeueAll = useCallback(() => {
    clearOfflineQueue();
    refreshCounts();
  }, [refreshCounts]);

  const retryNow = useCallback(() => {
    if (!isOnline) return;
    if (!hasOfflineMutations()) {
      refreshCounts();
      return;
    }
    void runRetryCycle();
  }, [isOnline, runRetryCycle, refreshCounts]);

  const clearFailed = useCallback(() => {
    const entries = peekAllEntries();
    const remaining = entries.filter((e) => e.retryCount < MAX_RETRIES);
    writeAllEntries(remaining);
    refreshCounts();
  }, [refreshCounts]);

  const dismissRetrySuccess = useCallback(() => {
    setShowRetrySuccess(false);
  }, []);

  // -------------------------------------------------------------------------
  // Cleanup timers on unmount
  // -------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  return {
    isOnline,
    pendingCount,
    failedCount,
    showRetrySuccess,
    dismissRetrySuccess,
    enqueueItem,
    dequeueAll,
    retryNow,
    clearFailed,
  };
}

"use client";

import { useCallback, useState } from "react";
import { checkPasswordBreach } from "../lib/breach-check";

export interface BreachItem {
  id: string;
  password: string;
}

export interface BreachCheckState {
  /** Whether a breach check is currently running. */
  checking: boolean;
  /** Current progress of the running check. */
  progress: { checked: number; total: number };
  /** Set of credential IDs whose passwords were found in a breach. */
  breachedIds: Set<string>;
  /** Map from credential ID → breach occurrence count. */
  breachCounts: Map<string, number>;
  /** Start a breach check for the given items. */
  startCheck: (items: BreachItem[]) => Promise<void>;
  /** Reset all breach-check state back to initial. */
  reset: () => void;
}

export function useBreachCheck(): BreachCheckState {
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState({ checked: 0, total: 0 });
  const [breachedIds, setBreachedIds] = useState<Set<string>>(new Set());
  const [breachCounts, setBreachCounts] = useState<Map<string, number>>(new Map());

  const startCheck = useCallback(async (items: BreachItem[]) => {
    setChecking(true);
    setProgress({ checked: 0, total: items.length });
    setBreachedIds(new Set());
    setBreachCounts(new Map());

    const newBreached = new Set<string>();
    const newCounts = new Map<string, number>();

    const BATCH_SIZE = 3;
    const DELAY_MS = 1500;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async ({ id, password }) => {
          const result = await checkPasswordBreach(password);
          return { id, ...result };
        })
      );

      for (const { id, breached, count } of batchResults) {
        if (breached) {
          newBreached.add(id);
          newCounts.set(id, count);
        }
      }

      const checked = Math.min(i + BATCH_SIZE, items.length);
      setProgress({ checked, total: items.length });
      setBreachedIds(new Set(newBreached));
      setBreachCounts(new Map(newCounts));

      // Rate-limit pause between batches (skip after the last batch).
      if (i + BATCH_SIZE < items.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    setChecking(false);
  }, []);

  const reset = useCallback(() => {
    setChecking(false);
    setProgress({ checked: 0, total: 0 });
    setBreachedIds(new Set());
    setBreachCounts(new Map());
  }, []);

  return {
    checking,
    progress,
    breachedIds,
    breachCounts,
    startCheck,
    reset,
  };
}

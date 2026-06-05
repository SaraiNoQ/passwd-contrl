"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MascotState = "sleeping" | "idle" | "walking" | "working" | "excited" | "error";

export interface MascotMessage {
  text: string;
  type: "info" | "success" | "warning" | "error" | "fun";
}

interface UseMascotOptions {
  isLocked: boolean;
  isSyncing: boolean;
  hasError: boolean;
  isOnline: boolean;
  lastCopiedAt: number | null;
  itemCount: number;
}

const FUN_MESSAGES = [
  "像素风是最棒的！",
  "你的密码很安全~",
  "今天也要元气满满！",
  "区块链永不眠...",
  "记得备份恢复码哦！",
  "锁定状态，安心离开~",
  "数据已加密，放心！",
  "喵~ 我在守护你的密码！",
  "8-bit 永远的神！",
  "零知识 = 零担忧",
  "我是你的密码守护兽！",
  "同步完成，干得漂亮！",
  "你的密码库很健康！",
  "像素即正义！",
  "休息一下，喝杯水吧~",
];

export function useMascot(options: UseMascotOptions) {
  const { isLocked, isSyncing, hasError, isOnline, lastCopiedAt, itemCount } = options;

  const [message, setMessage] = useState<MascotMessage | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSyncing = useRef(isSyncing);
  const prevCopiedAt = useRef(lastCopiedAt);

  // Derive state
  const state: MascotState = (() => {
    if (isLocked && itemCount === 0) return "sleeping";
    if (isLocked) return "idle";
    if (!isOnline) return "walking";
    if (isSyncing) return "working";
    if (hasError) return "error";
    return "idle";
  })();

  const showMessage = useCallback((msg: MascotMessage) => {
    setMessage(msg);
    setDismissed(false);
    if (msgTimer.current) clearTimeout(msgTimer.current);
    msgTimer.current = setTimeout(() => setDismissed(true), 4000);
  }, []);

  const dismissMessage = useCallback(() => {
    setDismissed(true);
    if (msgTimer.current) clearTimeout(msgTimer.current);
  }, []);

  // React to state changes
  useEffect(() => {
    // Syncing started
    if (isSyncing && !prevSyncing.current) {
      showMessage({ text: "正在同步数据...", type: "info" });
    }
    // Syncing finished
    if (!isSyncing && prevSyncing.current) {
      showMessage({ text: "同步完成！", type: "success" });
    }
    prevSyncing.current = isSyncing;
  }, [isSyncing, showMessage]);

  // React to clipboard copy
  useEffect(() => {
    if (lastCopiedAt && lastCopiedAt !== prevCopiedAt.current) {
      const randomMsg = FUN_MESSAGES[Math.floor(Math.random() * FUN_MESSAGES.length)];
      showMessage({ text: randomMsg!, type: "fun" });
    }
    prevCopiedAt.current = lastCopiedAt;
  }, [lastCopiedAt, showMessage]);

  // React to errors
  useEffect(() => {
    if (hasError) {
      showMessage({ text: "出错了，请检查...", type: "error" });
    }
  }, [hasError, showMessage]);

  // Idle random messages
  useEffect(() => {
    if (state === "idle" && !message) {
      const scheduleRandom = () => {
        idleTimer.current = setTimeout(() => {
          const randomMsg = FUN_MESSAGES[Math.floor(Math.random() * FUN_MESSAGES.length)];
          showMessage({ text: randomMsg!, type: "fun" });
          scheduleRandom();
        }, 45000 + Math.random() * 30000);
      };
      scheduleRandom();
    }
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [state, message, showMessage]);

  // Show welcome message when vault is unlocked with items
  useEffect(() => {
    if (!isLocked && itemCount > 0 && state === "idle") {
      const timer = setTimeout(() => {
        showMessage({
          text: `守护着 ${itemCount} 个凭据，一切正常！`,
          type: "info",
        });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isLocked, itemCount, state, showMessage]);

  const resolvedMessage = dismissed || !message ? null : message;

  return { state, message: resolvedMessage, dismissMessage };
}

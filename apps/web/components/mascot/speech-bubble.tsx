"use client";

import { cn } from "../../lib/utils";
import type { MascotMessage } from "../../hooks/useMascot";
import styles from "./speech-bubble.module.css";

interface SpeechBubbleProps {
  message: MascotMessage;
  onDismiss: () => void;
}

export function SpeechBubble({ message, onDismiss }: SpeechBubbleProps) {
  return (
    <button
      className={cn(styles.bubble, styles[message.type])}
      type="button"
      onClick={onDismiss}
      aria-label={`关闭提示：${message.text}`}
    >
      <span className={styles.messageText}>{message.text}</span>
      <span className={styles.dismissHint}>点击关闭</span>
    </button>
  );
}

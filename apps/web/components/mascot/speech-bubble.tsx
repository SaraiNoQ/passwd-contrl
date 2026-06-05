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
    <div className={cn(styles.bubble, styles[message.type])} role="status" aria-live="polite">
      {message.text}
      <div className={styles.dismissHint}>点击关闭</div>
    </div>
  );
}

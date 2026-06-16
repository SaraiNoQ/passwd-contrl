"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Copy, Check } from "lucide-react";
import { generateTotp } from "../lib/totp";
import styles from "./totp-display.module.css";

interface TotpDisplayProps {
  secret: string;
}

export function TotpDisplay({ secret }: TotpDisplayProps) {
  const [code, setCode] = useState("------");
  const [remaining, setRemaining] = useState(30);
  const [copied, setCopied] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null) as MutableRefObject<ReturnType<typeof setInterval> | null>;

  const updateCode = useCallback(async () => {
    try {
      const result = await generateTotp(secret, Date.now());
      setCode(result.code);
      setRemaining(result.remaining);
    } catch {
      setCode("------");
    }
  }, [secret]);

  useEffect(() => {
    void updateCode();
    intervalRef.current = setInterval(() => void updateCode(), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [updateCode]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail
    }
  }, [code]);

  const progress = remaining / 30;
  const isLow = remaining <= 5;
  const formattedCode = `${code.slice(0, 3)} ${code.slice(3)}`;

  return (
    <div className={`${styles.beacon} ${isLow ? styles.beaconExpiring : ""}`}>
      <div className={styles.signal} aria-hidden="true">
        <span className={styles.signalCore} />
        <span className={styles.signalRay} />
      </div>

      <div className={styles.readout}>
        <div className={styles.readoutMeta}>
          <span className={styles.channel}>TOTP BEACON</span>
          <span className={styles.timer}>
            <span className={styles.timerValue}>{remaining}</span>
            秒后换码
          </span>
        </div>

        <output
          className={styles.code}
          aria-label={`当前动态验证码：${code.split("").join(" ")}`}
          aria-live="polite"
          aria-atomic="true"
        >
          {formattedCode}
        </output>

        <progress
          className={styles.progress}
          value={progress}
          max={1}
          aria-label={`验证码剩余 ${remaining} 秒`}
        />
      </div>

      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label={copied ? "验证码已复制" : "复制动态验证码"}
        className={`${styles.copyButton} ${copied ? styles.copyButtonCopied : ""}`}
      >
        {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        <span className={styles.copyLabel}>{copied ? "已复制" : "复制"}</span>
      </button>

      <span className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {copied ? "动态验证码已复制到剪贴板" : ""}
      </span>
    </div>
  );
}

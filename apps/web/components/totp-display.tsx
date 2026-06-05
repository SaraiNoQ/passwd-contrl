"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { generateTotp } from "../lib/totp";

interface TotpDisplayProps {
  secret: string;
}

export function TotpDisplay({ secret }: TotpDisplayProps) {
  const [code, setCode] = useState("------");
  const [remaining, setRemaining] = useState(30);
  const [copied, setCopied] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

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

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {/* Countdown ring */}
      <svg width="36" height="36" viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
        <circle
          cx="18" cy="18" r="15"
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="3"
        />
        <circle
          cx="18" cy="18" r="15"
          fill="none"
          stroke={isLow ? "var(--color-error)" : "var(--color-primary)"}
          strokeWidth="3"
          strokeDasharray={`${progress * 94.25} 94.25`}
          strokeLinecap="round"
          transform="rotate(-90 18 18)"
          style={{ transition: "stroke-dasharray 1s linear" }}
        />
        <text x="18" y="22" textAnchor="middle" fontSize="10" fill="var(--color-text-secondary)">
          {remaining}
        </text>
      </svg>

      {/* Code display */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: 4,
          color: isLow ? "var(--color-error)" : "var(--color-text)",
          transition: "color 0.3s"
        }}
      >
        {code.slice(0, 3)} {code.slice(3)}
      </span>

      {/* Copy button */}
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label="复制验证码"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 4,
          color: copied ? "var(--color-success)" : "var(--color-text-secondary)"
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}

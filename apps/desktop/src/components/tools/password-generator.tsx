"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Copy, Check, Shuffle } from "lucide-react";
import { cn } from "../../lib/utils";
import styles from "./password-generator.module.css";

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

export interface GeneratorOptions {
  length: number;
  includeUpper: boolean;
  includeLower: boolean;
  includeDigits: boolean;
  includeSymbols: boolean;
  excludeSimilar: boolean;
  excludeAmbiguous: boolean;
}

const DEFAULT_OPTIONS: GeneratorOptions = {
  length: 20,
  includeUpper: true,
  includeLower: true,
  includeDigits: true,
  includeSymbols: true,
  excludeSimilar: false,
  excludeAmbiguous: false,
};

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*";

const SIMILAR_CHARS = ["i", "l", "1", "L", "o", "0", "O", "I"];
const AMBIGUOUS_CHARS = ["{", "}", "[", "]", "(", ")", "/", "\\", "'", '"', "`", "~", ",", ";", ".", "<", ">"];

/* ---------------------------------------------------------------------------
   Entropy & strength
   --------------------------------------------------------------------------- */

type StrengthLevel = "weak" | "fair" | "strong" | "very-strong";

interface StrengthInfo {
  level: StrengthLevel;
  label: string;
  percentage: number;
  entropy: number;
}

function computeEntropy(length: number, charsetSize: number): number {
  if (charsetSize <= 0) return 0;
  return length * Math.log2(charsetSize);
}

function getStrength(entropy: number): StrengthInfo {
  if (entropy < 30) {
    return { level: "weak", label: "弱", percentage: 25, entropy };
  }
  if (entropy < 50) {
    return { level: "fair", label: "一般", percentage: 50, entropy };
  }
  if (entropy < 70) {
    return { level: "strong", label: "强", percentage: 75, entropy };
  }
  return { level: "very-strong", label: "非常强", percentage: 100, entropy };
}

/* ---------------------------------------------------------------------------
   Generator logic
   --------------------------------------------------------------------------- */

function buildCharset(opts: GeneratorOptions): string {
  let charset = "";
  if (opts.includeUpper) charset += UPPER;
  if (opts.includeLower) charset += LOWER;
  if (opts.includeDigits) charset += DIGITS;
  if (opts.includeSymbols) charset += SYMBOLS;

  if (opts.excludeSimilar && charset.length > 0) {
    charset = [...charset].filter((c) => !SIMILAR_CHARS.includes(c)).join("");
  }
  if (opts.excludeAmbiguous && charset.length > 0) {
    charset = [...charset].filter((c) => !AMBIGUOUS_CHARS.includes(c)).join("");
  }

  return charset;
}

export function generate(opts: GeneratorOptions): string {
  const charset = buildCharset(opts);
  if (!charset) return "";

  const bytes = new Uint8Array(opts.length);
  crypto.getRandomValues(bytes);

  const charsetArr = [...charset];
  const n = charsetArr.length;
  let result = "";

  for (let i = 0; i < opts.length; i++) {
    const idx = bytes[i]! % n;
    result += charsetArr[idx];
  }

  return result;
}

/* ---------------------------------------------------------------------------
   Component
   --------------------------------------------------------------------------- */

export interface PasswordGeneratorProps {
  /** Called when user clicks "use" - typically to set a form field. */
  onUse?: (password: string) => void;
  /** If true, show a "使用此密码" button. */
  showUseButton?: boolean;
  className?: string;
}

export function PasswordGenerator({ onUse, showUseButton, className }: PasswordGeneratorProps) {
  const [opts, setOpts] = useState<GeneratorOptions>(DEFAULT_OPTIONS);
  const [password, setPassword] = useState<string>(() => generate(DEFAULT_OPTIONS));
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const charset = useMemo(() => buildCharset(opts), [opts]);
  const charsetSize = useMemo(() => new Set(charset).size, [charset]);
  const strength = useMemo(
    () => getStrength(computeEntropy(password.length, charsetSize)),
    [password, charsetSize],
  );
  const strengthToneClass =
    styles[
      `strengthTone${strength.level
        .split("-")
        .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
        .join("")}`
    ] ?? "";

  const optionsValid =
    opts.includeUpper || opts.includeLower || opts.includeDigits || opts.includeSymbols;

  // Regenerate
  const handleRegenerate = useCallback(() => {
    if (!optionsValid) return;
    setPassword(generate(opts));
    setCopied(false);
  }, [opts, optionsValid]);

  const applyOptions = useCallback((next: GeneratorOptions) => {
    setOpts(next);
    if (next.includeUpper || next.includeLower || next.includeDigits || next.includeSymbols) {
      setPassword(generate(next));
    } else {
      setPassword("");
    }
    setCopied(false);
  }, []);

  const setOption = useCallback(
    <K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]) => {
      applyOptions({ ...opts, [key]: value });
    },
    [applyOptions, opts],
  );

  // Copy to clipboard
  const handleCopy = useCallback(async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed
    }
  }, [password]);

  // Use this password (pass to parent)
  const handleUse = useCallback(() => {
    if (password && onUse) {
      onUse(password);
    }
  }, [password, onUse]);

  return (
    <div className={cn(styles.container, className)}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>KEY FORGE</p>
          <h3 className={styles.title}>密码生成器</h3>
        </div>
        <div className={styles.entropyBadge}>
          <span>{Math.round(strength.entropy)}</span>
          <small>位熵</small>
        </div>
      </div>

      <div className={styles.forgeGrid}>
        <section className={styles.outputBay} aria-label="生成的密码">
          <div className={styles.displayArea}>
            <div className={styles.passwordDisplay} aria-live="polite">
              <span className={styles.passwordText}>
                {password || "请至少选择一种字符类型"}
              </span>
            </div>

            <div className={styles.displayActions}>
              <button
                className={styles.actionBtn}
                type="button"
                onClick={handleRegenerate}
                disabled={!optionsValid}
                title="重新生成"
                aria-label="重新生成"
              >
                <Shuffle size={18} />
              </button>
              <button
                className={cn(styles.actionBtn, copied && styles.actionBtnSuccess)}
                type="button"
                onClick={handleCopy}
                disabled={!password}
                title="复制密码"
                aria-label={copied ? "密码已复制" : "复制密码"}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
              {showUseButton && onUse && password ? (
                <button
                  className={styles.actionBtn}
                  type="button"
                  onClick={handleUse}
                  title="使用此密码"
                  aria-label="使用此密码"
                >
                  使用
                </button>
              ) : null}
            </div>
          </div>

          {copied ? (
            <div className={styles.toast} role="status">
              已复制
            </div>
          ) : null}

          <div className={styles.strengthSection}>
            <span className={cn(styles.strengthLabel, strengthToneClass)}>
              {strength.label}
            </span>
            <progress
              className={cn(styles.strengthBar, strengthToneClass)}
              value={strength.percentage}
              max={100}
              aria-label={`密码强度 ${strength.label}，约 ${Math.round(strength.entropy)} 位熵`}
            />
            <span className={styles.entropyLabel}>{charsetSize} 字符池</span>
          </div>
        </section>

        <section className={styles.controlBay} aria-label="密钥材料">
          <div className={styles.optionsSection}>
            <div className={styles.lengthRow}>
              <label className={styles.lengthLabel}>密码长度</label>
              <span className={styles.lengthValue}>{opts.length}</span>
            </div>
            <input
              className={styles.slider}
              type="range"
              aria-label="密码长度"
              min={8}
              max={128}
              value={opts.length}
              onChange={(e) => {
                const length = Number(e.target.value);
                applyOptions({ ...opts, length });
              }}
            />

            <div className={styles.checkboxGrid}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={opts.includeUpper}
                  onChange={(e) => setOption("includeUpper", e.target.checked)}
                />
                大写字母 (A-Z)
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={opts.includeLower}
                  onChange={(e) => setOption("includeLower", e.target.checked)}
                />
                小写字母 (a-z)
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={opts.includeDigits}
                  onChange={(e) => setOption("includeDigits", e.target.checked)}
                />
                数字 (0-9)
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={opts.includeSymbols}
                  onChange={(e) => setOption("includeSymbols", e.target.checked)}
                />
                特殊符号 (!@#$%^&*)
              </label>
            </div>

            <div className={styles.toggleRow}>
              <label className={styles.toggleLabel}>
                <span>排除相似字符</span>
                <input
                  type="checkbox"
                  className={styles.toggle}
                  checked={opts.excludeSimilar}
                  onChange={(e) => setOption("excludeSimilar", e.target.checked)}
                />
                <span className={styles.toggleHint}>i, l, 1, L, o, 0, O</span>
              </label>
              <label className={styles.toggleLabel}>
                <span>排除歧义字符</span>
                <input
                  type="checkbox"
                  className={styles.toggle}
                  checked={opts.excludeAmbiguous}
                  onChange={(e) => setOption("excludeAmbiguous", e.target.checked)}
                />
                <span className={styles.toggleHint}>
                  {"{"}
                  {"}"}[]()/\&apos;&quot;`~,;.&lt;&gt;
                </span>
              </label>
            </div>
          </div>

          {!optionsValid ? (
            <div className={styles.warning} role="alert">
              请至少选择一种字符类型
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Convenience: pre-generate and return a password string
   --------------------------------------------------------------------------- */

export function generatePassword(opts: Partial<GeneratorOptions> = {}): string {
  return generate({ ...DEFAULT_OPTIONS, ...opts });
}

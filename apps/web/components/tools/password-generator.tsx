"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Copy, Check, ChevronDown, Shuffle } from "lucide-react";
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

const HISTORY_MAX = 5;

/* ---------------------------------------------------------------------------
   Entropy & strength
   --------------------------------------------------------------------------- */

type StrengthLevel = "weak" | "fair" | "strong" | "very-strong";

interface StrengthInfo {
  level: StrengthLevel;
  label: string;
  color: string;
  percentage: number;
  entropy: number;
}

function computeEntropy(length: number, charsetSize: number): number {
  if (charsetSize <= 0) return 0;
  return length * Math.log2(charsetSize);
}

function getStrength(entropy: number): StrengthInfo {
  if (entropy < 30) {
    return { level: "weak", label: "弱", color: "var(--color-danger)", percentage: 25, entropy };
  }
  if (entropy < 50) {
    return { level: "fair", label: "一般", color: "var(--color-warning)", percentage: 50, entropy };
  }
  if (entropy < 70) {
    return { level: "strong", label: "强", color: "var(--color-success)", percentage: 75, entropy };
  }
  return { level: "very-strong", label: "非常强", color: "var(--color-primary)", percentage: 100, entropy };
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

function generate(opts: GeneratorOptions): string {
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
}

export function PasswordGenerator({ onUse, showUseButton }: PasswordGeneratorProps) {
  const [opts, setOpts] = useState<GeneratorOptions>(DEFAULT_OPTIONS);
  const [password, setPassword] = useState<string>(() => generate(DEFAULT_OPTIONS));
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<string[]>([]);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const charset = useMemo(() => buildCharset(opts), [opts]);
  const charsetSize = useMemo(() => new Set(charset).size, [charset]);
  const strength = useMemo(() => getStrength(computeEntropy(password.length, charsetSize)), [password, charsetSize]);

  const optionsValid = opts.includeUpper || opts.includeLower || opts.includeDigits || opts.includeSymbols;

  // Regenerate (push current into history first)
  const handleRegenerate = useCallback(() => {
    if (!optionsValid) return;
    if (password) {
      historyRef.current = [password, ...historyRef.current.filter((h) => h !== password)].slice(0, HISTORY_MAX);
    }
    setPassword(generate(opts));
    setCopied(false);
  }, [opts, password, optionsValid]);

  // Handle option change
  const setOption = useCallback(<K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]) => {
    setOpts((prev) => {
      const next = { ...prev, [key]: value };
      return next;
    });
  }, []);

  // Regenerate when options change
  const regenerateOnChange = useCallback(() => {
    if (!optionsValid) return;
    setPassword(generate(opts));
    setCopied(false);
  }, [opts, optionsValid]);

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

  // Select from history
  const handleSelectHistory = useCallback((pw: string) => {
    setPassword(pw);
    setHistoryOpen(false);
    setCopied(false);
  }, []);

  const history = historyRef.current;

  return (
    <div className={`${styles.container} pixel-border pixel-scanlines`}>
      {/* Display area */}
      <div className={styles.displayArea}>
        <div className={styles.passwordDisplay}>
          <span className={styles.passwordText}>{password || "请至少选择一种字符类型"}</span>
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
            aria-label="复制密码"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          {showUseButton && onUse && password ? (
            <button className={styles.useBtn} type="button" onClick={handleUse}>
              使用此密码
            </button>
          ) : null}
        </div>
      </div>

      {/* Copy toast */}
      {copied ? <div className={styles.toast}>已复制</div> : null}

      {/* Strength meter */}
      <div className={styles.strengthSection}>
        <div className={styles.strengthBar}>
          <div
            className={styles.strengthFill}
            style={{ width: `${strength.percentage}%`, backgroundColor: strength.color }}
          />
        </div>
        <span className={styles.strengthLabel} style={{ color: strength.color }}>
          {strength.label}
        </span>
        <span className={styles.entropyLabel}>{Math.round(strength.entropy)} 位熵</span>
      </div>

      {/* Options */}
      <div className={styles.optionsSection}>
        {/* Length slider */}
        <div className={styles.lengthRow}>
          <label className={styles.lengthLabel}>密码长度</label>
          <span className={styles.lengthValue}>{opts.length}</span>
        </div>
        <input
          className={styles.slider}
          type="range"
          min={8}
          max={64}
          value={opts.length}
          onChange={(e) => {
            setOption("length", Number(e.target.value));
            regenerateOnChange();
          }}
        />

        {/* Checkboxes */}
        <div className={styles.checkboxGrid}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={opts.includeUpper}
              onChange={(e) => {
                const val = e.target.checked;
                setOption("includeUpper", val);
                if (val || opts.includeLower || opts.includeDigits || opts.includeSymbols) {
                  regenerateOnChange();
                }
              }}
            />
            大写字母 (A-Z)
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={opts.includeLower}
              onChange={(e) => {
                const val = e.target.checked;
                setOption("includeLower", val);
                if (val || opts.includeUpper || opts.includeDigits || opts.includeSymbols) {
                  regenerateOnChange();
                }
              }}
            />
            小写字母 (a-z)
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={opts.includeDigits}
              onChange={(e) => {
                const val = e.target.checked;
                setOption("includeDigits", val);
                if (val || opts.includeUpper || opts.includeLower || opts.includeSymbols) {
                  regenerateOnChange();
                }
              }}
            />
            数字 (0-9)
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={opts.includeSymbols}
              onChange={(e) => {
                const val = e.target.checked;
                setOption("includeSymbols", val);
                if (val || opts.includeUpper || opts.includeLower || opts.includeDigits) {
                  regenerateOnChange();
                }
              }}
            />
            特殊符号 (!@#$%^&*)
          </label>
        </div>

        {/* Toggle toggles */}
        <div className={styles.toggleRow}>
          <label className={styles.toggleLabel}>
            <span>排除相似字符</span>
            <input
              type="checkbox"
              className={styles.toggle}
              checked={opts.excludeSimilar}
              onChange={(e) => {
                setOption("excludeSimilar", e.target.checked);
                regenerateOnChange();
              }}
            />
            <span className={styles.toggleHint}>i, l, 1, L, o, 0, O</span>
          </label>
          <label className={styles.toggleLabel}>
            <span>排除歧义字符</span>
            <input
              type="checkbox"
              className={styles.toggle}
              checked={opts.excludeAmbiguous}
              onChange={(e) => {
                setOption("excludeAmbiguous", e.target.checked);
                regenerateOnChange();
              }}
            />
            <span className={styles.toggleHint}>&#123;&#125;[]()/\&#39;&quot;`~,;.&lt;&gt;</span>
          </label>
        </div>
      </div>

      {/* History dropdown */}
      {history.length > 0 ? (
        <div className={styles.historySection}>
          <button
            className={styles.historyToggle}
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            历史记录
            <ChevronDown
              size={14}
              className={cn(styles.historyChevron, historyOpen && styles.historyChevronOpen)}
            />
          </button>
          {historyOpen ? (
            <div className={styles.historyDropdown}>
              {history.map((pw, idx) => (
                <button
                  key={`${pw.slice(0, 8)}-${idx}`}
                  className={styles.historyItem}
                  type="button"
                  onClick={() => handleSelectHistory(pw)}
                >
                  <span className={styles.historyPassword}>{pw.slice(0, 32)}{pw.length > 32 ? "..." : ""}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Options validation warning */}
      {!optionsValid ? (
        <div className={styles.warning}>请至少选择一种字符类型</div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Convenience: pre-generate and return a password string
   --------------------------------------------------------------------------- */

export function generatePassword(opts: Partial<GeneratorOptions> = {}): string {
  return generate({ ...DEFAULT_OPTIONS, ...opts });
}

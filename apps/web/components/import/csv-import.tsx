"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  FileText,
  Shield,
  Upload,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { parsePasswordCsv } from "../../lib/csv-import";
import { detectImportFormat, parsePasswordImport, type ImportFormat } from "../../lib/password-import";
import type { ImportLoginRow } from "@zero-vault/shared";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import styles from "./csv-import.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CsvImportProps = {
  loading: boolean;
  importStatus: string;
  onImport: (file: File) => void;
};

type BrowserSource = {
  id: string;
  name: string;
  description: string;
};

type ValidationEntry = {
  row: ImportLoginRow;
  index: number;
  issues: string[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BROWSER_SOURCES: BrowserSource[] = [
  { id: "chrome", name: "Chrome", description: "Google Chrome 密码管理器" },
  { id: "edge", name: "Edge", description: "Microsoft Edge 密码管理器" },
  { id: "firefox", name: "Firefox", description: "Firefox 密码管理器" },
];

const PASSWORD_MANAGER_SOURCES: BrowserSource[] = [
  { id: "bitwarden", name: "Bitwarden", description: "Bitwarden 密码管理器 （未加密导出 JSON）" },
  { id: "1password", name: "1Password", description: "1Password 密码管理器 （CSV 或 1PUX 文件）" },
  { id: "generic-json", name: "通用 JSON", description: "通用 JSON 格式 [{ name, url, username, password, notes }]" },
];

const STEPS = ["选择来源", "选择文件", "预览校验", "确认导入", "导入结果"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findDuplicateRows(rows: ImportLoginRow[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = `${row.origin}::${row.username}`;
    if (seen.has(key)) {
      duplicates += 1;
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CsvImport({ loading, importStatus, onImport }: CsvImportProps) {
  const [step, setStep] = useState(0);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ImportLoginRow[]>([]);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [validationEntries, setValidationEntries] = useState<ValidationEntry[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validation

  const validateRow = useCallback((row: ImportLoginRow, index: number): ValidationEntry => {
    const issues: string[] = [];

    try {
      const url = new URL(row.origin);
      if (url.protocol !== "https:") {
        issues.push("非 HTTPS");
      }
    } catch {
      issues.push("URL 无效");
    }

    if (!row.username || row.username.trim().length === 0) {
      issues.push("缺少用户名");
    }

    if (!row.password || row.password.trim().length === 0) {
      issues.push("缺少密码");
    }

    return { row, index, issues };
  }, []);

  // Summary stats

  const stats = useMemo(() => {
    const total = validationEntries.length;
    const valid = validationEntries.filter((e) => e.issues.length === 0).length;
    const withWarnings = validationEntries.filter(
      (e) => e.issues.some((i) => i === "非 HTTPS"),
    ).length;
    const withErrors = validationEntries.filter(
      (e) => e.issues.some((i) => i !== "非 HTTPS"),
    ).length;
    const duplicates = findDuplicateRows(parsedRows);
    return { total, valid, withWarnings, withErrors, duplicates };
  }, [validationEntries, parsedRows]);

  // File handling

  const handleFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setParseError(null);
      setFileName(file.name);
      setSelectedFile(file);

      try {
        const content = await file.text();
        const format = detectImportFormat(content, file.name);
        if (format === "unknown") {
          setParseError("无法识别文件格式。支持 Bitwarden JSON、1Password CSV/1PUX、浏览器 CSV 和通用 JSON。");
          return;
        }
        const result = parsePasswordImport(content, format);
        setParsedRows(result.rows);
        setRejectedCount(result.rejected);

        const entries = result.rows.map((row, i) => validateRow(row, i));
        setValidationEntries(entries);

        if (result.rows.length === 0) {
          setParseError("未能从文件中解析出有效凭据。");
        } else {
          setStep(2);
        }
      } catch {
        setParseError("文件解析失败，请确认文件格式正确。");
      }

      event.target.value = "";
    },
    [validateRow],
  );

  const handleDropZoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Navigation

  const canProceed = useMemo(() => {
    switch (step) {
      case 0:
        return selectedSource !== null;
      case 1:
        return parsedRows.length > 0 && !parseError;
      case 2:
        return stats.valid > 0;
      case 3:
        return confirmChecked;
      default:
        return true;
    }
  }, [step, selectedSource, parsedRows, parseError, stats.valid, confirmChecked]);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1 && canProceed) {
      setStep(step + 1);
    }
  }, [step, canProceed]);

  const handleBack = useCallback(() => {
    if (step > 0) {
      setStep(step - 1);
    }
  }, [step]);

  const handleReset = useCallback(() => {
    setStep(0);
    setSelectedSource(null);
    setFileName(null);
    setSelectedFile(null);
    setParsedRows([]);
    setRejectedCount(0);
    setValidationEntries([]);
    setParseError(null);
    setConfirmChecked(false);
  }, []);

  const handleConfirmImport = useCallback(() => {
    if (selectedFile) {
      onImport(selectedFile);
      setStep(4);
    }
  }, [selectedFile, onImport]);

  // Step content

  const renderSourceStep = () => (
    <div className={styles.stepContent}>
      <h3 className={styles.stepHeading}>选择浏览器来源</h3>
      <p className={styles.stepDescription}>
        选择导出 CSV 的浏览器。不同浏览器的 CSV 格式可能略有不同。
      </p>
      <div className={styles.sourceList} role="radiogroup" aria-label="浏览器来源">
        {BROWSER_SOURCES.map((source) => (
          <label
            key={source.id}
            className={cn(
              styles.sourceCard,
              selectedSource === source.id && styles.sourceCardSelected,
            )}
          >
            <input
              type="radio"
              name="import-source"
              value={source.id}
              checked={selectedSource === source.id}
              onChange={() => setSelectedSource(source.id)}
              className={styles.sourceRadio}
            />
            <div>
              <div className={styles.sourceName}>{source.name}</div>
              <div className={styles.sourceDescription}>{source.description}</div>
            </div>
            {selectedSource === source.id ? (
              <Check size={16} className={styles.sourceCheck} />
            ) : null}
          </label>
        ))}
      </div>

      <h3 className={styles.stepHeading} style={{ marginTop: 24 }}>选择密码管理器来源</h3>
      <p className={styles.stepDescription}>
        从其他密码管理器导出的文件。格式将根据文件内容自动识别。
      </p>
      <div className={styles.sourceList} role="radiogroup" aria-label="密码管理器来源">
        {PASSWORD_MANAGER_SOURCES.map((source) => (
          <label
            key={source.id}
            className={cn(
              styles.sourceCard,
              selectedSource === source.id && styles.sourceCardSelected,
            )}
          >
            <input
              type="radio"
              name="import-source"
              value={source.id}
              checked={selectedSource === source.id}
              onChange={() => setSelectedSource(source.id)}
              className={styles.sourceRadio}
            />
            <div>
              <div className={styles.sourceName}>{source.name}</div>
              <div className={styles.sourceDescription}>{source.description}</div>
            </div>
            {selectedSource === source.id ? (
              <Check size={16} className={styles.sourceCheck} />
            ) : null}
          </label>
        ))}
      </div>
    </div>
  );

  const renderFileStep = () => {
    const allSources = [...BROWSER_SOURCES, ...PASSWORD_MANAGER_SOURCES];
    const sourceName = allSources.find((s) => s.id === selectedSource)?.name ?? "来源";

    return (
    <div className={styles.stepContent}>
      <h3 className={styles.stepHeading}>选择文件</h3>
      <p className={styles.stepDescription}>
        从 {sourceName} 导出的文件。支持 CSV、JSON 和 1PUX 格式。
      </p>

      <div className={styles.warningBox}>
        <AlertTriangle size={16} />
        <div>
          <p className={styles.warningBoxTitle}>
            导入文件包含明文密码，导入完成后请删除原文件
          </p>
          <p className={styles.warningBoxDesc}>
            Obscura 不会上传明文数据。所有解析均在浏览器内存中完成。
          </p>
        </div>
      </div>

      <div className={styles.fileInput}>
        <button
          type="button"
          className={styles.dropZone}
          onClick={handleDropZoneClick}
        >
          <Upload size={24} />
          <span className={styles.dropZoneFileName}>
            {fileName ?? "点击选择文件"}
          </span>
          <span className={styles.dropZoneHint}>支持 .csv、.json、.1pux 格式</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json,.1pux,text/csv,application/json"
          style={{ display: "none" }}
          onChange={handleFileInput}
          aria-label="选择导入文件"
        />
      </div>

      {parseError ? (
        <p className={styles.parseError}>{parseError}</p>
      ) : null}

      {parsedRows.length > 0 && !parseError ? (
        <div className={styles.parseSuccess}>
          <Check size={14} /> 已解析 {parsedRows.length} 条记录
          {rejectedCount > 0 ? (
            <span style={{ color: "var(--color-warning)", marginLeft: 12 }}>
              <AlertTriangle size={14} style={{ verticalAlign: -2 }} /> 跳过{" "}
              {rejectedCount} 条无效记录
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
	};

  const renderPreviewStep = () => (
    <div className={styles.stepContent}>
      <h3 className={styles.stepHeading}>预览与校验</h3>
      <p className={styles.stepDescription}>
        以下是解析结果的前 10 行，请检查校验状态后再继续。
      </p>

      {/* Stats summary */}
      <div className={styles.statsRow}>
        <span className={cn(styles.badge, styles.badgeOk)}>有效 {stats.valid}</span>
        {stats.withWarnings > 0 ? (
          <span className={cn(styles.badge, styles.badgeWarning)}>
            警告 {stats.withWarnings}
          </span>
        ) : null}
        {stats.withErrors > 0 ? (
          <span className={cn(styles.badge, styles.badgeError)}>
            错误 {stats.withErrors}
          </span>
        ) : null}
        {stats.duplicates > 0 ? (
          <span className={cn(styles.badge, styles.badgeWarning)}>
            重复 {stats.duplicates}
          </span>
        ) : null}
        <span className={styles.statsTotal}>
          共 {stats.total} 行
        </span>
      </div>

      {/* Validation legend */}
      <div className={styles.validationLegend}>
        校验维度：URL 有效、HTTPS、用户名存在、密码存在、重复项
      </div>

      {/* Preview table */}
      <div className={styles.previewTableWrapper}>
        <div className={styles.previewTableHeader}>
          <span>名称</span>
          <span>网址</span>
          <span>用户名</span>
          <span>密码</span>
          <span>校验</span>
        </div>
        <div className={styles.previewTableBody}>
          {validationEntries.slice(0, 10).map((entry) => (
            <div key={entry.index} className={styles.previewTableRow}>
              <span className={styles.previewTableCell} title={entry.row.title ?? ""}>
                {entry.row.title ?? "(无标题)"}
              </span>
              <span className={styles.previewTableCell} title={entry.row.origin}>
                {entry.row.origin}
              </span>
              <span className={styles.previewTableCell} title={entry.row.username}>
                {entry.row.username}
              </span>
              <span className={styles.previewTableMasked}>
                {"*".repeat(Math.min(entry.row.password.length, 8))}
              </span>
              <span>
                {entry.issues.length === 0 ? (
                  <span className={cn(styles.badge, styles.badgeOk)}>通过</span>
                ) : (
                  <span
                    className={cn(
                      styles.badge,
                      entry.issues.some((i) => i !== "非 HTTPS")
                        ? styles.badgeError
                        : styles.badgeWarning,
                    )}
                  >
                    {entry.issues.join(", ")}
                  </span>
                )}
              </span>
            </div>
          ))}
          {validationEntries.length > 10 ? (
            <div className={styles.previewTableMore}>
              还有 {validationEntries.length - 10} 条记录未显示
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  const renderConfirmStep = () => (
    <div className={styles.stepContent}>
      <h3 className={styles.stepHeading}>确认导入</h3>
      <p className={styles.stepDescription}>
        即将导入 {stats.valid} 条有效凭据到密码库。
        {stats.withErrors > 0 ? ` ${stats.withErrors} 条有错误的记录将被跳过。` : ""}
      </p>

      <div className={styles.warningBox}>
        <AlertTriangle size={16} />
        <div>
          <p className={styles.warningBoxTitle}>导入文件包含明文密码</p>
          <p className={styles.warningBoxDesc}>
            导入完成后请立即删除原文件。明文密码不应保留在设备上。
          </p>
        </div>
      </div>

      <div className={styles.confirmSummary}>
        <div className={styles.confirmSummaryRow}>
          <span>来源</span>
          <span className={styles.confirmSummaryValue}>
            {(() => {
              const all = [...BROWSER_SOURCES, ...PASSWORD_MANAGER_SOURCES];
              return all.find((s) => s.id === selectedSource)?.name ?? "未知";
            })()}
          </span>
        </div>
        <div className={styles.confirmSummaryRow}>
          <span>文件</span>
          <span className={styles.confirmSummaryValue}>{fileName ?? "未知"}</span>
        </div>
        <div className={styles.confirmSummaryRow}>
          <span>有效记录</span>
          <span className={styles.confirmSummaryValid}>{stats.valid}</span>
        </div>
        {stats.withErrors > 0 ? (
          <div className={styles.confirmSummaryRow}>
            <span>跳过</span>
            <span className={styles.confirmSummarySkip}>{stats.withErrors}</span>
          </div>
        ) : null}
      </div>

      <div className={styles.infoBox}>
        <p>
          <Shield size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
          <span className={styles.infoBoxStrong}>
            Obscura 不会上传明文数据。
          </span>
        </p>
        <p className={styles.infoBoxDesc}>
          所有数据在浏览器内存中加密后写入本地密码库。
        </p>
      </div>

      <label className={styles.confirmCheckbox}>
        <input
          type="checkbox"
          checked={confirmChecked}
          onChange={(e) => setConfirmChecked(e.target.checked)}
        />
        <span>
          我理解导入文件包含明文密码，导入后将删除原文件
        </span>
      </label>
    </div>
  );

  const renderResultStep = () => (
    <div className={styles.stepContent}>
      <h3 className={styles.stepHeading}>导入结果</h3>

      {loading ? (
        <div className={styles.progressContainer}>
          <p className={styles.resultStatus}>正在导入...</p>
          <div className={styles.progressBar}>
            <div className={styles.progressBarFill} />
          </div>
        </div>
      ) : importStatus ? (
        <>
          <p
            className={cn(
              styles.resultStatus,
              importStatus.includes("失败") || importStatus.includes("错误")
                ? styles.resultStatusError
                : styles.resultStatusSuccess,
            )}
          >
            {importStatus}
          </p>

          <div className={styles.warningBox}>
            <AlertTriangle size={16} />
            <div>
              <p className={styles.warningBoxTitle}>
                导入完成后请删除原文件
              </p>
              <p className={styles.warningBoxDesc}>
                导入文件包含明文密码，不应保留在设备上。
              </p>
            </div>
          </div>

          <div className={styles.infoBox}>
            <p>
              <span className={styles.infoBoxStrong}>
                Obscura 不会上传明文数据。
              </span>
            </p>
            <p className={styles.infoBoxDesc}>
              所有数据在浏览器内存中加密后写入本地密码库。
            </p>
          </div>
        </>
      ) : (
        <p className={styles.resultStatus}>
          尚未导入任何数据。请返回重新导入。
        </p>
      )}
    </div>
  );

  const renderStepContent = () => {
    switch (step) {
      case 0:
        return renderSourceStep();
      case 1:
        return renderFileStep();
      case 2:
        return renderPreviewStep();
      case 3:
        return renderConfirmStep();
      case 4:
        return renderResultStep();
      default:
        return null;
    }
  };

  // Render

  return (
    <div className={cn(styles.container, "pixel-border", "pixel-scanlines")} role="dialog" aria-label="密码导入">
      {/* Header */}
      <div className={styles.header}>
        <FileText size={20} />
        <h2 className={styles.headerTitle}>密码导入</h2>
      </div>

      {/* Step indicator */}
      <div className={styles.stepIndicator}>
        {STEPS.map((label, i) => (
          <div
            key={label}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <div
              className={cn(
                styles.stepDot,
                i === step && styles.stepDotActive,
                i < step && styles.stepDotCompleted,
              )}
            >
              {i < step ? <Check size={14} /> : i + 1}
            </div>
            <span
              className={cn(
                styles.stepLabel,
                i === step && styles.stepLabelActive,
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 ? (
              <ChevronRight size={14} className={styles.stepConnector} />
            ) : null}
          </div>
        ))}
      </div>

      {/* Step content */}
      {renderStepContent()}

      {/* Navigation */}
      <div className={styles.footer}>
        <div>
          {step > 0 && step < 4 ? (
            <Button variant="secondary" onClick={handleBack} disabled={loading}>
              上一步
            </Button>
          ) : null}
        </div>
        <div className={styles.footerActions}>
          {step === 4 && importStatus ? (
            <Button variant="secondary" onClick={handleReset} disabled={loading}>
              重新导入
            </Button>
          ) : null}
          {step === 3 ? (
            <Button
              variant="primary"
              onClick={handleConfirmImport}
              disabled={!confirmChecked || loading}
            >
              确认导入
              <Upload size={14} />
            </Button>
          ) : step < 4 ? (
            <Button
              variant="primary"
              onClick={handleNext}
              disabled={!canProceed || loading}
            >
              下一步
              <ChevronRight size={14} />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

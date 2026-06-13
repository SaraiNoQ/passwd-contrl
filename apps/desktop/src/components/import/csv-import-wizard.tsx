"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  Shield,
  Upload,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ImportLoginRow } from "@zero-vault/shared";
import {
  detectImportFormat,
  parsePasswordImport,
  parsePasswordCsv,
  autoDetectMapping,
  type ColumnMapping,
  type ImportFormat,
} from "../../lib/csv-import";
import { Modal } from "../ui/modal";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import styles from "./csv-import-wizard.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CsvImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (items: ImportLoginRow[]) => Promise<void>;
  csrfToken: string;
}

type ValidationEntry = {
  row: ImportLoginRow;
  index: number;
  issues: string[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BROWSER_SOURCES = [
  { id: "chrome", name: "Chrome", description: "Google Chrome 密码管理器" },
  { id: "edge", name: "Edge", description: "Microsoft Edge 密码管理器" },
  { id: "firefox", name: "Firefox", description: "Firefox 密码管理器" },
] as const;

const PASSWORD_MANAGER_SOURCES = [
  { id: "bitwarden", name: "Bitwarden", description: "Bitwarden 密码管理器" },
  { id: "1password", name: "1Password", description: "1Password 密码管理器" },
  { id: "lastpass", name: "LastPass", description: "LastPass 密码管理器" },
] as const;

const STEPS = ["文件选择", "预览", "字段映射", "验证", "导入确认"] as const;

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

const ALL_SOURCES = [...BROWSER_SOURCES, ...PASSWORD_MANAGER_SOURCES];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CsvImportWizard({
  isOpen,
  onClose,
  onImport,
  csrfToken: _csrfToken,
}: CsvImportWizardProps) {
  const [step, setStep] = useState(0);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ImportLoginRow[]>([]);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [validationEntries, setValidationEntries] = useState<ValidationEntry[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping | null>(null);
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

  const selectedSourceName = useMemo(
    () => ALL_SOURCES.find((source) => source.id === selectedSource)?.name ?? "等待定位",
    [selectedSource],
  );

  // File handling

  const handleFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setParseError(null);
      setFileName(file.name);
      setParsedRows([]);
      setRejectedCount(0);
      setValidationEntries([]);
      setConfirmChecked(false);
      setImportStatus(null);

      try {
        const content = await file.text();
        setFileContent(content);

        const format = detectImportFormat(content, file.name);
        if (format === "unknown") {
          setParseError("无法识别文件格式。支持 Chrome、Firefox、1Password、Bitwarden、LastPass CSV 和通用 JSON。");
          return;
        }

        // For CSV formats, extract headers for field mapping
        if (
          format === "csv" ||
          format === "chrome" ||
          format === "firefox" ||
          format === "lastpass"
        ) {
          const firstLine = content.trim().split(/\r?\n/u)[0] ?? "";
          const headers = firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
          setCsvHeaders(headers);
          setColumnMapping(autoDetectMapping(headers));
        } else {
          setCsvHeaders([]);
          setColumnMapping(null);
        }

        const result = parsePasswordImport(content, format);
        setParsedRows(result.rows);
        setRejectedCount(result.rejected);

        if (result.rows.length === 0) {
          setParseError("未能从文件中解析出有效凭据。");
        } else {
          // Skip to preview (step 1), field mapping (step 2) only for CSV
          if (
            format === "csv" ||
            format === "chrome" ||
            format === "firefox" ||
            format === "lastpass"
          ) {
            setStep(1);
          } else {
            // JSON formats don't need field mapping — validate immediately
            const entries = result.rows.map((row, i) => validateRow(row, i));
            setValidationEntries(entries);
            setStep(3);
          }
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

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files[0];
      if (file) {
        // Create a synthetic input event
        const dt = new DataTransfer();
        dt.items.add(file);
        if (fileInputRef.current) {
          fileInputRef.current.files = dt.files;
          fileInputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    },
    [],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Re-parse with custom mapping
  const handleApplyMapping = useCallback(() => {
    if (!fileContent || !columnMapping) return;

    const result = parsePasswordCsv(fileContent, columnMapping);
    setParsedRows(result.rows);
    setRejectedCount(result.rejected);

    const entries = result.rows.map((row, i) => validateRow(row, i));
    setValidationEntries(entries);

    setStep(3);
  }, [fileContent, columnMapping, validateRow]);

  // Navigation

  const canProceed = useMemo(() => {
    switch (step) {
      case 0:
        return selectedSource !== null;
      case 1:
        return parsedRows.length > 0 && !parseError;
      case 2:
        return columnMapping !== null && columnMapping.origin !== "" && columnMapping.password !== "";
      case 3:
        return stats.valid > 0;
      case 4:
        return confirmChecked;
      default:
        return true;
    }
  }, [step, selectedSource, parsedRows, parseError, columnMapping, stats.valid, confirmChecked]);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1 && canProceed) {
      // When leaving preview step for field mapping, or field mapping for validation
      if (step === 1) {
        // CSV: go to field mapping; JSON already skipped to validation
        setStep(2);
      } else if (step === 2) {
        handleApplyMapping();
      } else {
        setStep(step + 1);
      }
    }
  }, [step, canProceed, handleApplyMapping]);

  const handleBack = useCallback(() => {
    if (step > 0) {
      setStep(step - 1);
    }
  }, [step]);

  const handleReset = useCallback(() => {
    setStep(0);
    setSelectedSource(null);
    setFileName(null);
    setFileContent(null);
    setParsedRows([]);
    setRejectedCount(0);
    setValidationEntries([]);
    setParseError(null);
    setConfirmChecked(false);
    setLoading(false);
    setImportStatus(null);
    setCsvHeaders([]);
    setColumnMapping(null);
  }, []);

  const handleConfirmImport = useCallback(async () => {
    const validRows = validationEntries
      .filter((e) => e.issues.length === 0)
      .map((e) => e.row);

    if (validRows.length === 0) return;

    setLoading(true);
    setImportStatus(null);
    try {
      await onImport(validRows);
      setImportStatus(`成功导入 ${validRows.length} 条记录`);
      setStep(5);
    } catch {
      setImportStatus("导入失败，请重试。");
      setStep(5);
    } finally {
      setLoading(false);
    }
  }, [validationEntries, onImport]);

  // Step content

  const renderSourceStep = () => (
    <div className={styles.stepContent}>
      <h3 className={styles.stepHeading}>选择来源</h3>
      <p className={styles.stepDescription}>
        选择导出文件的来源，系统将自动识别对应格式。
      </p>

      <div className={styles.sourceSection}>
        <h4 className={styles.sourceSectionTitle}>浏览器</h4>
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
              {selectedSource === source.id && (
                <Check size={16} className={styles.sourceCheck} />
              )}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.sourceSection}>
        <h4 className={styles.sourceSectionTitle}>密码管理器</h4>
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
              {selectedSource === source.id && (
                <Check size={16} className={styles.sourceCheck} />
              )}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.warningBox}>
        <AlertTriangle size={16} />
        <div>
          <p className={styles.warningBoxTitle}>安全提示</p>
          <p className={styles.warningBoxDesc}>
            所有解析均在本地内存中完成，明文数据不会上传到服务器。
          </p>
        </div>
      </div>
    </div>
  );

  const renderFileStep = () => (
    <div className={styles.stepContent}>
      <h3 className={styles.stepHeading}>选择文件</h3>
      <p className={styles.stepDescription}>
        从 {selectedSourceName} 导出的文件将在本地解析。
      </p>

      <div
        className={styles.dropZone}
        onClick={handleDropZoneClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleDropZoneClick(); }}
      >
        <Upload size={24} />
        <span className={styles.dropZoneFileName}>
          {fileName ?? "点击选择文件或拖放文件到此处"}
        </span>
        <span className={styles.dropZoneHint}>支持 .csv、.json</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.json,.1pux,text/csv,application/json"
        className={styles.hiddenFileInput}
        onChange={handleFileInput}
        aria-label="选择导入文件"
      />

      {parseError && <p className={styles.parseError}>{parseError}</p>}

      {parsedRows.length > 0 && !parseError && (
        <div className={styles.parseSuccess}>
          <Check size={14} /> 已扫描 {parsedRows.length} 条记录
          {rejectedCount > 0 && (
            <span className={styles.parseWarning}>
              <AlertTriangle size={14} /> 跳过 {rejectedCount} 条无效记录
            </span>
          )}
        </div>
      )}
    </div>
  );

  const renderPreviewStep = () => (
    <div className={styles.stepContent}>
      <h3 className={styles.stepHeading}>数据预览</h3>
      <p className={styles.stepDescription}>
        以下是解析结果的前 10 行预览。
      </p>

      <div className={styles.previewTableWrapper} role="table" aria-label="导入预览">
        <div className={styles.previewTableHeader} role="row">
          <span role="columnheader">名称</span>
          <span role="columnheader">网址</span>
          <span role="columnheader">用户名</span>
          <span role="columnheader">密码</span>
        </div>
        <div className={styles.previewTableBody} role="rowgroup">
          {parsedRows.slice(0, 10).map((row, i) => (
            <div key={i} className={styles.previewTableRow} role="row">
              <span className={styles.previewTableCell} role="cell" data-label="名称">
                {row.title ?? "(无标题)"}
              </span>
              <span className={styles.previewTableCell} role="cell" data-label="网址">
                {row.origin}
              </span>
              <span className={styles.previewTableCell} role="cell" data-label="用户名">
                {row.username}
              </span>
              <span className={styles.previewTableMasked} role="cell" data-label="密码">
                {"*".repeat(Math.min(row.password.length, 8))}
              </span>
            </div>
          ))}
          {parsedRows.length > 10 && (
            <div className={styles.previewTableMore}>
              还有 {parsedRows.length - 10} 条记录未显示
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderMappingStep = () => (
    <div className={styles.stepContent}>
      <h3 className={styles.stepHeading}>字段映射</h3>
      <p className={styles.stepDescription}>
        将 CSV 列映射到对应的字段。系统已自动检测，可手动调整。
      </p>

      {columnMapping && (
        <div className={styles.mappingGrid}>
          <div className={styles.mappingRow}>
            <label className={styles.mappingLabel}>网址 (origin)</label>
            <select
              className={styles.mappingSelect}
              value={columnMapping.origin}
              onChange={(e) =>
                setColumnMapping({ ...columnMapping, origin: e.target.value })
              }
            >
              <option value="">-- 未映射 --</option>
              {csvHeaders.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
          <div className={styles.mappingRow}>
            <label className={styles.mappingLabel}>用户名 (username)</label>
            <select
              className={styles.mappingSelect}
              value={columnMapping.username}
              onChange={(e) =>
                setColumnMapping({ ...columnMapping, username: e.target.value })
              }
            >
              <option value="">-- 未映射 --</option>
              {csvHeaders.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
          <div className={styles.mappingRow}>
            <label className={styles.mappingLabel}>密码 (password)</label>
            <select
              className={styles.mappingSelect}
              value={columnMapping.password}
              onChange={(e) =>
                setColumnMapping({ ...columnMapping, password: e.target.value })
              }
            >
              <option value="">-- 未映射 --</option>
              {csvHeaders.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
          <div className={styles.mappingRow}>
            <label className={styles.mappingLabel}>名称 (title)</label>
            <select
              className={styles.mappingSelect}
              value={columnMapping.title}
              onChange={(e) =>
                setColumnMapping({ ...columnMapping, title: e.target.value })
              }
            >
              <option value="">-- 未映射 --</option>
              {csvHeaders.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
          <div className={styles.mappingRow}>
            <label className={styles.mappingLabel}>备注 (notes)</label>
            <select
              className={styles.mappingSelect}
              value={columnMapping.notes}
              onChange={(e) =>
                setColumnMapping({ ...columnMapping, notes: e.target.value })
              }
            >
              <option value="">-- 未映射 --</option>
              {csvHeaders.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );

  const renderValidationStep = () => (
    <div className={styles.stepContent}>
      <h3 className={styles.stepHeading}>数据验证</h3>
      <p className={styles.stepDescription}>
        验证每条记录的完整性。存在错误的记录将被跳过。
      </p>

      <div className={styles.statsRow}>
        <span className={cn(styles.badge, styles.badgeOk)}>有效 {stats.valid}</span>
        {stats.withWarnings > 0 && (
          <span className={cn(styles.badge, styles.badgeWarning)}>
            警告 {stats.withWarnings}
          </span>
        )}
        {stats.withErrors > 0 && (
          <span className={cn(styles.badge, styles.badgeError)}>
            错误 {stats.withErrors}
          </span>
        )}
        {stats.duplicates > 0 && (
          <span className={cn(styles.badge, styles.badgeWarning)}>
            重复 {stats.duplicates}
          </span>
        )}
        <span className={styles.statsTotal}>共 {stats.total} 行</span>
      </div>

      <div className={styles.validationLegend}>
        校验规则：URL 有效、HTTPS、用户名存在、密码存在
      </div>

      <div className={styles.previewTableWrapper} role="table" aria-label="验证结果">
        <div className={styles.previewTableHeader} role="row">
          <span role="columnheader">名称</span>
          <span role="columnheader">网址</span>
          <span role="columnheader">用户名</span>
          <span role="columnheader">密码</span>
          <span role="columnheader">校验</span>
        </div>
        <div className={styles.previewTableBody} role="rowgroup">
          {validationEntries.slice(0, 10).map((entry) => (
            <div key={entry.index} className={styles.previewTableRow} role="row">
              <span className={styles.previewTableCell} role="cell" data-label="名称">
                {entry.row.title ?? "(无标题)"}
              </span>
              <span className={styles.previewTableCell} role="cell" data-label="网址">
                {entry.row.origin}
              </span>
              <span className={styles.previewTableCell} role="cell" data-label="用户名">
                {entry.row.username}
              </span>
              <span className={styles.previewTableMasked} role="cell" data-label="密码">
                {"*".repeat(Math.min(entry.row.password.length, 8))}
              </span>
              <span className={styles.previewValidationCell} role="cell" data-label="校验">
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
          {validationEntries.length > 10 && (
            <div className={styles.previewTableMore}>
              还有 {validationEntries.length - 10} 条记录未显示
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderConfirmStep = () => (
    <div className={styles.stepContent}>
      <h3 className={styles.stepHeading}>导入确认</h3>
      <p className={styles.stepDescription}>
        即将把 {stats.valid} 条有效凭据导入到密码库。
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
          <span className={styles.confirmSummaryValue}>{selectedSourceName}</span>
        </div>
        <div className={styles.confirmSummaryRow}>
          <span>文件</span>
          <span className={styles.confirmSummaryValue}>{fileName ?? "未知"}</span>
        </div>
        <div className={styles.confirmSummaryRow}>
          <span>有效记录</span>
          <span className={styles.confirmSummaryValid}>{stats.valid}</span>
        </div>
        {stats.withErrors > 0 && (
          <div className={styles.confirmSummaryRow}>
            <span>跳过</span>
            <span className={styles.confirmSummarySkip}>{stats.withErrors}</span>
          </div>
        )}
      </div>

      <div className={styles.infoBox}>
        <p>
          <Shield size={14} />
          <span className={styles.infoBoxStrong}>所有数据在本地加密后写入密码库。</span>
        </p>
      </div>

      <label className={styles.confirmCheckbox}>
        <input
          type="checkbox"
          checked={confirmChecked}
          onChange={(e) => setConfirmChecked(e.target.checked)}
        />
        <span>我理解导入文件包含明文密码，导入后将删除原文件</span>
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
              importStatus.includes("失败")
                ? styles.resultStatusError
                : styles.resultStatusSuccess,
            )}
          >
            {importStatus}
          </p>

          <div className={styles.warningBox}>
            <AlertTriangle size={16} />
            <div>
              <p className={styles.warningBoxTitle}>请删除原文件</p>
              <p className={styles.warningBoxDesc}>
                导入文件包含明文密码，不应保留在设备上。
              </p>
            </div>
          </div>
        </>
      ) : (
        <p className={styles.resultStatus}>
          尚未导入任何数据。
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
        return renderMappingStep();
      case 4:
        return renderValidationStep();
      case 5:
        return renderConfirmStep();
      case 6:
        return renderResultStep();
      default:
        return null;
    }
  };

  // Determine effective step for indicator (skip mapping for non-CSV)
  const effectiveSteps = useMemo(() => {
    // If no CSV headers, skip preview and mapping steps
    if (csvHeaders.length === 0 && step >= 2) {
      return ["文件选择", "验证", "导入确认"];
    }
    if (csvHeaders.length === 0) {
      return ["文件选择", "验证", "导入确认"];
    }
    return [...STEPS];
  }, [csvHeaders, step]);

  const handleModalClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  // Render

  return (
    <Modal
      open={isOpen}
      onClose={handleModalClose}
      title="CSV 导入"
      {...(styles.wizardModal ? { className: styles.wizardModal } : {})}
    >
      {/* Step indicator */}
      <div className={styles.stepIndicator} role="list" aria-label="导入进度">
        {effectiveSteps.map((label, i) => (
          <div
            key={label}
            className={styles.stepItem}
            role="listitem"
            aria-current={i === Math.min(step, effectiveSteps.length - 1) ? "step" : undefined}
          >
            <div
              className={cn(
                styles.stepDot,
                i === Math.min(step, effectiveSteps.length - 1) && styles.stepDotActive,
                i < Math.min(step, effectiveSteps.length - 1) && styles.stepDotCompleted,
              )}
            >
              {i < Math.min(step, effectiveSteps.length - 1) ? <Check size={14} /> : i + 1}
            </div>
            <span
              className={cn(
                styles.stepLabel,
                i === Math.min(step, effectiveSteps.length - 1) && styles.stepLabelActive,
              )}
            >
              {label}
            </span>
            {i < effectiveSteps.length - 1 && (
              <ChevronRight size={14} className={styles.stepConnector} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className={styles.workbench} aria-live="polite">
        {renderStepContent()}
      </div>

      {/* Navigation */}
      <div className={styles.footer}>
        <div>
          {step > 0 && step < 6 ? (
            <Button variant="ghost" onClick={handleBack} disabled={loading}>
              上一步
            </Button>
          ) : null}
        </div>
        <div className={styles.footerActions}>
          {step === 6 && importStatus ? (
            <Button variant="secondary" onClick={handleReset} disabled={loading}>
              重新导入
            </Button>
          ) : null}
          {step === 5 ? (
            <Button
              variant="primary"
              onClick={handleConfirmImport}
              disabled={!confirmChecked || loading}
              loading={loading}
            >
              <Upload size={14} />
              确认导入
            </Button>
          ) : step < 5 ? (
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
    </Modal>
  );
}

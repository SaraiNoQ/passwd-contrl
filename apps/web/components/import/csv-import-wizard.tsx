"use client";

import { AlertTriangle, Check, ChevronRight, FileText, Globe, Upload, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { parsePasswordCsv } from "../../lib/csv-import";
import type { ImportLoginRow } from "@zero-vault/shared";
import styles from "./csv-import-wizard.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CsvImportWizardProps = {
  onImport: (items: ImportLoginRow[]) => void;
  onCancel: () => void;
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
  { id: "firefox", name: "Firefox", description: "Firefox 密码管理器" }
];

const WIZARD_STEPS = ["选择来源", "选择文件", "预览校验", "确认导入"] as const;


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CsvImportWizard({ onImport, onCancel }: CsvImportWizardProps) {
  const [step, setStep] = useState(0);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ImportLoginRow[]>([]);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [validationEntries, setValidationEntries] = useState<ValidationEntry[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validation ---------------------------------------------------------------

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

  // File handling ------------------------------------------------------------

  const handleFileSelect = useCallback(
    async (file: File) => {
      setParseError(null);
      try {
        const csv = await file.text();
        const result = parsePasswordCsv(csv);
        setFileName(file.name);
        setParsedRows(result.rows);
        setRejectedCount(result.rejected);

        const entries = result.rows.map((row, i) => validateRow(row, i));
        setValidationEntries(entries);

        if (result.rows.length === 0) {
          setParseError("未能从 CSV 文件中解析出有效凭据。");
        }
      } catch {
        setParseError("文件解析失败，请确认文件格式正确。");
      }
    },
    [validateRow]
  );

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        void handleFileSelect(file);
      }
      event.target.value = "";
    },
    [handleFileSelect]
  );

  const handleDropZoneClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Summary stats ------------------------------------------------------------

  const stats = useMemo(() => {
    const total = validationEntries.length;
    const valid = validationEntries.filter((e) => e.issues.length === 0).length;
    const withWarnings = validationEntries.filter(
      (e) => e.issues.some((i) => i === "非 HTTPS")
    ).length;
    const withErrors = validationEntries.filter(
      (e) => e.issues.some((i) => i !== "非 HTTPS")
    ).length;
    const duplicates = findDuplicateRows(parsedRows);
    return { total, valid, withWarnings, withErrors, duplicates };
  }, [validationEntries, parsedRows]);

  // Import handler -----------------------------------------------------------

  const handleConfirmImport = useCallback(() => {
    const validRows = validationEntries.filter((e) => e.issues.length === 0).map((e) => e.row);
    onImport(validRows);
  }, [validationEntries, onImport]);

  // Step navigation ----------------------------------------------------------

  const canProceed = useMemo(() => {
    switch (step) {
      case 0:
        return selectedSource !== null;
      case 1:
        return parsedRows.length > 0 && !parseError;
      case 2:
        return stats.valid > 0;
      default:
        return true;
    }
  }, [step, selectedSource, parsedRows, parseError, stats.valid]);

  const handleNext = useCallback(() => {
    if (step < WIZARD_STEPS.length - 1) {
      setStep(step + 1);
    }
  }, [step]);

  const handleBack = useCallback(() => {
    if (step > 0) {
      setStep(step - 1);
    }
  }, [step]);

  // Step content -------------------------------------------------------------

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
      default:
        return null;
    }
  };

  const renderSourceStep = () => (
    <div>
      <h3 className={styles.sectionTitle}>
        选择浏览器来源
      </h3>
      <p className={styles.description}>
        选择导出 CSV 的浏览器。不同浏览器的 CSV 格式可能略有不同。
      </p>
      <div className={styles.sourceList}>
        {BROWSER_SOURCES.map((source) => (
          <button
            key={source.id}
            type="button"
            className={`${styles.sourceCard}${selectedSource === source.id ? ` ${styles.sourceCardSelected}` : ""}`}
            onClick={() => setSelectedSource(source.id)}
            aria-pressed={selectedSource === source.id}
          >
            <Globe size={20} className={selectedSource === source.id ? styles.sourceCardIconSelected : styles.sourceCardIcon} />
            <div className={styles.sourceCardInfo}>
              <div className={styles.sourceCardName}>{source.name}</div>
              <div className={styles.sourceCardDesc}>{source.description}</div>
            </div>
            {selectedSource === source.id ? (
              <Check size={16} className={styles.sourceCardCheck} />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );

  const renderFileStep = () => (
    <div>
      <h3 className={styles.sectionTitle}>
        选择 CSV 文件
      </h3>
      <p className={styles.description}>
        从 {BROWSER_SOURCES.find((s) => s.id === selectedSource)?.name ?? "浏览器"} 导出的 CSV 文件。
      </p>

      <div className={styles.warningBox}>
        <AlertTriangle size={16} className={styles.warningBoxIcon} />
        <div>
          <p className={styles.warningBoxTitle}>CSV 文件包含明文密码</p>
          <p className={styles.warningBoxDesc}>
            Obscura 不会上传明文 CSV。所有解析均在浏览器内存中完成。
          </p>
        </div>
      </div>

      <div className={styles.dropZoneWrapper}>
        <button type="button" className={styles.dropZone} onClick={handleDropZoneClick}>
          <Upload size={24} className={styles.dropZoneIcon} />
          <div className={styles.dropZoneFile}>
            {fileName ?? "点击选择 CSV 文件"}
          </div>
          <div className={styles.dropZoneHint}>支持 .csv 格式</div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={handleFileInput}
          aria-label="选择 CSV 文件"
        />
      </div>

      {parseError ? (
        <p className={styles.parseError}>{parseError}</p>
      ) : null}

      {parsedRows.length > 0 && !parseError ? (
        <div className={styles.parseStats}>
          <span className={styles.parseStatSuccess}>
            <Check size={14} className={styles.parseStatIcon} /> 已解析 {parsedRows.length} 条记录
          </span>
          {rejectedCount > 0 ? (
            <span className={styles.parseStatWarning}>
              <AlertTriangle size={14} className={styles.parseStatIcon} /> 跳过 {rejectedCount} 条无效记录
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const renderPreviewStep = () => (
    <div>
      <h3 className={styles.sectionTitle}>
        预览与校验
      </h3>
      <p className={styles.description} style={{ marginBottom: 16 }}>
        以下是解析结果，请检查校验状态后再继续。
      </p>

      {/* Stats summary */}
      <div className={styles.statsRow}>
        <span className={styles.validationBadgeOk}>有效 {stats.valid}</span>
        {stats.withWarnings > 0 ? (
          <span className={styles.validationBadgeWarning}>警告 {stats.withWarnings}</span>
        ) : null}
        {stats.withErrors > 0 ? (
          <span className={styles.validationBadgeError}>错误 {stats.withErrors}</span>
        ) : null}
        {stats.duplicates > 0 ? (
          <span className={styles.validationBadgeWarning}>重复 {stats.duplicates}</span>
        ) : null}
      </div>

      {/* Validation legend */}
      <div className={styles.validationLegend}>
        校验维度：URL 有效、HTTPS、用户名存在、密码存在、重复项
      </div>

      {/* Preview table */}
      <div className={styles.tableWrapper}>
        <div className={styles.tableHeader}>
          <span>名称</span>
          <span>网址</span>
          <span>用户名</span>
          <span>密码</span>
          <span>校验</span>
        </div>
        <div className={styles.tableBody}>
          {validationEntries.slice(0, 50).map((entry) => (
            <div key={entry.index} className={styles.tableRow}>
              <span
                className={styles.tableCellEllipsis}
                title={entry.row.title ?? ""}
              >
                {entry.row.title ?? "(无标题)"}
              </span>
              <span
                className={styles.tableCellEllipsis}
                title={entry.row.origin}
              >
                {entry.row.origin}
              </span>
              <span
                className={styles.tableCellEllipsis}
                title={entry.row.username}
              >
                {entry.row.username}
              </span>
              <span className={styles.tableCellPassword}>
                {"*".repeat(Math.min(entry.row.password.length, 8))}
              </span>
              <span>
                {entry.issues.length === 0 ? (
                  <span className={styles.validationBadgeOk}>通过</span>
                ) : (
                  <span className={entry.issues.some((i) => i !== "非 HTTPS") ? styles.validationBadgeError : styles.validationBadgeWarning}>
                    {entry.issues.join(", ")}
                  </span>
                )}
              </span>
            </div>
          ))}
          {validationEntries.length > 50 ? (
            <div className={styles.tableMoreInfo}>
              还有 {validationEntries.length - 50} 条记录未显示
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  const renderConfirmStep = () => (
    <div>
      <h3 className={styles.sectionTitle}>
        确认导入
      </h3>
      <p className={styles.description}>
        即将导入 {stats.valid} 条有效凭据到密码库。
        {stats.withErrors > 0 ? ` ${stats.withErrors} 条有错误的记录将被跳过。` : ""}
      </p>

      <div className={styles.warningBox}>
        <AlertTriangle size={16} className={styles.warningBoxIcon} />
        <div>
          <p className={styles.warningBoxTitle}>导入完成后请删除原 CSV 文件</p>
          <p className={styles.warningBoxDesc}>
            CSV 文件包含明文密码，不应保留在设备上。
          </p>
        </div>
      </div>

      <div className={styles.infoBox}>
        <p className={styles.infoBoxTitle}>
          <strong>Obscura 不会上传明文 CSV。</strong>
        </p>
        <p className={styles.infoBoxDesc}>
          所有数据在浏览器内存中加密后写入本地密码库。
        </p>
      </div>

      <div className={styles.confirmSummary}>
        <div className={styles.confirmRow}>
          <span>来源</span>
          <span className={styles.confirmValue}>
            {BROWSER_SOURCES.find((s) => s.id === selectedSource)?.name ?? "未知"}
          </span>
        </div>
        <div className={styles.confirmRow}>
          <span>文件</span>
          <span className={styles.confirmValue}>{fileName ?? "未知"}</span>
        </div>
        <div className={styles.confirmRow}>
          <span>有效记录</span>
          <span className={styles.confirmValueSuccess}>{stats.valid}</span>
        </div>
        {stats.withErrors > 0 ? (
          <div className={styles.confirmRow}>
            <span>跳过</span>
            <span className={styles.confirmValueWarning}>{stats.withErrors}</span>
          </div>
        ) : null}
      </div>
    </div>
  );

  // Render -------------------------------------------------------------------

  return (
    <div role="dialog" aria-label="CSV 导入向导" className={styles.panel}>
      {/* Header */}
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          <FileText size={20} className={styles.panelTitleIcon} />
          CSV 导入
        </h2>
        <button type="button" className={styles.ghostButton} onClick={onCancel} aria-label="取消导入">
          <X size={16} />
        </button>
      </div>

      {/* Step indicator */}
      <div className={styles.stepIndicator}>
        {WIZARD_STEPS.map((label, i) => (
          <div key={label} className={styles.stepItem}>
            <div className={`${styles.stepDot}${i < step ? ` ${styles.stepDotCompleted}` : i === step ? ` ${styles.stepDotActive}` : ""}`}>
              {i < step ? <Check size={14} /> : i + 1}
            </div>
            <span className={`${styles.stepLabel}${i === step ? ` ${styles.stepLabelActive}` : ""}`}>{label}</span>
            {i < WIZARD_STEPS.length - 1 ? (
              <ChevronRight size={14} className={styles.stepChevron} />
            ) : null}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className={styles.stepContent}>{renderStepContent()}</div>

      {/* Navigation */}
      <div className={styles.navBar}>
        <div className={styles.navBarLeft}>
          {step > 0 ? (
            <button type="button" className={styles.secondaryButton} onClick={handleBack}>
              上一步
            </button>
          ) : (
            <button type="button" className={styles.ghostButton} onClick={onCancel}>
              取消
            </button>
          )}
        </div>
        <div className={styles.navBarRight}>
          {step < WIZARD_STEPS.length - 1 ? (
            <button
              type="button"
              className={canProceed ? styles.primaryButton : styles.primaryButtonDisabled}
              onClick={handleNext}
              disabled={!canProceed}
            >
              下一步
              <ChevronRight size={14} />
            </button>
          ) : (
            <button type="button" className={styles.primaryButton} onClick={handleConfirmImport}>
              <Upload size={14} />
              确认导入
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

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

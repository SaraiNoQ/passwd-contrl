"use client";

import { AlertTriangle, Clock, Folder, KeyRound, Trash2, Plus, StickyNote, CreditCard } from "lucide-react";
import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Drawer } from "../ui/drawer";
import { Input } from "../ui/input";
import { PasswordField } from "../ui/password-field";
import { TotpDisplay } from "../totp-display";
import { TotpScanner } from "../totp-scanner";
import { isValidTotpSecret } from "../../lib/totp";
import { CredentialHistory, type HistoryVersion } from "./credential-history";
import styles from "./credential-drawer.module.css";

export type ItemType = "login" | "secure_note" | "credit_card";

export interface ItemForm {
  type: ItemType;
  title: string;
  origin: string;
  username: string;
  password: string;
  notes: string;
  folder: string;
  totp?: string;
  // secure_note
  noteBody?: string;
  // credit_card
  cardholderName?: string;
  cardNumber?: string;
  expirationMonth?: string;
  expirationYear?: string;
  cvv?: string;
  brand?: string;
}

export interface CredentialDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  editingId: string | null;
  itemForm: ItemForm;
  onFormChange: (field: string, value: string) => void;
  onSave: (e: FormEvent) => void;
  onDelete: () => void;
  onGeneratePassword: () => void;
  onCopyPassword: () => void;
  loading: boolean;
  error: string;
  /** Existing folder names for autocomplete suggestions. */
  folders: string[];
  /** History props (optional) */
  historyVersions?: HistoryVersion[];
  historyLoading?: boolean;
  historyError?: string;
  onLoadHistory?: (itemId: string) => void;
}

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <span className={styles.fieldLabel}>
      <span>{children}</span>
      <span className={required ? styles.requiredBadge : styles.optionalBadge}>
        {required ? "必填" : "可选"}
      </span>
    </span>
  );
}

export function CredentialDrawer({
  isOpen,
  onClose,
  editingId,
  itemForm,
  onFormChange,
  onSave,
  onDelete,
  onGeneratePassword,
  onCopyPassword,
  loading,
  error,
  folders,
  historyVersions,
  historyLoading,
  historyError,
  onLoadHistory,
}: CredentialDrawerProps) {
  const isEditing = editingId !== null;
  const [activeTab, setActiveTab] = useState<"edit" | "history">("edit");
  const originWarning = itemForm.origin !== "" && !itemForm.origin.startsWith("https://");

  // -- Folder autocomplete state --
  const [folderFocused, setFolderFocused] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const folderSuggestions = useMemo(() => {
    const query = itemForm.folder.trim().toLowerCase();
    if (!query || !folderFocused) return [];
    const matches = folders.filter((f) => f.toLowerCase().includes(query));
    return matches;
  }, [itemForm.folder, folders, folderFocused]);

  const handleFolderSelect = useCallback(
    (folder: string) => {
      onFormChange("folder", folder);
      setFolderFocused(false);
    },
    [onFormChange],
  );

  const handleCreateFolder = useCallback(() => {
    const name = itemForm.folder.trim();
    if (name) {
      onFormChange("folder", name);
      setFolderFocused(false);
    }
  }, [itemForm.folder, onFormChange]);

  return (
    <Drawer
      open={isOpen}
      onClose={onClose}
      title={isEditing ? "编辑凭据" : "新增凭据"}
      eyebrow={isEditing ? "EDIT ITEM / 编辑记录" : "NEW ITEM / 新增记录"}
      status={isEditing ? "更新本地密码记录" : "保存到加密密码库"}
      className={styles.drawerShell ?? ""}
    >
      <form className={styles.form} onSubmit={onSave}>
        <div className={styles.formHero}>
          <div>
            <p className={styles.eyebrow}>{isEditing ? "EDIT BLOCK" : "NEW BLOCK"}</p>
            <h3 className={styles.heroTitle}>
              {itemForm.type === "secure_note"
                ? (isEditing ? "编辑安全笔记" : "新增安全笔记")
                : itemForm.type === "credit_card"
                  ? (isEditing ? "编辑信用卡" : "新增信用卡")
                  : (isEditing ? "编辑密码记录" : "新增密码记录")}
            </h3>
            <p className={styles.heroCopy}>
              {itemForm.type === "secure_note"
                ? "保存到本地加密库。"
                : itemForm.type === "credit_card"
                  ? "保存到本地加密库。"
                  : "保存到本地加密库。"}
            </p>
          </div>
          <div className={styles.heroGlyph} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>

        {/* Tabs: Edit / History (only when editing) */}
        {isEditing && onLoadHistory ? (
          <div className={styles.tabBar} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "edit"}
              className={`${styles.tab} ${activeTab === "edit" ? styles.tabActive : ""}`}
              onClick={() => setActiveTab("edit")}
            >
              编辑
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "history"}
              className={`${styles.tab} ${activeTab === "history" ? styles.tabActive : ""}`}
              onClick={() => setActiveTab("history")}
            >
              <Clock size={14} />
              历史版本
            </button>
          </div>
        ) : null}

        {/* History view */}
        {activeTab === "history" && isEditing && onLoadHistory ? (
          <CredentialHistory
            itemId={editingId!}
            versions={historyVersions ?? []}
            loading={historyLoading ?? false}
            error={historyError ?? ""}
            onLoad={onLoadHistory}
          />
        ) : null}

        {/* Edit form (hidden when viewing history) */}
        {activeTab === "edit" ? (<>

        {/* Type selector (only visible when creating) */}
        {!isEditing ? (
          <div className={styles.typeSelector}>
            <span className={styles.typeSelectorLabel}>
              <FieldLabel required>记录类型</FieldLabel>
            </span>
            <div className={styles.typeSelectorOptions}>
              <button
                type="button"
                className={`${styles.typeOption} ${itemForm.type === "login" ? styles.typeOptionActive : ""}`}
                onClick={() => onFormChange("type", "login")}
              >
                <KeyRound size={16} />
                登录
              </button>
              <button
                type="button"
                className={`${styles.typeOption} ${itemForm.type === "secure_note" ? styles.typeOptionActive : ""}`}
                onClick={() => onFormChange("type", "secure_note")}
              >
                <StickyNote size={16} />
                安全笔记
              </button>
              <button
                type="button"
                className={`${styles.typeOption} ${itemForm.type === "credit_card" ? styles.typeOptionActive : ""}`}
                onClick={() => onFormChange("type", "credit_card")}
              >
                <CreditCard size={16} />
                信用卡
              </button>
            </div>
          </div>
        ) : null}

        {/* Common fields: title + folder */}
        <div className={styles.fieldGrid}>
          <Input
            id="credential-title"
            label={<FieldLabel>标题</FieldLabel>}
            placeholder={
              itemForm.type === "secure_note" ? "例如：WiFi 密码"
                : itemForm.type === "credit_card" ? "例如：招商银行 Visa"
                : "例如：GitHub"
            }
            value={itemForm.title}
            onChange={(e) => onFormChange("title", e.target.value)}
          />

          <div className={styles.folderWrapper}>
            <div className={styles.folderLabel}>
              <Folder size={14} />
              <FieldLabel>文件夹</FieldLabel>
            </div>
            <div className={styles.folderInputContainer}>
              <input
                ref={folderInputRef}
                className={styles.folderInput}
                type="text"
                placeholder="未分类"
                value={itemForm.folder}
                onChange={(e) => onFormChange("folder", e.target.value)}
                onFocus={() => setFolderFocused(true)}
                onBlur={() => setTimeout(() => setFolderFocused(false), 150)}
                autoComplete="off"
              />
              {folderSuggestions.length > 0 ? (
                <div className={styles.folderSuggestions}>
                  {folderSuggestions.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={styles.folderSuggestionItem}
                      onMouseDown={(e) => { e.preventDefault(); handleFolderSelect(f); }}
                    >
                      <Folder size={13} />
                      {f}
                    </button>
                  ))}
                  {!folders.some((f) => f.toLowerCase() === itemForm.folder.trim().toLowerCase()) &&
                   itemForm.folder.trim() ? (
                    <button
                      type="button"
                      className={styles.folderSuggestionItem}
                      onMouseDown={(e) => { e.preventDefault(); handleCreateFolder(); }}
                    >
                      <Plus size={13} />
                      新建文件夹 &quot;{itemForm.folder.trim()}&quot;
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* ---- Login fields ---- */}
        {itemForm.type === "login" ? (<>
          <div className={styles.fieldGrid}>
            <div className={styles.wideField}>
              <Input
                id="credential-origin"
                label={<FieldLabel required>网站地址</FieldLabel>}
                placeholder="https://example.com"
                value={itemForm.origin}
                onChange={(e) => onFormChange("origin", e.target.value)}
                {...(originWarning ? { error: "自动填充仅支持 HTTPS 站点" } : {})}
              />
              {originWarning ? (
                <span className={styles.originHint}>
                  <AlertTriangle size={12} />
                  自动填充仅支持 HTTPS 站点
                </span>
              ) : null}
            </div>

            <Input
              id="credential-username"
              label={<FieldLabel>用户名</FieldLabel>}
              placeholder="name@example.com"
              value={itemForm.username}
              onChange={(e) => onFormChange("username", e.target.value)}
            />

            <div className={styles.wideField}>
              <PasswordField
                id="credential-password"
                label={<FieldLabel required>密码</FieldLabel>}
                placeholder="加密存储"
                value={itemForm.password}
                onChange={(e) => onFormChange("password", e.target.value)}
                onGenerate={onGeneratePassword}
                onCopy={onCopyPassword}
              />
            </div>
          </div>

          <section className={styles.totpSection} aria-labelledby="totp-section-title">
            <div className={styles.totpHeader}>
              <div className={styles.totpLabel}>
                <KeyRound size={16} aria-hidden="true" />
                <div>
                  <span>TOTP BEACON</span>
                  <div className={styles.totpTitleRow}>
                    <h4 id="totp-section-title">两步验证码</h4>
                    <span className={styles.optionalBadge}>可选</span>
                  </div>
                </div>
              </div>
              <span className={styles.totpState}>
                {itemForm.totp && isValidTotpSecret(itemForm.totp) ? "信标运行中" : "等待密钥"}
              </span>
            </div>
            <p className={styles.totpCopy}>
              验证码仅在此设备根据加密密钥生成，每 30 秒更新一次。
            </p>
            {itemForm.totp && isValidTotpSecret(itemForm.totp) ? (
              <div className={styles.totpActive}>
                <TotpDisplay secret={itemForm.totp} />
                <button
                  type="button"
                  className={styles.totpRemoveBtn}
                  onClick={() => onFormChange("totp", "")}
                  aria-label="移除 TOTP"
                >
                  移除
                </button>
              </div>
            ) : (
              <>
                <Input
                  placeholder="otpauth://... 或 base32 密钥"
                  value={itemForm.totp ?? ""}
                  onChange={(e) => onFormChange("totp", e.target.value)}
                  aria-label="TOTP 密钥"
                />
                <TotpScanner onSecret={(s) => onFormChange("totp", s)} />
              </>
            )}
          </section>
        </>) : null}

        {/* ---- Secure note fields ---- */}
        {itemForm.type === "secure_note" ? (
          <div className={styles.wideField}>
            <Input
              type="textarea"
              id="credential-note-body"
              label={<FieldLabel>笔记内容</FieldLabel>}
              placeholder="输入加密笔记内容..."
              rows={8}
              value={itemForm.noteBody ?? ""}
              onChange={(e) => onFormChange("noteBody", e.target.value)}
            />
          </div>
        ) : null}

        {/* ---- Credit card fields ---- */}
        {itemForm.type === "credit_card" ? (
          <div className={styles.fieldGrid}>
            <div className={styles.wideField}>
              <Input
                id="credential-cardholder"
                label={<FieldLabel>持卡人姓名</FieldLabel>}
                placeholder="姓名"
                value={itemForm.cardholderName ?? ""}
                onChange={(e) => onFormChange("cardholderName", e.target.value)}
              />
            </div>
            <div className={styles.wideField}>
              <Input
                id="credential-card-number"
                label={<FieldLabel>卡号</FieldLabel>}
                placeholder="0000 0000 0000 0000"
                value={itemForm.cardNumber ?? ""}
                onChange={(e) => onFormChange("cardNumber", e.target.value)}
              />
            </div>
            <Input
              id="credential-expiration-month"
              label={<FieldLabel>到期月</FieldLabel>}
              placeholder="MM"
              value={itemForm.expirationMonth ?? ""}
              onChange={(e) => onFormChange("expirationMonth", e.target.value)}
            />
            <Input
              id="credential-expiration-year"
              label={<FieldLabel>到期年</FieldLabel>}
              placeholder="YYYY"
              value={itemForm.expirationYear ?? ""}
              onChange={(e) => onFormChange("expirationYear", e.target.value)}
            />
            <Input
              id="credential-cvv"
              label={<FieldLabel>CVV</FieldLabel>}
              placeholder="***"
              value={itemForm.cvv ?? ""}
              onChange={(e) => onFormChange("cvv", e.target.value)}
            />
            <Input
              id="credential-card-brand"
              label={<FieldLabel>卡品牌</FieldLabel>}
              placeholder="Visa / Mastercard"
              value={itemForm.brand ?? ""}
              onChange={(e) => onFormChange("brand", e.target.value)}
            />
          </div>
        ) : null}

        <Input
          type="textarea"
          id="credential-notes"
          label={<FieldLabel>备注</FieldLabel>}
          placeholder="可选备注"
          rows={3}
          value={itemForm.notes}
          onChange={(e) => onFormChange("notes", e.target.value)}
        />

        {error ? (
          <div className={styles.errorBanner} role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className={styles.footer}>
          <Button
            type="submit"
            variant="primary"
            loading={loading}
            className={styles.saveBtn ?? ""}
          >
            {loading ? "保存中..." : isEditing ? "保存修改" : (
              itemForm.type === "secure_note" ? "保存笔记" :
              itemForm.type === "credit_card" ? "保存信用卡" :
              "保存凭据"
            )}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          {isEditing ? (
            <Button type="button" variant="danger" onClick={onDelete} disabled={loading}>
              <Trash2 size={14} />
              删除
            </Button>
          ) : null}
        </div>
        </> ) : null}
      </form>
    </Drawer>
  );
}

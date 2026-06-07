"use client";

import { AlertTriangle, Folder, KeyRound, Trash2, Plus } from "lucide-react";
import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Drawer } from "../ui/drawer";
import { Input } from "../ui/input";
import { PasswordField } from "../ui/password-field";
import { TotpDisplay } from "../totp-display";
import { TotpScanner } from "../totp-scanner";
import { isValidTotpSecret } from "../../lib/totp";
import styles from "./credential-drawer.module.css";

export interface ItemForm {
  title: string;
  origin: string;
  username: string;
  password: string;
  notes: string;
  folder: string;
  totp?: string;
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
}: CredentialDrawerProps) {
  const isEditing = editingId !== null;
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
      className={styles.drawerShell ?? ""}
    >
      <form className={styles.form} onSubmit={onSave}>
        <div className={styles.formHero}>
          <div>
            <p className={styles.eyebrow}>{isEditing ? "EDIT BLOCK" : "NEW BLOCK"}</p>
            <h3 className={styles.heroTitle}>
              {isEditing ? "重写密文卡片" : "铸造新凭据"}
            </h3>
            <p className={styles.heroCopy}>
              站点、身份、密码与 TOTP 会在保存后进入本地加密账本。
            </p>
          </div>
          <div className={styles.heroGlyph} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>

        <div className={styles.fieldGrid}>
          <Input
            label="标题"
            placeholder="例如：GitHub"
            value={itemForm.title}
            onChange={(e) => onFormChange("title", e.target.value)}
          />

          <div className={styles.folderWrapper}>
            <div className={styles.folderLabel}>
              <Folder size={14} />
              文件夹
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

          <div className={styles.wideField}>
            <Input
              label="网站地址"
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
            label="用户名"
            placeholder="name@example.com"
            value={itemForm.username}
            onChange={(e) => onFormChange("username", e.target.value)}
          />

          <div className={styles.wideField}>
            <PasswordField
              label="密码"
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
                <h4 id="totp-section-title">两步验证码</h4>
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

        <Input
          type="textarea"
          label="备注"
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
            {loading ? "保存中..." : isEditing ? "保存修改" : "保存凭据"}
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
      </form>
    </Drawer>
  );
}

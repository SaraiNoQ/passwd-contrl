"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  X,
  Globe,
  FileText,
  CreditCard,
  Shuffle,
  Plus,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import type {
  VaultItem,
  VaultLogin,
  VaultSecureNote,
  VaultCreditCard,
  CustomField,
  VaultItemType,
} from "@zero-vault/shared";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import { generatePassword } from "../tools/password-generator";
import styles from "./add-edit-drawer.module.css";

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

type DrawerMode = "add" | "edit";

export interface AddEditDrawerProps {
  isOpen: boolean;
  mode: DrawerMode;
  initialItem?: VaultItem | undefined;
  onClose: () => void;
  onSave: (item: VaultItem) => void;
  folders?: string[] | undefined;
}

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

interface FormState {
  type: VaultItemType;
  title: string;
  origin: string;
  username: string;
  password: string;
  totp: string;
  noteBody: string;
  cardholderName: string;
  cardNumber: string;
  expirationMonth: string;
  expirationYear: string;
  cvv: string;
  brand: string;
  folder: string;
  notes: string;
  customFields: CustomField[];
}

function getEmptyForm(): FormState {
  return {
    type: "login",
    title: "",
    origin: "",
    username: "",
    password: "",
    totp: "",
    noteBody: "",
    cardholderName: "",
    cardNumber: "",
    expirationMonth: "",
    expirationYear: "",
    cvv: "",
    brand: "",
    folder: "",
    notes: "",
    customFields: [],
  };
}

function itemToForm(item: VaultItem): FormState {
  const base = {
    type: item.type,
    title: item.title,
    folder: item.folder,
    notes: item.notes,
    customFields: item.customFields ?? [],
  };

  if (item.type === "login") {
    return {
      ...base,
      origin: item.origin ?? "",
      username: item.username ?? "",
      password: item.password ?? "",
      totp: item.totp ?? "",
      noteBody: "",
      cardholderName: "",
      cardNumber: "",
      expirationMonth: "",
      expirationYear: "",
      cvv: "",
      brand: "",
    };
  }

  if (item.type === "secure_note") {
    return {
      ...base,
      origin: "",
      username: "",
      password: "",
      totp: "",
      noteBody: item.noteBody ?? "",
      cardholderName: "",
      cardNumber: "",
      expirationMonth: "",
      expirationYear: "",
      cvv: "",
      brand: "",
    };
  }

  return {
    ...base,
    origin: "",
    username: "",
    password: "",
    totp: "",
    noteBody: "",
    cardholderName: item.cardholderName ?? "",
    cardNumber: item.cardNumber ?? "",
    expirationMonth: item.expirationMonth ?? "",
    expirationYear: item.expirationYear ?? "",
    cvv: item.cvv ?? "",
    brand: item.brand ?? "",
  };
}

function formToItem(
  form: FormState,
  existingId?: string,
  existingTimestamps?: { createdAt: string; updatedAt: string },
): VaultItem {
  const now = new Date().toISOString();
  const id = existingId ?? crypto.randomUUID();

  const base = {
    id,
    title: form.title.trim(),
    folder: form.folder.trim(),
    notes: form.notes.trim(),
    customFields: form.customFields,
    createdAt: existingTimestamps?.createdAt ?? now,
    updatedAt: now,
  };

  if (form.type === "login") {
    return {
      ...base,
      type: "login" as const,
      origin: form.origin.trim(),
      username: form.username.trim(),
      password: form.password,
      ...(form.totp.trim() ? { totp: form.totp.trim() } : {}),
    };
  }

  if (form.type === "secure_note") {
    return {
      ...base,
      type: "secure_note" as const,
      noteBody: form.noteBody,
    };
  }

  return {
    ...base,
    type: "credit_card" as const,
    cardholderName: form.cardholderName.trim(),
    cardNumber: form.cardNumber.trim(),
    expirationMonth: form.expirationMonth.trim(),
    expirationYear: form.expirationYear.trim(),
    cvv: form.cvv.trim(),
    brand: form.brand.trim(),
  };
}

const TYPE_OPTIONS: Array<{
  value: VaultItemType;
  label: string;
  icon: typeof Globe;
}> = [
  { value: "login", label: "登录凭据", icon: Globe },
  { value: "secure_note", label: "安全笔记", icon: FileText },
  { value: "credit_card", label: "信用卡", icon: CreditCard },
];

/* ---------------------------------------------------------------------------
   Component
   --------------------------------------------------------------------------- */

export function AddEditDrawer({
  isOpen,
  mode,
  initialItem,
  onClose,
  onSave,
  folders = [],
}: AddEditDrawerProps) {
  const titleId = useId();
  const [form, setForm] = useState<FormState>(() =>
    mode === "edit" && initialItem ? itemToForm(initialItem) : getEmptyForm(),
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Reset form when drawer opens
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      if (mode === "edit" && initialItem) {
        setForm(itemToForm(initialItem));
      } else {
        setForm(getEmptyForm());
      }
      setError("");
      setDirty(false);
      setShowDiscardConfirm(false);

      requestAnimationFrame(() => {
        const first = drawerRef.current?.querySelector<HTMLElement>(
          "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])",
        );
        first?.focus();
      });
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen, mode, initialItem]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (showDiscardConfirm) {
          setShowDiscardConfirm(false);
        } else if (dirty) {
          setShowDiscardConfirm(true);
        } else {
          onClose();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, dirty, showDiscardConfirm, onClose]);

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setDirty(true);
    },
    [],
  );

  // Validation
  const validationError = useMemo(() => {
    if (!form.title.trim()) return "请输入标题";
    if (form.type === "login") {
      if (
        form.origin &&
        !form.origin.startsWith("https://") &&
        !form.origin.startsWith("http://")
      ) {
        return "网站地址需以 http:// 或 https:// 开头";
      }
    }
    if (form.type === "credit_card") {
      if (
        form.cardNumber &&
        !/^\d+$/.test(form.cardNumber.replace(/\s/g, ""))
      ) {
        return "卡号只能包含数字";
      }
      if (
        form.expirationMonth &&
        !/^(0?[1-9]|1[0-2])$/.test(form.expirationMonth)
      ) {
        return "有效期月份需为 1-12";
      }
      if (form.expirationYear && !/^\d{2,4}$/.test(form.expirationYear)) {
        return "有效期年份格式不正确";
      }
    }
    return "";
  }, [form]);

  // Submit
  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const err = validationError;
      if (err) {
        setError(err);
        return;
      }
      setError("");
      setLoading(true);
      try {
        const item = formToItem(
          form,
          mode === "edit" && initialItem ? initialItem.id : undefined,
          mode === "edit" && initialItem
            ? {
                createdAt: initialItem.createdAt,
                updatedAt: initialItem.updatedAt,
              }
            : undefined,
        );
        onSave(item);
      } catch {
        setError("保存失败，请重试");
      } finally {
        setLoading(false);
      }
    },
    [form, validationError, mode, initialItem, onSave],
  );

  const handleGeneratePassword = useCallback(() => {
    const pw = generatePassword({ length: 20 });
    setField("password", pw);
  }, [setField]);

  const handleCloseAttempt = useCallback(() => {
    if (dirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [dirty, onClose]);

  const handleDiscard = useCallback(() => {
    setShowDiscardConfirm(false);
    setDirty(false);
    onClose();
  }, [onClose]);

  // Custom fields
  const addCustomField = useCallback(() => {
    setField("customFields", [
      ...form.customFields,
      { name: "", value: "", fieldType: "text" },
    ]);
  }, [form.customFields, setField]);

  const updateCustomField = useCallback(
    (idx: number, patch: Partial<CustomField>) => {
      const next = form.customFields.map((f, i) =>
        i === idx ? { ...f, ...patch } : f,
      );
      setField("customFields", next);
    },
    [form.customFields, setField],
  );

  const removeCustomField = useCallback(
    (idx: number) => {
      setField(
        "customFields",
        form.customFields.filter((_, i) => i !== idx),
      );
    },
    [form.customFields, setField],
  );

  if (!isOpen) return null;

  const isEditing = mode === "edit";
  const originWarning =
    form.origin !== "" &&
    !form.origin.startsWith("https://") &&
    form.origin.startsWith("http://");

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={handleCloseAttempt}
    >
      <div
        ref={drawerRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerContent}>
            <p className={styles.eyebrow}>
              {isEditing ? "EDIT BLOCK" : "NEW BLOCK"}
            </p>
            <h2 id={titleId} className={styles.heroTitle}>
              {isEditing ? "编辑凭据" : "新增凭据"}
            </h2>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={handleCloseAttempt}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          <form
            id="add-edit-form"
            className={styles.form}
            onSubmit={handleSubmit}
          >
            {/* Hero banner */}
            <div className={styles.formHero}>
              <div>
                <p className={styles.heroCopy}>
                  {isEditing
                    ? "修改凭据内容后点击保存，数据将加密存储。"
                    : "选择凭据类型，填写信息后保存到本地加密账本。"}
                </p>
              </div>
              <div className={styles.heroGlyph} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>

            {/* Type selector (add mode only) */}
            {!isEditing && (
              <div className={styles.typeSelector}>
                {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    className={cn(
                      styles.typeOption,
                      form.type === value && styles.typeOptionActive,
                    )}
                    onClick={() => setField("type", value)}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Title */}
            <Input
              label="标题"
              placeholder="例如：GitHub"
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
            />

            {/* Folder */}
            <Input
              label="文件夹"
              placeholder="未分类"
              value={form.folder}
              onChange={(e) => setField("folder", e.target.value)}
              list="folder-suggestions"
            />
            {folders.length > 0 && (
              <datalist id="folder-suggestions">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            )}

            {/* Login fields */}
            {form.type === "login" && (
              <>
                <div className={styles.wideField}>
                  <Input
                    label="网站地址"
                    placeholder="https://example.com"
                    value={form.origin}
                    onChange={(e) => setField("origin", e.target.value)}
                  />
                  {originWarning && (
                    <span className={styles.originHint}>
                      <AlertTriangle size={12} />
                      建议使用 HTTPS 站点以确保安全
                    </span>
                  )}
                </div>

                <Input
                  label="用户名"
                  placeholder="name@example.com"
                  value={form.username}
                  onChange={(e) => setField("username", e.target.value)}
                />

                <div className={styles.wideField}>
                  <div className={styles.passwordRow}>
                    <div className={styles.passwordInput}>
                      <Input
                        label="密码"
                        type="password"
                        placeholder="加密存储"
                        value={form.password}
                        onChange={(e) =>
                          setField("password", e.target.value)
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className={styles.generateBtn}
                      onClick={handleGeneratePassword}
                      title="生成密码"
                      aria-label="生成随机密码"
                    >
                      <Shuffle size={16} />
                    </button>
                  </div>
                </div>

                <Input
                  label="TOTP URI"
                  placeholder="otpauth://... 或 base32 密钥"
                  value={form.totp}
                  onChange={(e) => setField("totp", e.target.value)}
                />
              </>
            )}

            {/* Secure note fields */}
            {form.type === "secure_note" && (
              <Input
                type="textarea"
                label="笔记内容"
                placeholder="输入安全笔记内容..."
                rows={8}
                value={form.noteBody}
                onChange={(e) => setField("noteBody", e.target.value)}
              />
            )}

            {/* Credit card fields */}
            {form.type === "credit_card" && (
              <>
                <Input
                  label="持卡人姓名"
                  placeholder="姓名"
                  value={form.cardholderName}
                  onChange={(e) =>
                    setField("cardholderName", e.target.value)
                  }
                />
                <Input
                  label="卡号"
                  placeholder="0000 0000 0000 0000"
                  value={form.cardNumber}
                  onChange={(e) => setField("cardNumber", e.target.value)}
                />
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <Input
                    label="有效期月"
                    placeholder="MM"
                    value={form.expirationMonth}
                    onChange={(e) =>
                      setField("expirationMonth", e.target.value)
                    }
                  />
                  <Input
                    label="有效期年"
                    placeholder="YYYY"
                    value={form.expirationYear}
                    onChange={(e) =>
                      setField("expirationYear", e.target.value)
                    }
                  />
                </div>
                <Input
                  label="CVV"
                  type="password"
                  placeholder="***"
                  value={form.cvv}
                  onChange={(e) => setField("cvv", e.target.value)}
                />
                <Input
                  label="品牌"
                  placeholder="Visa / Mastercard / ..."
                  value={form.brand}
                  onChange={(e) => setField("brand", e.target.value)}
                />
              </>
            )}

            {/* Notes (for login and credit_card) */}
            {form.type !== "secure_note" && (
              <Input
                type="textarea"
                label="备注"
                placeholder="可选备注"
                rows={3}
                value={form.notes}
                onChange={(e) => setField("notes", e.target.value)}
              />
            )}

            {/* Custom fields */}
            <div className={styles.customFieldsSection}>
              <div className={styles.customFieldsHeader}>
                <span className={styles.customFieldsTitle}>自定义字段</span>
                <button
                  type="button"
                  className={styles.addFieldBtn}
                  onClick={addCustomField}
                >
                  <Plus size={14} />
                  添加
                </button>
              </div>

              {form.customFields.map((field, idx) => (
                <div key={idx} className={styles.customFieldRow}>
                  <div className={styles.customFieldName}>
                    <Input
                      placeholder="字段名"
                      value={field.name}
                      onChange={(e) =>
                        updateCustomField(idx, { name: e.target.value })
                      }
                    />
                  </div>
                  <div className={styles.customFieldValue}>
                    <Input
                      placeholder="值"
                      type={
                        field.fieldType === "hidden" ? "password" : "text"
                      }
                      value={field.value}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateCustomField(idx, { value: e.target.value })
                      }
                    />
                  </div>
                  <select
                    className={styles.fieldTypeSelect}
                    value={field.fieldType}
                    onChange={(e) =>
                      updateCustomField(idx, {
                        fieldType: e.target.value as CustomField["fieldType"],
                      })
                    }
                    aria-label="字段类型"
                  >
                    <option value="text">文本</option>
                    <option value="hidden">隐藏</option>
                    <option value="boolean">布尔</option>
                  </select>
                  <button
                    type="button"
                    className={styles.customFieldRemove}
                    onClick={() => removeCustomField(idx)}
                    aria-label="删除此自定义字段"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Error */}
            {(error || validationError) && (
              <div className={styles.errorBanner} role="alert">
                <AlertTriangle size={16} />
                <span>{error || validationError}</span>
              </div>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <Button
            type="submit"
            form="add-edit-form"
            variant="primary"
            loading={loading}
            className={styles.saveBtn}
            disabled={!!validationError}
          >
            {loading ? "保存中..." : isEditing ? "保存修改" : "保存凭据"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleCloseAttempt}
          >
            取消
          </Button>
        </div>

        {/* Discard confirmation overlay */}
        {showDiscardConfirm && (
          <div className={styles.discardOverlay}>
            <div className={styles.discardDialog}>
              <h3 className={styles.discardTitle}>放弃更改？</h3>
              <p className={styles.discardMessage}>
                当前表单有未保存的修改，关闭后将丢失。
              </p>
              <div className={styles.discardActions}>
                <Button variant="danger" onClick={handleDiscard}>
                  放弃
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowDiscardConfirm(false)}
                >
                  继续编辑
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback } from "react";
import {
  Eye,
  EyeOff,
  Copy,
  Check,
  Pencil,
  Trash2,
  X,
  Globe,
  KeyRound,
  FileText,
  CreditCard,
  ExternalLink,
} from "lucide-react";
import type {
  VaultItem,
  VaultLogin,
  VaultSecureNote,
  VaultCreditCard,
  CustomField,
} from "@zero-vault/shared";
import { cn } from "../../lib/utils";
import { copyToClipboard } from "../../lib/clipboard";
import styles from "./credential-detail.module.css";

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

function isLogin(item: VaultItem): item is VaultLogin {
  return item.type === "login";
}
function isSecureNote(item: VaultItem): item is VaultSecureNote {
  return item.type === "secure_note";
}
function isCreditCard(item: VaultItem): item is VaultCreditCard {
  return item.type === "credit_card";
}

const TYPE_LABELS: Record<string, string> = {
  login: "登录凭据",
  secure_note: "安全笔记",
  credit_card: "信用卡",
};

const TYPE_ICONS: Record<string, typeof KeyRound> = {
  login: Globe,
  secure_note: FileText,
  credit_card: CreditCard,
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function maskCardNumber(num: string): string {
  if (num.length <= 4) return num;
  return "•••• •••• •••• " + num.slice(-4);
}

/* ---------------------------------------------------------------------------
   CopyButton (inline helper)
   --------------------------------------------------------------------------- */

function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      type="button"
      className={cn(styles.copyBtn, copied && styles.copyBtnSuccess, className)}
      onClick={handleCopy}
      aria-label={copied ? `已复制 ${label}` : `复制 ${label}`}
      title={`复制${label}`}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

/* ---------------------------------------------------------------------------
   FieldRow (inline helper)
   --------------------------------------------------------------------------- */

function FieldRow({
  label,
  value,
  hidden,
  copyLabel,
}: {
  label: string;
  value: string;
  hidden?: boolean;
  copyLabel?: string;
}) {
  if (!value) return null;

  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.fieldValue}>
        <span className={cn(hidden && styles.hiddenValue)}>
          {value}
        </span>
        {copyLabel && <CopyButton text={value} label={copyLabel} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Props
   --------------------------------------------------------------------------- */

export interface CredentialDetailProps {
  item: VaultItem;
  onEdit: (item: VaultItem) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  className?: string;
}

/* ---------------------------------------------------------------------------
   CredentialDetail
   --------------------------------------------------------------------------- */

export function CredentialDetail({
  item,
  onEdit,
  onDelete,
  onClose,
  className,
}: CredentialDetailProps) {
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  const [cvvRevealed, setCvvRevealed] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const Icon = TYPE_ICONS[item.type] ?? KeyRound;
  const typeLabel = TYPE_LABELS[item.type] ?? item.type;
  const login = isLogin(item) ? item : null;

  return (
    <div className={cn(styles.container, className)}>
      {/* Header */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="关闭详情"
        >
          <X size={18} />
        </button>

        <div className={styles.headerContent}>
          <span className={styles.typeIcon}>
            <Icon size={20} />
          </span>
          <div>
            <h2 className={styles.title}>{item.title}</h2>
            <span className={styles.typeBadge}>{typeLabel}</span>
          </div>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.editBtn}
            onClick={() => onEdit(item)}
            aria-label="编辑凭据"
          >
            <Pencil size={16} />
            编辑
          </button>

          {deleteConfirm ? (
            <div className={styles.deleteConfirm} role="alert">
              <span>确认删除？</span>
              <button
                type="button"
                className={styles.deleteYes}
                onClick={() => onDelete(item.id)}
              >
                确认
              </button>
              <button
                type="button"
                className={styles.deleteNo}
                onClick={() => setDeleteConfirm(false)}
                aria-label="取消删除"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={() => setDeleteConfirm(true)}
              aria-label="删除凭据"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className={styles.body}>
        {/* Login fields */}
        {login && (
          <>
            {login.origin && (
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>网站地址</span>
                <div className={styles.fieldValue}>
                  <a
                    className={styles.originLink}
                    href={login.origin}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {login.origin}
                    <ExternalLink size={12} />
                  </a>
                  <CopyButton text={login.origin} label="网站地址" />
                </div>
              </div>
            )}

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>用户名</span>
              <div className={styles.fieldValue}>
                <span>{login.username || "无用户名"}</span>
                {login.username && (
                  <CopyButton text={login.username} label="用户名" />
                )}
              </div>
            </div>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>密码</span>
              <div className={styles.fieldValue}>
                <span className={passwordRevealed ? undefined : styles.hiddenValue}>
                  {passwordRevealed ? login.password : "••••••••••••"}
                </span>
                <button
                  type="button"
                  className={styles.toggleBtn}
                  onClick={() => setPasswordRevealed((v) => !v)}
                  aria-label={passwordRevealed ? "隐藏密码" : "显示密码"}
                  aria-pressed={passwordRevealed}
                >
                  {passwordRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                {login.password && (
                  <CopyButton text={login.password} label="密码" />
                )}
              </div>
            </div>

            {login.totp && (
              <FieldRow
                label="TOTP 密钥"
                value={login.totp}
                hidden
                copyLabel="TOTP 密钥"
              />
            )}
          </>
        )}

        {/* Secure Note fields */}
        {isSecureNote(item) && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>笔记内容</span>
            <div className={styles.fieldValueColumn}>
              <pre className={styles.noteBody}>{item.noteBody || "空笔记"}</pre>
              {item.noteBody && (
                <CopyButton text={item.noteBody} label="笔记内容" />
              )}
            </div>
          </div>
        )}

        {/* Credit Card fields */}
        {isCreditCard(item) && (
          <>
            <FieldRow
              label="持卡人"
              value={item.cardholderName}
              copyLabel="持卡人"
            />
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>卡号</span>
              <div className={styles.fieldValue}>
                <span className={cvvRevealed ? undefined : styles.hiddenValue}>
                  {cvvRevealed ? item.cardNumber : maskCardNumber(item.cardNumber)}
                </span>
                <button
                  type="button"
                  className={styles.toggleBtn}
                  onClick={() => setCvvRevealed((v) => !v)}
                  aria-label={cvvRevealed ? "隐藏卡号" : "显示卡号"}
                  aria-pressed={cvvRevealed}
                >
                  {cvvRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                {item.cardNumber && (
                  <CopyButton text={item.cardNumber} label="卡号" />
                )}
              </div>
            </div>
            <FieldRow
              label="有效期"
              value={
                item.expirationMonth && item.expirationYear
                  ? `${item.expirationMonth}/${item.expirationYear}`
                  : ""
              }
            />
            <FieldRow
              label="CVV"
              value={item.cvv}
              hidden
              copyLabel="CVV"
            />
            <FieldRow
              label="品牌"
              value={item.brand}
            />
          </>
        )}

        {/* Notes (for login items) */}
        {login?.notes && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>备注</span>
            <div className={styles.fieldValueColumn}>
              <pre className={styles.noteBody}>{login.notes}</pre>
              <CopyButton text={login.notes} label="备注" />
            </div>
          </div>
        )}

        {/* Custom Fields */}
        {item.customFields && item.customFields.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>自定义字段</h3>
            {item.customFields.map((field: CustomField, idx: number) => (
              <div key={idx} className={styles.fieldRow}>
                <span className={styles.fieldLabel}>{field.name}</span>
                <div className={styles.fieldValue}>
                  <span
                    className={
                      field.fieldType === "hidden" ? styles.hiddenValue : undefined
                    }
                  >
                    {field.fieldType === "hidden" && !field.value
                      ? "••••••••"
                      : field.value}
                  </span>
                  {field.value && (
                    <CopyButton text={field.value} label={field.name} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Folder */}
        {item.folder && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>文件夹</span>
            <div className={styles.fieldValue}>
              <span>{item.folder}</span>
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className={styles.metaSection}>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>创建时间</span>
            <span className={styles.metaValue}>{formatDate(item.createdAt)}</span>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>最后修改</span>
            <span className={styles.metaValue}>{formatDate(item.updatedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

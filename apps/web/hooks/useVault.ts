"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";
import {
  addCredential,
  createEmptyLocalVault,
  deleteCredential,
  loadEncryptedLocalVault,
  persistUnlockedVault,
  saveEncryptedLocalVault,
  unlockLocalVault,
  updateCredential,
  type EncryptedLocalVault,
  type UnlockedVault,
  type VaultItem
} from "../lib/local-vault";
import { isLogin } from "../lib/item-types";
import { parsePasswordCsv } from "../lib/csv-import";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ItemForm = {
  title: string;
  origin: string;
  username: string;
  password: string;
  notes: string;
  folder: string;
  totp: string;
};

const emptyItemForm: ItemForm = {
  title: "",
  origin: "",
  username: "",
  password: "",
  notes: "",
  folder: "",
  totp: ""
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const generatePassword = (length = 20): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
};

export const isWeakPassword = (password: string): boolean => {
  if (password.length < 8) return true;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const variety = (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0);
  return variety < 3;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVault() {
  const [encryptedVault, setEncryptedVault] = useState<EncryptedLocalVault | null>(null);
  const [unlockedVault, setUnlockedVault] = useState<UnlockedVault | null>(null);
  const [masterPassword, setMasterPassword] = useState("");
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState("");

  const isLocked = !unlockedVault;
  const itemCount = unlockedVault?.snapshot.items.length ?? encryptedVault?.itemCount ?? 0;

  const updatedAt = useMemo(() => {
    const value = unlockedVault?.snapshot.updatedAt ?? encryptedVault?.updatedAt;
    return value
      ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
      : "从未";
  }, [encryptedVault?.updatedAt, unlockedVault?.snapshot.updatedAt]);

  const weakCount = useMemo(() => {
    if (!unlockedVault) return 0;
    return unlockedVault.snapshot.items.filter((item) => isLogin(item) && isWeakPassword(item.password)).length;
  }, [unlockedVault]);

  const duplicateCount = useMemo(() => {
    if (!unlockedVault) return 0;
    const counts = new Map<string, number>();
    for (const item of unlockedVault.snapshot.items) {
      if (!isLogin(item)) continue;
      counts.set(item.password, (counts.get(item.password) ?? 0) + 1);
    }
    let d = 0;
    for (const c of counts.values()) if (c > 1) d += c;
    return d;
  }, [unlockedVault]);

  // Init: load from localStorage
  const loadExistingVault = useCallback(() => {
    setEncryptedVault(loadEncryptedLocalVault());
  }, []);

  const hasLocalVault = encryptedVault !== null;

  const createVault = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (masterPassword.length < 12) throw new Error("主密码至少需要 12 个字符。");

      const created = await createEmptyLocalVault(masterPassword);
      saveEncryptedLocalVault(created.encrypted);
      setEncryptedVault(created.encrypted);
      setUnlockedVault(created.unlocked);
      setMasterPassword("");
      return created;
    },
    [masterPassword]
  );

  const unlockVault = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!encryptedVault) return;
      const unlocked = await unlockLocalVault(masterPassword, encryptedVault);
      setUnlockedVault(unlocked);
      setMasterPassword("");
      return unlocked;
    },
    [masterPassword, encryptedVault]
  );

  const lockVault = useCallback(() => {
    setUnlockedVault(null);
    setEditingId(null);
    setItemForm(emptyItemForm);
  }, []);

  // Credential CRUD
  const addItem = useCallback(
    async (form: ItemForm) => {
      if (!unlockedVault) throw new Error("请先解锁密码库。");
      if (!form.origin.startsWith("https://")) throw new Error("自动填充仅支持 HTTPS 站点。");
      if (!form.password) throw new Error("密码不能为空。");

      const title = form.title || new URL(form.origin).hostname;
      const next = addCredential(unlockedVault, { ...form, title });
      const persisted = await persistUnlockedVault(next);
      setUnlockedVault(persisted.unlocked);
      setEncryptedVault(persisted.encrypted);
      setItemForm(emptyItemForm);
      setEditingId(null);
      return persisted;
    },
    [unlockedVault]
  );

  const editItem = useCallback(
    async (id: string, form: ItemForm) => {
      if (!unlockedVault) throw new Error("请先解锁密码库。");
      if (!form.origin.startsWith("https://")) throw new Error("自动填充仅支持 HTTPS 站点。");
      if (!form.password) throw new Error("密码不能为空。");

      const title = form.title || new URL(form.origin).hostname;
      const next = updateCredential(unlockedVault, id, { ...form, title });
      const persisted = await persistUnlockedVault(next);
      setUnlockedVault(persisted.unlocked);
      setEncryptedVault(persisted.encrypted);
      setItemForm(emptyItemForm);
      setEditingId(null);
      return persisted;
    },
    [unlockedVault]
  );

  const removeItem = useCallback(
    async (id: string) => {
      if (!unlockedVault) throw new Error("请先解锁密码库。");
      const next = deleteCredential(unlockedVault, id);
      const persisted = await persistUnlockedVault(next);
      setUnlockedVault(persisted.unlocked);
      setEncryptedVault(persisted.encrypted);
      return persisted;
    },
    [unlockedVault]
  );

  const batchRemove = useCallback(
    async (ids: string[]) => {
      if (!unlockedVault || ids.length === 0) return;
      const idSet = new Set(ids);
      let next = unlockedVault;
      for (const id of idSet) {
        if (next.snapshot.items.some((item) => item.id === id)) {
          next = deleteCredential(next, id);
        }
      }
      const persisted = await persistUnlockedVault(next);
      setUnlockedVault(persisted.unlocked);
      setEncryptedVault(persisted.encrypted);
      return persisted;
    },
    [unlockedVault]
  );

  // CSV import
  const importCsv = useCallback(
    async (file: File) => {
      if (!unlockedVault) throw new Error("请先解锁密码库。");

      const csv = await file.text();
      const parsed = parsePasswordCsv(csv);
      const validRows = parsed.rows.filter((row) => {
        try {
          const url = new URL(row.origin);
          return url.protocol === "https:" && row.username.trim().length > 0 && row.password.trim().length > 0;
        } catch { return false; }
      });
      const skipped = parsed.rejected + (parsed.rows.length - validRows.length);

      let next = unlockedVault;
      for (const row of validRows) {
        next = addCredential(next, {
          title: row.title ?? new URL(row.origin).hostname,
          origin: row.origin, username: row.username,
          password: row.password, notes: row.notes ?? ""
        });
      }
      const persisted = await persistUnlockedVault(next);
      setUnlockedVault(persisted.unlocked);
      setEncryptedVault(persisted.encrypted);
      setImportStatus(`已导入 ${validRows.length} 条，已拒绝 ${skipped} 条。请在导入后删除明文 CSV 文件。`);
      return persisted;
    },
    [unlockedVault]
  );

  // Change master password
  const changeMasterPassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!encryptedVault) throw new Error("没有本地密码库");
      // Verify current password
      await unlockLocalVault(currentPassword, encryptedVault);

      const created = await createEmptyLocalVault(newPassword);
      if (unlockedVault) {
        const persisted = await persistUnlockedVault({ ...created.unlocked, snapshot: unlockedVault.snapshot });
        saveEncryptedLocalVault(persisted.encrypted);
        setEncryptedVault(persisted.encrypted);
        setUnlockedVault(persisted.unlocked);
      }
    },
    [encryptedVault, unlockedVault]
  );

  // Replace entire vault state (used after recovery/restore)
  const replaceVault = useCallback((vault: UnlockedVault) => {
    setUnlockedVault(vault);
  }, []);

  const replaceEncryptedVault = useCallback((v: EncryptedLocalVault) => {
    setEncryptedVault(v);
  }, []);

  // CSV export
  const exportCsv = useCallback(() => {
    if (!unlockedVault) return;
    const header = "name,url,username,password,note";
    const loginItems = unlockedVault.snapshot.items.filter(isLogin);
    const rows = loginItems.map((item) =>
      [item.title, item.origin, item.username, item.password, item.notes]
        .map((v) => `"${v.replace(/"/g, '""')}"`).join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `zero-vault-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }, [unlockedVault]);

  const exportEncrypted = useCallback(() => {
    if (!encryptedVault) return;
    const blob = new Blob([JSON.stringify(encryptedVault)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `zero-vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }, [encryptedVault]);

  const handleGeneratePassword = useCallback(() => {
    setItemForm((f) => ({ ...f, password: generatePassword() }));
  }, []);

  return {
    // State
    encryptedVault, unlockedVault, masterPassword, setMasterPassword,
    itemForm, setItemForm, editingId, setEditingId,
    importStatus, isLocked, itemCount, updatedAt,
    weakCount, duplicateCount, hasLocalVault, emptyItemForm,
    // Actions
    loadExistingVault, createVault, unlockVault, lockVault,
    addItem, editItem, removeItem, batchRemove,
    importCsv, changeMasterPassword,
    replaceVault, replaceEncryptedVault,
    exportCsv, exportEncrypted, handleGeneratePassword
  };
}

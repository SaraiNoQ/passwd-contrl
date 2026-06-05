import type { VaultItem, VaultLogin, VaultSecureNote, VaultCreditCard, VaultItemType } from "@zero-vault/shared";

export const isLogin = (item: VaultItem): item is VaultLogin => item.type === "login";
export const isSecureNote = (item: VaultItem): item is VaultSecureNote => item.type === "secure_note";
export const isCreditCard = (item: VaultItem): item is VaultCreditCard => item.type === "credit_card";

export const ITEM_TYPE_LABELS: Record<VaultItemType, string> = {
  login: "登录",
  secure_note: "安全笔记",
  credit_card: "信用卡"
};

export const createDefaultItem = (type: VaultItemType): Omit<VaultItem, "id" | "createdAt" | "updatedAt"> => {
  const base = { type, title: "", folder: "", notes: "", customFields: [] };
  switch (type) {
    case "login":
      return { ...base, type: "login" as const, origin: "", username: "", password: "" } as unknown as Omit<VaultLogin, "id" | "createdAt" | "updatedAt">;
    case "secure_note":
      return { ...base, type: "secure_note" as const, noteBody: "" } as unknown as Omit<VaultSecureNote, "id" | "createdAt" | "updatedAt">;
    case "credit_card":
      return { ...base, type: "credit_card" as const, cardholderName: "", cardNumber: "", expirationMonth: "", expirationYear: "", cvv: "", brand: "" } as unknown as Omit<VaultCreditCard, "id" | "createdAt" | "updatedAt">;
  }
};

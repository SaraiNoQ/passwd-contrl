import type { VaultItem } from "@zero-vault/shared";

export type PasswordRiskReason = "missing" | "weak" | "reused";

export interface PasswordRisk {
  itemId: string;
  reasons: PasswordRiskReason[];
}

export interface PasswordHealthReport {
  loginCount: number;
  missingCount: number;
  weakCount: number;
  reusedCount: number;
  risks: PasswordRisk[];
}

export function analyzePasswordHealth(items: VaultItem[]): PasswordHealthReport {
  const logins = items.filter((item) => item.type === "login");
  const passwordCounts = new Map<string, number>();
  for (const item of logins) {
    if (item.password) passwordCounts.set(item.password, (passwordCounts.get(item.password) ?? 0) + 1);
  }

  let missingCount = 0;
  let weakCount = 0;
  let reusedCount = 0;
  const risks: PasswordRisk[] = [];
  for (const item of logins) {
    const reasons: PasswordRiskReason[] = [];
    if (!item.password) {
      missingCount += 1;
      reasons.push("missing");
    } else {
      if (isWeakPassword(item.password)) {
        weakCount += 1;
        reasons.push("weak");
      }
      if ((passwordCounts.get(item.password) ?? 0) > 1) {
        reusedCount += 1;
        reasons.push("reused");
      }
    }
    if (reasons.length > 0) risks.push({ itemId: item.id, reasons });
  }

  return { loginCount: logins.length, missingCount, weakCount, reusedCount, risks };
}

function isWeakPassword(password: string): boolean {
  if (password.length < 12) return true;
  const variety = Number(/[a-z]/u.test(password))
    + Number(/[A-Z]/u.test(password))
    + Number(/[0-9]/u.test(password))
    + Number(/[^a-zA-Z0-9]/u.test(password));
  return variety < 3;
}

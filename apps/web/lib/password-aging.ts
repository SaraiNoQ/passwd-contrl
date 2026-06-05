import type { VaultItem, VaultLogin } from "./local-vault";
import { isLogin } from "./item-types";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Returns the number of days since the credential was last updated.
 */
export function getPasswordAge(item: VaultItem): number {
  const updated = new Date(item.updatedAt).getTime();
  const ageMs = Date.now() - updated;
  return Math.max(0, Math.floor(ageMs / MS_PER_DAY));
}

/**
 * Returns true if the credential is past the maximum allowed age.
 * Default maxAgeDays is 90.
 */
export function isPasswordExpired(item: VaultItem, maxAgeDays = 90): boolean {
  return getPasswordAge(item) >= maxAgeDays;
}

/**
 * Returns login items that will expire within the given number of days.
 * Default withinDays is 7.
 */
export function getExpiringPasswords(items: VaultItem[], withinDays = 7): VaultLogin[] {
  return items.filter((item): item is VaultLogin => {
    if (!isLogin(item)) return false;
    const age = getPasswordAge(item);
    return age >= 90 - withinDays && age < 90;
  });
}

/**
 * Returns all login items that exceed the maximum allowed age.
 */
export function getExpiredPasswords(items: VaultItem[], maxAgeDays = 90): VaultLogin[] {
  return items.filter((item): item is VaultLogin => isLogin(item) && isPasswordExpired(item, maxAgeDays));
}

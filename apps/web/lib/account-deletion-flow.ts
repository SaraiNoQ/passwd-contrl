export const RECENT_ACCOUNT_AUTH_WINDOW_MS = 5 * 60 * 1000;

export const normalizeAccountEmail = (email: string): string =>
  email.trim().toLocaleLowerCase("en-US");

export const accountEmailsMatch = (left: string, right: string): boolean =>
  normalizeAccountEmail(left) === normalizeAccountEmail(right);

export const isRecentAccountAuthentication = (
  authenticatedAt: number,
  now = Date.now(),
): boolean =>
  Number.isFinite(authenticatedAt) &&
  now >= authenticatedAt &&
  now - authenticatedAt <= RECENT_ACCOUNT_AUTH_WINDOW_MS;

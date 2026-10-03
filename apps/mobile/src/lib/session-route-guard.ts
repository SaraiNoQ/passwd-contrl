export type SessionGuardTarget =
  | "/login"
  | "/recovery-code"
  | "/device-approval"
  | "/unlock"
  | "/(tabs)/vault";

export interface SessionRouteState {
  isRestoring: boolean;
  hasUser: boolean;
  hasRecoveryCode: boolean;
  deviceStatus: string | null;
  vaultLocked: boolean;
}

const ANONYMOUS_ROUTES = new Set(["/login", "/register", "/recovery"]);
const AUTH_ENTRY_ROUTES = new Set([
  "/login",
  "/register",
  "/recovery-code",
  "/device-approval",
  "/unlock",
]);
const LOCKED_REAUTH_ROUTES = new Set(["/unlock", "/local-backup"]);

export function getSessionGuardTarget(
  pathname: string,
  state: SessionRouteState,
): SessionGuardTarget | null {
  if (state.isRestoring || pathname === "/") return null;
  const route = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  if (!state.hasUser) {
    return ANONYMOUS_ROUTES.has(route) ? null : "/login";
  }
  if (state.hasRecoveryCode) {
    return route === "/recovery-code" ? null : "/recovery-code";
  }
  // The recovery-code screen owns the foreground-loss continuation: it no
  // longer renders the secret and asks the user to authenticate again.
  if (route === "/recovery-code") return null;
  if (route === "/recovery") return null;
  if (state.deviceStatus !== "approved") {
    return route === "/device-approval" ? null : "/device-approval";
  }
  if (state.vaultLocked) {
    // The Android document picker backgrounds the app, which locks the vault.
    // Keep the encrypted backup/import page mounted so it can retain the
    // selected ciphertext and perform its own explicit reauthorization.
    return LOCKED_REAUTH_ROUTES.has(route) ? null : "/unlock";
  }
  return AUTH_ENTRY_ROUTES.has(route) ? "/(tabs)/vault" : null;
}

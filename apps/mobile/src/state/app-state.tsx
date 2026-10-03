import { createContext, useContext, useEffect, type ReactNode } from "react";
import { AppState as NativeAppState, View } from "react-native";
import { useAuthStateController, type AuthState } from "./auth-state";
import { useVaultStateController, type VaultState } from "./vault-state";

const FOREGROUND_SYNC_INTERVAL_MS = 60_000;

interface AppState {
  auth: AuthState;
  vault: VaultState;
}

const AppStateContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const auth = useAuthStateController();
  const vault = useVaultStateController(auth.user?.id ?? null, auth.csrfToken);

  useEffect(() => {
    void auth.restoreSession();
  }, [auth.restoreSession]);

  useEffect(() => {
    if (!auth.user && !vault.isLocked) vault.lock();
  }, [auth.user, vault.isLocked, vault.lock]);

  useEffect(() => {
    if (auth.user && !vault.isLocked) void vault.sync();
  }, [auth.user, vault.isLocked, vault.sync]);

  useEffect(() => {
    if (!auth.user || vault.isLocked || vault.isSyncing || vault.pendingMutationCount === 0) return;
    const timer = setTimeout(() => { void vault.sync(); }, 30_000);
    return () => clearTimeout(timer);
  }, [auth.user, vault.isLocked, vault.isSyncing, vault.pendingMutationCount, vault.sync]);

  useEffect(() => {
    if (!auth.user || vault.isLocked) return;
    const timer = setInterval(() => {
      if (NativeAppState.currentState === "active") void vault.sync();
    }, FOREGROUND_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [auth.user, vault.isLocked, vault.sync]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener("change", (state) => {
      if (state !== "active") vault.lock();
    });
    return () => subscription.remove();
  }, [vault.lock]);

  return (
    <AppStateContext.Provider value={{ auth, vault }}>
      <View style={{ flex: 1 }} onTouchStart={vault.recordActivity}>
        {children}
      </View>
    </AppStateContext.Provider>
  );
}

function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error("AppProvider is required");
  return state;
}

export function useAuthState(): AuthState { return useAppState().auth; }
export function useVaultState(): VaultState { return useAppState().vault; }

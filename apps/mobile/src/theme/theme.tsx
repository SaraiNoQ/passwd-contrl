import { useColorScheme } from "react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ExpoSecureStoreAdapter } from "../lib/storage/mobile-secure-store";
import { isThemePreference, type ThemePreference } from "./preference";
import { darkColors, lightColors, type ThemeColors } from "./tokens";

export type { ThemePreference } from "./preference";

interface ThemeContextValue {
  preference: ThemePreference;
  colorScheme: "light" | "dark";
  colors: ThemeColors;
  isHydrated: boolean;
  setPreference: (preference: ThemePreference) => Promise<boolean>;
}

const THEME_PREFERENCE_KEY = "theme_preference";
const DEFAULT_THEME: ThemePreference = "light";
const themeStore = new ExpoSecureStoreAdapter();
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME);
  const [isHydrated, setIsHydrated] = useState(false);
  const persistedPreferenceRef = useRef<ThemePreference>(DEFAULT_THEME);
  const saveSequenceRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const nativeColorScheme = useColorScheme();

  useEffect(() => {
    let active = true;
    void themeStore.getItem(THEME_PREFERENCE_KEY)
      .then((stored) => {
        if (!active) return;
        const restored = isThemePreference(stored) ? stored : DEFAULT_THEME;
        persistedPreferenceRef.current = restored;
        setPreferenceState(restored);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback(async (next: ThemePreference): Promise<boolean> => {
    const sequence = ++saveSequenceRef.current;
    // The palette is app-owned. Do not call Appearance.setColorScheme here:
    // Android implements that API through AppCompatDelegate, which recreates
    // the Activity and can interrupt the preference write and lock the vault.
    setPreferenceState(next);

    const save = saveQueueRef.current.then(async () => {
      await themeStore.setItem(THEME_PREFERENCE_KEY, next);
      persistedPreferenceRef.current = next;
    });
    saveQueueRef.current = save.catch(() => undefined);

    try {
      await save;
      return true;
    } catch {
      if (saveSequenceRef.current === sequence) {
        const fallback = persistedPreferenceRef.current;
        setPreferenceState(fallback);
      }
      return false;
    }
  }, []);

  const colorScheme: "light" | "dark" = preference === "system"
    ? nativeColorScheme === "dark" ? "dark" : "light"
    : preference;
  const colors = colorScheme === "dark" ? darkColors : lightColors;
  const value = useMemo(
    () => ({ preference, colorScheme, colors, isHydrated, setPreference }),
    [colorScheme, colors, isHydrated, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider is required");
  return value;
}

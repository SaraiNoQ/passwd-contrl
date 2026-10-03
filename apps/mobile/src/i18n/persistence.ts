import { ExpoSecureStoreAdapter } from "../lib/storage/mobile-secure-store";
import { resolveLanguage, setLanguage, type AppLanguage } from ".";

const LANGUAGE_PREFERENCE_KEY = "language_preference";
const languageStore = new ExpoSecureStoreAdapter();

export async function restoreLanguagePreference(): Promise<void> {
  try {
    const stored = await languageStore.getItem(LANGUAGE_PREFERENCE_KEY);
    if (stored === "zh" || stored === "en") setLanguage(resolveLanguage(stored));
  } catch {
    setLanguage("zh");
  }
}

export async function saveLanguagePreference(language: AppLanguage): Promise<boolean> {
  try {
    await languageStore.setItem(LANGUAGE_PREFERENCE_KEY, language);
    setLanguage(language);
    return true;
  } catch {
    return false;
  }
}

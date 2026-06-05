"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "obscura-theme";

export function useTheme() {
  const [theme, setThemeState] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as "light" | "dark" | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved = stored ?? (prefersDark ? "dark" : "light");
    setThemeState(resolved);
  }, []);

  const setTheme = useCallback((t: "light" | "dark") => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    if (t === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "light" ? "dark" : "light");
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}

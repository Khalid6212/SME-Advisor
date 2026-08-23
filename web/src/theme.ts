import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "sme-theme";

/**
 * Mirrors the inline script in index.html, which sets the attribute
 * synchronously before first paint to avoid a flash of the wrong theme —
 * this only needs to keep React's state in sync with what's already there.
 */
export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getTheme);

  useEffect(() => {
    setTheme(theme);
  }, [theme]);

  return [theme, setThemeState];
}

import { useEffect, useSyncExternalStore } from "react";

const KEY = "wr-landing-theme";
const listeners = new Set<() => void>();
const mq = () => window.matchMedia("(prefers-color-scheme: dark)");

function read(): "light" | "dark" {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* storage unavailable */ }
  return mq().matches ? "dark" : "light";
}

let current = read();

function set(next: "light" | "dark") {
  current = next;
  try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** One light/dark preference shared by every page; defaults to the system theme until the user picks. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current);
  return { light: theme === "light", toggle: () => set(theme === "light" ? "dark" : "light") };
}

/** Applies the preference to <html> for the app and auth pages (the landing page adds its own `stage`). */
export function useApplyTheme() {
  const { light } = useTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("stage", "light");
    root.classList.toggle("dark", !light);
  }, [light]);
}

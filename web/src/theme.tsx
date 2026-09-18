import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Theme } from "@radix-ui/themes";

export type Appearance = "inherit" | "light" | "dark";

const STORAGE_KEY = "plex-director-appearance";

interface AppearanceContextValue {
  appearance: Appearance;
  setAppearance: (value: Appearance) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function loadStoredAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "inherit") {
      return stored;
    }
  } catch {
    // localStorage can throw (private browsing, blocked site data, etc.) -
    // just fall back to following the system preference.
  }
  return "inherit";
}

function getSystemAppearance(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Radix Themes' appearance="inherit" only inherits from a parent <Theme> -
// at the root there's no ancestor and its stylesheet has no
// prefers-color-scheme fallback, so passing "inherit" straight through
// always rendered light. Resolve "inherit" against the OS preference
// ourselves and keep it live via the media query's change event.
function useSystemAppearance(): "light" | "dark" {
  const [system, setSystem] = useState<"light" | "dark">(getSystemAppearance);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => setSystem(e.matches ? "dark" : "light");
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return system;
}

// Per-viewer preference, not server config - lives in localStorage, not the
// backend settings API.
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(loadStoredAppearance);
  const systemAppearance = useSystemAppearance();
  const resolvedAppearance = appearance === "inherit" ? systemAppearance : appearance;

  function setAppearance(value: Appearance) {
    setAppearanceState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Non-fatal if it doesn't persist - just a convenience.
    }
  }

  return (
    <AppearanceContext.Provider value={{ appearance, setAppearance }}>
      <Theme appearance={resolvedAppearance} accentColor="blue" radius="medium">
        {children}
      </Theme>
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    throw new Error("useAppearance must be used within AppearanceProvider");
  }
  return ctx;
}

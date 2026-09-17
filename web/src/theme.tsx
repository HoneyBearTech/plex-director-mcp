import { createContext, useContext, useState, type ReactNode } from "react";
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

// Per-viewer preference, not server config - lives in localStorage, not the
// backend settings API.
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(loadStoredAppearance);

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
      <Theme appearance={appearance} accentColor="blue" radius="medium">
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

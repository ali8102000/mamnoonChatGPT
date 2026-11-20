import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

export type ThemeMode = "system" | "light" | "dark";
type ThemeContextValue = {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync("mamnoon_theme_mode")
      .then((saved) => {
        if (active && (saved === "light" || saved === "dark" || saved === "system")) {
          setModeState(saved);
        }
      })
      .catch((error) => {
        console.warn("[theme] Could not restore saved theme preference:", error);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      Appearance.setColorScheme(mode === "system" ? null : mode);
    } catch (error) {
      console.warn("[theme] Could not apply saved appearance; using system default:", error);
    }
  }, [mode]);

  const setMode = async (next: ThemeMode) => {
    await SecureStore.setItemAsync("mamnoon_theme_mode", next);
    setModeState(next);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved: mode === "system" ? (system === "dark" ? "dark" : "light") : mode,
      setMode,
    }),
    [mode, system],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemePreference() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useThemePreference must be used inside ThemePreferenceProvider");
  }
  return value;
}

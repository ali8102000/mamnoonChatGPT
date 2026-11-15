import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
export type ThemeMode = "system" | "light" | "dark";
type ThemeContextValue = { mode: ThemeMode; resolved: "light" | "dark"; setMode: (mode: ThemeMode) => Promise<void> };
const ThemeContext = createContext<ThemeContextValue | null>(null);
export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
 const system=useColorScheme(); const [mode,setModeState]=useState<ThemeMode>("system"); const [ready,setReady]=useState(false);
 useEffect(()=>{let active=true; SecureStore.getItemAsync("mamnoon_theme_mode").then(saved=>{if(active&&(saved==="light"||saved==="dark"||saved==="system"))setModeState(saved);}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
 useEffect(()=>{Appearance.setColorScheme(mode==="system"?null:mode);},[mode]);
 const setMode=async(next:ThemeMode)=>{setModeState(next);await SecureStore.setItemAsync("mamnoon_theme_mode",next);Appearance.setColorScheme(next==="system"?null:next);};
 const value=useMemo(()=>({mode,resolved:mode==="system"?(system==="dark"?"dark":"light"):mode,setMode}),[mode,system]);
 return <ThemeContext.Provider value={value}>{ready?children:children}</ThemeContext.Provider>;
}
export function useThemePreference(){const value=useContext(ThemeContext);if(!value)throw new Error("useThemePreference must be used inside ThemePreferenceProvider");return value;}

import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "mamnoon-notification-sound";
let soundEnabled = true;

export async function loadNotificationSoundPreference(): Promise<boolean> {
  try {
    const saved = await SecureStore.getItemAsync(STORAGE_KEY);
    soundEnabled = saved !== "0";
  } catch {
    soundEnabled = true;
  }
  return soundEnabled;
}

export async function setNotificationSoundPreference(enabled: boolean): Promise<void> {
  soundEnabled = enabled;
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, enabled ? "1" : "0");
  } catch (error) {
    console.warn("[notifications] Could not save sound preference:", error);
  }
}

export function isNotificationSoundEnabled(): boolean {
  return soundEnabled;
}

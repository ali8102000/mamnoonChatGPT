import * as SecureStore from "expo-secure-store";

const SOUND_KEY = "mamnoon-notification-sound";
const VIBRATION_KEY = "mamnoon-notification-vibration";
let soundEnabled = true;
let vibrationEnabled = true;

export type NotificationPreferences = {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
};

export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const [sound, vibration] = await Promise.all([
      SecureStore.getItemAsync(SOUND_KEY),
      SecureStore.getItemAsync(VIBRATION_KEY),
    ]);
    soundEnabled = sound !== "0";
    vibrationEnabled = vibration !== "0";
  } catch {
    soundEnabled = true;
    vibrationEnabled = true;
  }
  return { soundEnabled, vibrationEnabled };
}

export async function setNotificationPreferences(preferences: NotificationPreferences): Promise<void> {
  soundEnabled = preferences.soundEnabled;
  vibrationEnabled = preferences.vibrationEnabled;
  try {
    await Promise.all([
      SecureStore.setItemAsync(SOUND_KEY, soundEnabled ? "1" : "0"),
      SecureStore.setItemAsync(VIBRATION_KEY, vibrationEnabled ? "1" : "0"),
    ]);
  } catch (error) {
    console.warn("[notifications] Could not save preferences:", error);
  }
}

export async function loadNotificationSoundPreference(): Promise<boolean> {
  return (await loadNotificationPreferences()).soundEnabled;
}

export async function setNotificationSoundPreference(enabled: boolean): Promise<void> {
  await setNotificationPreferences({ soundEnabled: enabled, vibrationEnabled });
}

export function isNotificationSoundEnabled(): boolean {
  return soundEnabled;
}

export function isNotificationVibrationEnabled(): boolean {
  return vibrationEnabled;
}

export function getNotificationChannelId(sound = soundEnabled, vibration = vibrationEnabled): string {
  if (sound && vibration) return "mamnoon_sound_vibrate";
  if (sound) return "mamnoon_sound_only";
  if (vibration) return "mamnoon_vibrate_only";
  return "mamnoon_silent";
}

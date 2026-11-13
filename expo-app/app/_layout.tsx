import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { I18nManager, LogBox, Platform } from "react-native";
import { useEffect } from "react";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { IncomingRequestModal } from "@/components/incoming-request-modal";

I18nManager.forceRTL(true);
I18nManager.allowRTL(true);

LogBox.ignoreLogs(["Setting a timer", "AsyncStorage"]);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function PushNotificationSetup() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    let active = true;

    async function registerPushToken() {
      try {
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "إشعارات ممنون",
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: "#D4AF37",
          });
        }
        const current = await Notifications.getPermissionsAsync();
        const permission = current.granted
          ? current
          : await Notifications.requestPermissionsAsync();
        if (!permission.granted || !active) return;

        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ??
          (Constants as any).easConfig?.projectId;
        if (!projectId) {
          console.warn("[notifications] Expo project ID is missing");
          return;
        }
        const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
        if (!active) return;
        const { error } = await (supabase as any).from("user_push_tokens").upsert({
          user_id: userId,
          expo_push_token: tokenResult.data,
          device_platform: Platform.OS,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,expo_push_token" });
        if (error) console.warn("[notifications] Could not save push token:", error.message);
      } catch (error) {
        console.warn("[notifications] Push registration unavailable:", error);
      }
    }

    void registerPushToken();
    return () => { active = false; };
  }, [user?.id]);

  return null;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <PushNotificationSetup />
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#f8fafc" },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="auth/callback" />
        <Stack.Screen name="account-settings" />
        <Stack.Screen name="select-role" />
        <Stack.Screen name="home" />
        <Stack.Screen name="request/new" />
        <Stack.Screen name="request/[id]" />
        <Stack.Screen name="messages" />
        <Stack.Screen name="friends" />
        <Stack.Screen name="history" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="admin" />
        <Stack.Screen name="onboarding/driver" />
        <Stack.Screen name="onboarding/worker" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="reset-password" />
      </Stack>
      <IncomingRequestModal />
    </AuthProvider>
  );
}

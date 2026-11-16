import "@/lib/background-location";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Text, TextInput, View, useColorScheme } from "react-native";
import Svg, { Defs, Ellipse, RadialGradient, Stop } from "react-native-svg";
import { useFonts } from "@expo-google-fonts/tajawal/useFonts";
import { Tajawal_400Regular } from "@expo-google-fonts/tajawal/400Regular";
import { Tajawal_500Medium } from "@expo-google-fonts/tajawal/500Medium";
import { Tajawal_700Bold } from "@expo-google-fonts/tajawal/700Bold";
import { Tajawal_800ExtraBold } from "@expo-google-fonts/tajawal/800ExtraBold";
import { Tajawal_900Black } from "@expo-google-fonts/tajawal/900Black";
import { Alert, I18nManager, LogBox, Platform } from "react-native";
import { useEffect, useRef } from "react";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ThemePreferenceProvider } from "@/lib/theme-preference";
import { supabase } from "@/lib/supabase";
import { IncomingRequestModal } from "@/components/incoming-request-modal";
import { palette } from "@/styles/theme";
import { isNotificationSoundEnabled, loadNotificationPreferences, setNotificationPreferences } from "@/lib/notification-sound";

I18nManager.forceRTL(true);
I18nManager.allowRTL(true);
LogBox.ignoreLogs(["Setting a timer", "AsyncStorage"]);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: Platform.OS === "android" ? true : isNotificationSoundEnabled(),
    shouldSetBadge: true,
  }),
});

async function configureAndroidNotificationChannels() {
  if (Platform.OS !== "android") return;
  const common = { importance: Notifications.AndroidImportance.MAX, lightColor: "#D4AF37", enableLights: true };
  await Promise.all([
    Notifications.setNotificationChannelAsync("mamnoon_sound_vibrate", { ...common, name: "ممنون - صوت واهتزاز", sound: "default", enableVibrate: true, vibrationPattern: [0, 250, 180, 250, 180, 350] }),
    Notifications.setNotificationChannelAsync("mamnoon_sound_only", { ...common, name: "ممنون - صوت فقط", sound: "default", enableVibrate: false, vibrationPattern: [] }),
    Notifications.setNotificationChannelAsync("mamnoon_vibrate_only", { ...common, name: "ممنون - اهتزاز فقط", sound: null, enableVibrate: true, vibrationPattern: [0, 250, 180, 250, 180, 350] }),
    Notifications.setNotificationChannelAsync("mamnoon_silent", { ...common, name: "ممنون - صامت", sound: null, enableVibrate: false, vibrationPattern: [] }),
  ]);
}

function PushNotificationSetup() {
  const { user } = useAuth();
  const handledResponseId = useRef<string | null>(null);
  useEffect(() => {
    void loadNotificationPreferences().then(() => configureAndroidNotificationChannels()).catch((error) => console.warn("[notifications] Could not configure Android channels:", error));
  }, []);
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    let active = true;
    async function registerPushToken() {
      try {
        if (Platform.OS === "android") {
          await configureAndroidNotificationChannels();
          await Notifications.setNotificationCategoryAsync("incoming_request", [{ identifier: "accept", buttonTitle: "موافقة", options: { opensAppToForeground: true } }]);
          await Notifications.setNotificationChannelAsync("default", { name: "إشعارات ممنون", importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250], lightColor: "#D4AF37", sound: "default" });
          await Notifications.setNotificationChannelAsync("silent", { name: "إشعارات ممنون الصامتة", importance: Notifications.AndroidImportance.MAX, vibrationPattern: [], enableVibrate: false, enableLights: false, sound: null });
        }
        const current = await Notifications.getPermissionsAsync();
        const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
        if (!permission.granted || !active) return;
        const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
        if (!projectId) { console.warn("[notifications] Expo project ID is missing"); return; }
        const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
        if (!active) return;
        const localPreferences = await loadNotificationPreferences();
        const { data: savedPreference, error: preferenceError } = await supabase.from("user_push_tokens").select("sound_enabled,vibration_enabled").eq("user_id", userId).limit(1).maybeSingle();
        if (preferenceError) console.warn("[notifications] Could not read sound preference:", preferenceError.message);
        const soundEnabled = typeof savedPreference?.sound_enabled === "boolean" ? savedPreference.sound_enabled : localPreferences.soundEnabled;
        const vibrationEnabled = typeof savedPreference?.vibration_enabled === "boolean" ? savedPreference.vibration_enabled : localPreferences.vibrationEnabled;
        await setNotificationPreferences({ soundEnabled, vibrationEnabled });
        const { error } = await supabase.from("user_push_tokens").upsert({ user_id: userId, expo_push_token: tokenResult.data, device_platform: Platform.OS, sound_enabled: soundEnabled, vibration_enabled: vibrationEnabled, updated_at: new Date().toISOString() }, { onConflict: "user_id,expo_push_token" });
        if (error) console.warn("[notifications] Could not save push token:", error.message);
      } catch (error) { console.warn("[notifications] Push registration unavailable:", error); }
    }
    async function openRequestFromResponse(response: Notifications.NotificationResponse | null) {
      if (!response) return;
      const responseId = response.notification.request.identifier;
      if (handledResponseId.current === responseId) return;
      const data = response.notification.request.content.data as { request_id?: unknown; type?: unknown };
      handledResponseId.current = responseId;
      if (typeof data?.request_id === "string" && response.actionIdentifier === "accept") {
        const { error } = await supabase.rpc("accept_service_request", { _request_id: data.request_id });
        if (error) Alert.alert("تعذّر قبول الطلب", error.message || "قد يكون العرض انتهى أو قبله مزوّد آخر.");
        else router.push({ pathname: "/request/[id]", params: { id: data.request_id } });
      } else if (typeof data?.request_id === "string") router.push({ pathname: "/request/[id]", params: { id: data.request_id } });
      else if (data?.type === "taxi_high_demand") router.push("/subscriptions" as any);
      else if (data?.type === "subscription_granted" || data?.type === "company_announcement") router.push("/home");
      else router.push("/profile");
    }
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(openRequestFromResponse);
    void Notifications.getLastNotificationResponseAsync().then((response) => { if (active) openRequestFromResponse(response); }).catch((error) => console.warn("[notifications] Could not read notification response:", error));
    void registerPushToken();
    return () => { active = false; responseSubscription.remove(); };
  }, [user?.id]);
  return null;
}

function ApplicationBackdrop() {
  const dark = useColorScheme() === "dark";
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: palette.canvasSolid }}>
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none" style={{ position: "absolute", top: 0, left: 0 }}>
        <Defs>
          <RadialGradient id="mamnoonPrimaryGlow" cx="75%" cy="0%" rx="90%" ry="65%" gradientUnits="objectBoundingBox">
            <Stop offset="0%" stopColor={dark ? "#5FA7FF" : "#0065D2"} stopOpacity={dark ? 0.12 : 0.28} />
            <Stop offset="55%" stopColor={dark ? "#5FA7FF" : "#0065D2"} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="mamnoonGoldGlow" cx="15%" cy="100%" rx="80%" ry="60%" gradientUnits="objectBoundingBox">
            <Stop offset="0%" stopColor="#E9AB2B" stopOpacity={dark ? 0.06 : 0.10} />
            <Stop offset="50%" stopColor="#E9AB2B" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="mamnoonSideGlow" cx="100%" cy="50%" rx="70%" ry="50%" gradientUnits="objectBoundingBox">
            <Stop offset="0%" stopColor={dark ? "#669CFF" : "#5283FE"} stopOpacity={dark ? 0.05 : 0.08} />
            <Stop offset="45%" stopColor={dark ? "#669CFF" : "#5283FE"} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx="195" cy="0" rx="351" ry="548" fill="url(#mamnoonPrimaryGlow)" />
        <Ellipse cx="58" cy="844" rx="312" ry="506" fill="url(#mamnoonGoldGlow)" />
        {!dark && <Ellipse cx="390" cy="422" rx="273" ry="422" fill="url(#mamnoonSideGlow)" />}
      </Svg>
    </View>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({ Tajawal_400Regular, Tajawal_500Medium, Tajawal_700Bold, Tajawal_800ExtraBold, Tajawal_900Black });
  if (!fontsLoaded) return null;
  (Text as any).defaultProps = { ...(Text as any).defaultProps, style: [{ fontFamily: "Tajawal_400Regular" }, (Text as any).defaultProps?.style] };
  (TextInput as any).defaultProps = { ...(TextInput as any).defaultProps, style: [{ fontFamily: "Tajawal_400Regular" }, (TextInput as any).defaultProps?.style] };
  return (
    <ThemePreferenceProvider>
      <AuthProvider>
        <PushNotificationSetup />
        <View style={{ flex: 1, backgroundColor: palette.canvasSolid }}>
          <ApplicationBackdrop />
          <StatusBar style={colorScheme === "dark" ? "light" : "dark"} backgroundColor={palette.canvasSolid} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" }, animation: "slide_from_right" }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="auth" />
            <Stack.Screen name="auth/callback" />
            <Stack.Screen name="account-settings" />
            <Stack.Screen name="select-role" />
            <Stack.Screen name="home" />
            <Stack.Screen name="request/new" />
            <Stack.Screen name="request/[id]" />
            <Stack.Screen name="request/chat/[id]" options={{ headerShown: false, presentation: "card", animation: "slide_from_right" }} />
            <Stack.Screen name="messages" />
            <Stack.Screen name="support-chat" />
            <Stack.Screen name="friends" />
            <Stack.Screen name="history" />
            <Stack.Screen name="profile" />
            <Stack.Screen name="admin" />
            <Stack.Screen name="admin/staff" />
            <Stack.Screen name="admin/live-map" />
            <Stack.Screen name="admin/friends" />
            <Stack.Screen name="admin/notifications" />
            <Stack.Screen name="onboarding/driver" />
            <Stack.Screen name="onboarding/worker" />
            <Stack.Screen name="forgot-password" />
            <Stack.Screen name="reset-password" />
          </Stack>
          <IncomingRequestModal />
        </View>
      </AuthProvider>
    </ThemePreferenceProvider>
  );
}

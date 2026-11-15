import "@/lib/background-location";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Text, TextInput } from "react-native";
import { useFonts } from "@expo-google-fonts/tajawal/useFonts";
import { Tajawal_400Regular } from "@expo-google-fonts/tajawal/400Regular";
import { Tajawal_500Medium } from "@expo-google-fonts/tajawal/500Medium";
import { Tajawal_700Bold } from "@expo-google-fonts/tajawal/700Bold";
import { Tajawal_800ExtraBold } from "@expo-google-fonts/tajawal/800ExtraBold";
import { Tajawal_900Black } from "@expo-google-fonts/tajawal/900Black";
import { Alert, I18nManager, LogBox, Platform, useColorScheme } from "react-native";
import { useEffect, useRef } from "react";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ThemePreferenceProvider } from "@/lib/theme-preference";
import { supabase } from "@/lib/supabase";
import { IncomingRequestModal } from "@/components/incoming-request-modal";
import { palette } from "@/styles/theme";
import { isNotificationSoundEnabled, loadNotificationSoundPreference } from "@/lib/notification-sound";

I18nManager.forceRTL(true);
I18nManager.allowRTL(true);

LogBox.ignoreLogs(["Setting a timer", "AsyncStorage"]);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: isNotificationSoundEnabled(),
    shouldSetBadge: true,
  }),
});

function PushNotificationSetup() {
  const { user } = useAuth();
  const handledResponseId = useRef<string | null>(null);

  useEffect(() => {
    void loadNotificationSoundPreference();
  }, []);

  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    let active = true;

    async function registerPushToken() {
      try {
        if (Platform.OS === "android") {
          await Notifications.setNotificationCategoryAsync("incoming_request", [
            {
              identifier: "accept",
              buttonTitle: "موافقة",
              options: { opensAppToForeground: true },
            },
          ]);
          await Notifications.setNotificationChannelAsync("default", {
            name: "إشعارات ممنون",
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: "#D4AF37",
            sound: "default",
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

        const { error } = await supabase.from("user_push_tokens").upsert(
          {
            user_id: userId,
            expo_push_token: tokenResult.data,
            device_platform: Platform.OS,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,expo_push_token" },
        );
        if (error) {
          console.warn("[notifications] Could not save push token:", error.message);
        }
      } catch (error) {
        console.warn("[notifications] Push registration unavailable:", error);
      }
    }

    async function openRequestFromResponse(response: Notifications.NotificationResponse | null) {
      if (!response) return;
      const responseId = response.notification.request.identifier;
      if (handledResponseId.current === responseId) return;
      const data = response.notification.request.content.data as {
        request_id?: unknown;
        type?: unknown;
      };
      handledResponseId.current = responseId;
      if (typeof data?.request_id === "string" && response.actionIdentifier === "accept") {
        const { error } = await supabase.rpc("accept_service_request", {
          _request_id: data.request_id,
        });
        if (error) {
          Alert.alert("تعذّر قبول الطلب", error.message || "قد يكون العرض انتهى أو قبله مزوّد آخر.");
        } else {
          router.push({ pathname: "/request/[id]", params: { id: data.request_id } });
        }
      } else if (typeof data?.request_id === "string") {
        router.push({
          pathname: "/request/[id]",
          params: { id: data.request_id },
        });
      } else if (data?.type === "taxi_high_demand") {
        router.push("/subscriptions" as any);
      } else if (data?.type === "subscription_granted" || data?.type === "company_announcement") {
        router.push("/home");
      } else {
        router.push("/profile");
      }
    }

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener(openRequestFromResponse);
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (active) openRequestFromResponse(response);
      })
      .catch((error) => {
        console.warn("[notifications] Could not read notification response:", error);
      });

    void registerPushToken();
    return () => {
      active = false;
      responseSubscription.remove();
    };
  }, [user?.id]);

  return null;
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
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} backgroundColor={palette.canvas} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.canvas },
          animation: "slide_from_right",
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
    </AuthProvider>
    </ThemePreferenceProvider>
  );
}

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/lib/supabase";

const LOCATION_TASK = "mamnoon-active-request-location";
const CONTEXT_KEY = "mamnoon-active-location-context";

type TrackingContext = { requestId: string; userId: string; role: "customer" | "provider" };

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) {
    if (error) console.warn("[Mamnoon background location]", error.message);
    return;
  }
  try {
    const raw = await SecureStore.getItemAsync(CONTEXT_KEY);
    if (!raw) {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      }
      return;
    }
    const context = JSON.parse(raw) as TrackingContext;
    const { data: request, error: requestError } = await supabase
      .from("service_requests")
      .select("customer_id, provider_id, status")
      .eq("id", context.requestId)
      .maybeSingle();
    const isParticipant = request &&
      (request.customer_id === context.userId || request.provider_id === context.userId);
    const isActive = request && ["accepted", "in_progress"].includes(request.status);
    if (requestError || !isParticipant || !isActive) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
      await SecureStore.deleteItemAsync(CONTEXT_KEY);
      return;
    }
    const locations = (data as { locations?: Location.LocationObject[] }).locations ?? [];
    for (const location of locations) {
      const { error: writeError } = await supabase.from("live_locations").upsert({
        request_id: context.requestId,
        user_id: context.userId,
        role: context.role,
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        heading: location.coords.heading,
        updated_at: new Date(location.timestamp).toISOString(),
      }, { onConflict: "request_id,user_id" });
      if (writeError) console.warn("[Mamnoon background location] update failed:", writeError.message);
    }
  } catch (taskError) {
    console.warn("[Mamnoon background location] task failed:", taskError);
  }
});

export async function startMamnoonBackgroundLocation(context: TrackingContext) {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") throw new Error("foreground_location_denied");
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== "granted") throw new Error("background_location_denied");

  await SecureStore.setItemAsync(CONTEXT_KEY, JSON.stringify(context));
  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (alreadyStarted) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 5000,
    distanceInterval: 10,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "ممنون يشارك موقعك أثناء الطلب",
      notificationBody: "تتبع الموقع يعمل فقط خلال الطلب النشط ويمكنك إيقافه بإنهاء الطلب.",
      notificationColor: "#D4AF37",
    },
  });
}

export async function stopMamnoonBackgroundLocation() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  await SecureStore.deleteItemAsync(CONTEXT_KEY);
}

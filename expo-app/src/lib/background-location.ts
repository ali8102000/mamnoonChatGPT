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
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || authData.user?.id !== context.userId) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
      await SecureStore.deleteItemAsync(CONTEXT_KEY);
      return;
    }
    const { data: request, error: requestError } = await supabase
      .from("service_requests")
      .select("customer_id, provider_id, status")
      .eq("id", context.requestId)
      .maybeSingle();
    const isCorrectParticipant = request && (
      (context.role === "customer" && request.customer_id === context.userId) ||
      (context.role === "provider" && request.provider_id === context.userId)
    );
    const isActive = request && ["accepted", "in_progress"].includes(request.status);
    if (requestError || !isCorrectParticipant || !isActive) {
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

      if (
        context.role === "provider" &&
        Number.isFinite(location.coords.accuracy) &&
        Number(location.coords.accuracy) <= 100
      ) {
        // Foreground GPS already records denser breadcrumbs (8 m / 10 s).
        // Background tracking adds a point only after a larger movement or
        // a longer gap, avoiding near-duplicate route points while both run.
        const { data: lastPoint, error: lastPointError } = await supabase
          .from("trip_location_points")
          .select("lat,lng,recorded_at")
          .eq("request_id", context.requestId)
          .eq("role", "provider")
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastPointError) {
          console.warn("[Mamnoon background location] route history check failed:", lastPointError.message);
        } else {
          const elapsed = lastPoint?.recorded_at
            ? location.timestamp - Date.parse(lastPoint.recorded_at)
            : Number.POSITIVE_INFINITY;
          const distance = lastPoint
            ? Math.hypot(
                (location.coords.latitude - lastPoint.lat) * 111320,
                (location.coords.longitude - lastPoint.lng) * 111320 *
                  Math.cos(location.coords.latitude * Math.PI / 180),
              )
            : Number.POSITIVE_INFINITY;
          if (!lastPoint || distance >= 25 || elapsed >= 30_000) {
            const { error: pointError } = await supabase.from("trip_location_points").insert({
              request_id: context.requestId,
              user_id: context.userId,
              role: context.role,
              lat: location.coords.latitude,
              lng: location.coords.longitude,
              heading: location.coords.heading,
              accuracy_m: location.coords.accuracy,
              recorded_at: new Date(location.timestamp).toISOString(),
            });
            if (pointError) console.warn("[Mamnoon background location] route point insert failed:", pointError.message);
          }
        }
      }
    }
  } catch (taskError) {
    console.warn("[Mamnoon background location] task failed:", taskError);
  }
});


const PROVIDER_PRESENCE_TASK = "mamnoon-provider-presence-background";
const PROVIDER_CONTEXT_KEY = "mamnoon-provider-presence-context";

type ProviderPresenceContext = {
  userId: string;
  role: "driver" | "large_driver" | "worker";
};

TaskManager.defineTask(PROVIDER_PRESENCE_TASK, async ({ data, error }) => {
  if (error || !data) {
    if (error) console.warn("[Mamnoon provider presence]", error.message);
    return;
  }
  try {
    const raw = await SecureStore.getItemAsync(PROVIDER_CONTEXT_KEY);
    if (!raw) {
      await Location.stopLocationUpdatesAsync(PROVIDER_PRESENCE_TASK).catch(() => undefined);
      return;
    }
    const context = JSON.parse(raw) as ProviderPresenceContext;
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || authData.user?.id !== context.userId) {
      await Location.stopLocationUpdatesAsync(PROVIDER_PRESENCE_TASK).catch(() => undefined);
      await SecureStore.deleteItemAsync(PROVIDER_CONTEXT_KEY);
      return;
    }
    const table = context.role === "worker" ? "worker_profiles" : "driver_profiles";
    const { data: profile, error: profileError } = await supabase
      .from(table)
      .select("available, status")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (profileError || !profile?.available || profile.status !== "approved") {
      await Location.stopLocationUpdatesAsync(PROVIDER_PRESENCE_TASK).catch(() => undefined);
      await SecureStore.deleteItemAsync(PROVIDER_CONTEXT_KEY);
      return;
    }
    const locations = (data as { locations?: Location.LocationObject[] }).locations ?? [];
    for (const location of locations) {
      const { error: writeError } = await supabase.from("provider_presence").upsert({
        user_id: context.userId,
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        heading:
          location.coords.heading != null &&
          Number.isFinite(location.coords.heading) &&
          location.coords.heading >= 0 &&
          location.coords.heading <= 360
            ? location.coords.heading
            : null,
        updated_at: new Date(location.timestamp).toISOString(),
      }, { onConflict: "user_id" });
      if (writeError) console.warn("[Mamnoon provider presence] update failed:", writeError.message);
    }
  } catch (taskError) {
    console.warn("[Mamnoon provider presence] task failed:", taskError);
  }
});

export async function startProviderPresenceBackgroundLocation(
  context: ProviderPresenceContext,
) {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") throw new Error("foreground_location_denied");
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== "granted") {
    // Foreground presence is still valid while the app is open. Do not block
    // provider availability solely because Android background access was denied.
    await Location.stopLocationUpdatesAsync(PROVIDER_PRESENCE_TASK).catch(() => undefined);
    await SecureStore.deleteItemAsync(PROVIDER_CONTEXT_KEY);
    return false;
  }

  await SecureStore.setItemAsync(PROVIDER_CONTEXT_KEY, JSON.stringify(context));
  if (await Location.hasStartedLocationUpdatesAsync(PROVIDER_PRESENCE_TASK)) {
    await Location.stopLocationUpdatesAsync(PROVIDER_PRESENCE_TASK);
  }
  await Location.startLocationUpdatesAsync(PROVIDER_PRESENCE_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 30_000,
    distanceInterval: 25,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "ممنون يستقبل الطلبات",
      notificationBody: "موقعك يتحدث حتى تصلك طلبات قريبة أثناء استخدام تطبيقات أخرى.",
      notificationColor: "#D4AF37",
    },
  });
  return true;
}

export async function stopProviderPresenceBackgroundLocation() {
  if (await Location.hasStartedLocationUpdatesAsync(PROVIDER_PRESENCE_TASK)) {
    await Location.stopLocationUpdatesAsync(PROVIDER_PRESENCE_TASK);
  }
  await SecureStore.deleteItemAsync(PROVIDER_CONTEXT_KEY);
}

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

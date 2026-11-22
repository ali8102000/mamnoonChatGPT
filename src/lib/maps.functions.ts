import { supabase } from "@/integrations/supabase/client";

type MapLookupInput =
  | { action: "autocomplete"; input: string; sessionToken: string; center: { lat: number; lng: number }; governorateKey?: string; mapProvider?: "google" | "leaflet" | null }
  | { action: "details"; placeId: string; sessionToken: string }
  | { action: "reverse"; center: { lat: number; lng: number } }
  | { action: "nearby"; center: { lat: number; lng: number }; governorateKey: string }
  | { action: "route"; from: { lat: number; lng: number }; to: { lat: number; lng: number } }
  | { action: "validateGovernorate"; center: { lat: number; lng: number }; governorateKey: string }
  | { action: "detectGovernorate"; center: { lat: number; lng: number } };

export async function lookupMapPlace({ data }: { data: MapLookupInput }) {
  const { data: result, error } = await supabase.functions.invoke("maps-proxy", { body: data });
  if (error) {
    const message = typeof (result as any)?.error === "string"
      ? (result as any).error
      : error.message || "تعذّر الاتصال بخدمة الخرائط.";
    throw new Error(message);
  }
  if (result && typeof result === "object" && typeof (result as any).error === "string") {
    throw new Error((result as any).error);
  }
  return result;
}


export type LiveRoadRoute = {
  distanceKm?: number;
  durationMin?: number;
  staticDurationMin?: number;
  routeSource?: string;
  routePoints?: { lat: number; lng: number }[];
  routeSteps?: { instruction: string; distanceMeters: number; durationSeconds: number; maneuver?: string }[];
  trafficSegments?: { startIndex: number; endIndex: number; speed: string }[];
};

export async function getLiveRoadRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const { data, error } = await supabase.functions.invoke("maps-proxy", {
    body: { action: "route", from, to, includeGeometry: true },
  });
  if (error) {
    const message = data && typeof data === "object" && typeof (data as any).error === "string"
      ? (data as any).error
      : error.message || "تعذّر حساب مسار الشوارع.";
    throw new Error(message);
  }
  if (!data || typeof data !== "object" || typeof (data as any).error === "string") {
    throw new Error(typeof (data as any)?.error === "string" ? (data as any).error : "لم يصل مسار صالح من خدمة الخرائط.");
  }
  const route = data as LiveRoadRoute;
  if (!Array.isArray(route.routePoints) || route.routePoints.length < 2) {
    throw new Error("لم يتم العثور على مسار طرق صالح.");
  }
  return route;
}

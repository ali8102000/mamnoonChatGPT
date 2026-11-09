import { useCallback, useEffect, useRef, useState } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

type Coords = { lat: number; lng: number; heading?: number | null };

const MIN_DISTANCE_M = 15;
const MAX_INTERVAL_MS = 4000;

function distanceMeters(a: Coords, b: Coords): number {
  const radius = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

export function useLiveTracking(opts: {
  requestId: string | null;
  myUserId: string | null;
  otherUserId: string | null;
  myRole: "customer" | "provider";
  active: boolean;
}) {
  const { requestId, myUserId, otherUserId, myRole, active } = opts;
  const [me, setMe] = useState<Coords | null>(null);
  const [other, setOther] = useState<Coords | null>(null);
  const watchRef = useRef<number | null>(null);
  const lastPushRef = useRef<Coords | null>(null);
  const lastPushTimeRef = useRef(0);

  const push = useCallback((lat: number, lng: number, heading: number | null) => {
    if (!requestId || !myUserId) return;
    const now = Date.now();
    const coords: Coords = { lat, lng, heading };
    if (lastPushRef.current) {
      const distance = distanceMeters(lastPushRef.current, coords);
      const elapsed = now - lastPushTimeRef.current;
      if (distance < MIN_DISTANCE_M && elapsed < MAX_INTERVAL_MS) return;
    }
    lastPushRef.current = coords;
    lastPushTimeRef.current = now;
    void supabase
      .from("live_locations")
      .upsert({
        request_id: requestId,
        user_id: myUserId,
        role: myRole,
        lat,
        lng,
        heading,
        updated_at: new Date().toISOString(),
      }, { onConflict: "request_id,user_id" })
      .then(({ error }) => {
        if (error) console.warn("[live-tracking] upsert error:", error.message);
      });
  }, [requestId, myUserId, myRole]);

  useEffect(() => {
    if (!active || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          heading: position.coords.heading,
        };
        setMe(coords);
        push(coords.lat, coords.lng, coords.heading ?? null);
      },
      (error) => console.warn("[live-tracking] geolocation error:", error.message),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );
    watchRef.current = watchId;
    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };
  }, [active, push]);

  useEffect(() => {
    if (!active || !requestId || !otherUserId) return;
    const channel = supabase
      .channel(`live-${requestId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_locations", filter: `request_id=eq.${requestId}` },
        (payload) => {
          const row = payload.new as Tables<"live_locations">;
          if (row.user_id === otherUserId) {
            setOther({ lat: row.lat, lng: row.lng, heading: row.heading });
          }
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") console.warn("[live-tracking] channel error");
      });

    void supabase
      .from("live_locations")
      .select("*")
      .eq("request_id", requestId)
      .eq("user_id", otherUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setOther({ lat: data.lat, lng: data.lng, heading: data.heading });
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [active, requestId, otherUserId]);

  return { me, other };
}

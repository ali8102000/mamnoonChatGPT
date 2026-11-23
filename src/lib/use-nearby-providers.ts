import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { findNearbyProviderPins, type ProviderPin as ServerPin } from "@/lib/dispatch.functions";

export type ProviderPin = {
  pin_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  updatedAt: string;
  accuracyM: number | null;
};

export function useNearbyProviders(opts: {
  center: { lat: number; lng: number } | null;
  type: "taxi" | "service";
  category?: string | null;
  serviceId?: string | null;
  radiusKm?: number;
  enabled?: boolean;
  intervalMs?: number;
}) {
  const {
    center,
    type,
    category,
    serviceId,
    radiusKm = 5,
    enabled = true,
    intervalMs = 15000,
  } = opts;
  const [pins, setPins] = useState<ProviderPin[]>([]);
  const timerRef = useRef<any>(null);
  const debounceRef = useRef<any>(null);
  const findPinsFn = useServerFn(findNearbyProviderPins);
  const centerLat = center?.lat;
  const centerLng = center?.lng;

  useEffect(() => {
    if (!enabled || centerLat == null || centerLng == null) {
      setPins([]);
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const fetchPins = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const rows = await findPinsFn({
          data: {
            lat: centerLat,
            lng: centerLng,
            type,
            category,
            serviceId,
            radiusKm,
            limit: 30,
          },
        });
        if (cancelled) return;
        const nextPins = (rows as ServerPin[]).map((r) => ({
          pin_id: String(r.pin_id),
          lat: Number(r.lat),
          lng: Number(r.lng),
          heading: r.heading == null ? null : Number(r.heading),
          updatedAt: String(r.updated_at ?? ""),
          accuracyM: r.accuracy_m == null ? null : Number(r.accuracy_m),
        })).filter((pin) => {
          const ageMs = Date.now() - Date.parse(pin.updatedAt);
          return Number.isFinite(ageMs) && ageMs >= -5_000 && ageMs <= 90_000 &&
            (pin.accuracyM == null || (Number.isFinite(pin.accuracyM) && pin.accuracyM <= 100));
        });
        setPins((current) => {
          if (current.length !== nextPins.length) return nextPins;
          const unchanged = current.every((pin, index) => {
            const next = nextPins[index];
            return pin.pin_id === next.pin_id && pin.lat === next.lat &&
              pin.lng === next.lng && pin.heading === next.heading &&
              pin.updatedAt === next.updatedAt && pin.accuracyM === next.accuracyM;
          });
          return unchanged ? current : nextPins;
        });
      } catch {
        // Never leave a provider visible after its last confirmed GPS fix expires.
        if (!cancelled) {
          setPins((current) => current.filter((pin) => {
            const ageMs = Date.now() - Date.parse(pin.updatedAt);
            return Number.isFinite(ageMs) && ageMs >= -5_000 && ageMs <= 90_000;
          }));
        }
      } finally {
        inFlight = false;
      }
    };

    fetchPins();

    timerRef.current = setInterval(fetchPins, intervalMs);

    const ch = supabase
      .channel("provider-pins")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "provider_presence" },
        () => {
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(fetchPins, 2000);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
      clearTimeout(debounceRef.current);
      supabase.removeChannel(ch);
    };
  }, [centerLat, centerLng, findPinsFn, type, category, serviceId, radiusKm, enabled, intervalMs]);

  return pins;
}

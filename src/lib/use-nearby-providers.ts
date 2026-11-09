import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { findNearbyProviderPins, type ProviderPin as ServerPin } from "@/lib/dispatch.functions";

export type ProviderPin = {
  pin_id: string;
  lat: number;
  lng: number;
  heading: number | null;
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
  const centerLat = center?.lat ?? null;
  const centerLng = center?.lng ?? null;
  const [pins, setPins] = useState<ProviderPin[]>([]);
  const timerRef = useRef<any>(null);
  const inflightRef = useRef(false);
  const findPinsFn = useServerFn(findNearbyProviderPins);

  useEffect(() => {
    if (!enabled || centerLat == null || centerLng == null) {
      setPins([]);
      return;
    }

    let cancelled = false;

    const fetchPins = async () => {
      if (inflightRef.current) return;
      inflightRef.current = true;
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
        setPins(
          (rows as ServerPin[]).map((r) => ({
            pin_id: String(r.pin_id),
            lat: Number(r.lat),
            lng: Number(r.lng),
            heading: r.heading == null ? null : Number(r.heading),
          })),
        );
      } catch {
        // ignore — pins are non-critical
      } finally {
        inflightRef.current = false;
      }
    };

    fetchPins();

    timerRef.current = setInterval(fetchPins, intervalMs);



    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
    };
  }, [centerLat, centerLng, type, category, serviceId, radiusKm, enabled, intervalMs, findPinsFn]);

  return pins;
}

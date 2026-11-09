type Coordinates = { lat: number; lng: number };

export type DrivingRoute = {
  distanceKm: number;
  durationMin: number;
};

/** Server-only Google Routes lookup. Never accepts a client-supplied distance or fare. */
export async function getTrustedDrivingRoute(from: Coordinates, to: Coordinates): Promise<DrivingRoute> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!apiKey || !lovableKey) {
    throw new Error("خدمة حساب مسار الطريق غير مهيأة؛ لم ننشئ الطلب حتى لا نعتمد أجرة غير موثوقة.");
  }

  const response = await fetch("https://connector-gateway.lovable.dev/google_maps/routes/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": apiKey,
      "Content-Type": "application/json",
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: "DRIVE",
    }),
  });

  if (!response.ok) {
    throw new Error("تعذر حساب مسافة الطريق من خرائط Google؛ حاول مرة أخرى لاحقاً.");
  }

  const result = await response.json() as {
    routes?: Array<{ distanceMeters?: number; duration?: string }>;
  };
  const route = result.routes?.[0];
  const distanceKm = Number(route?.distanceMeters ?? 0) / 1000;
  const durationMin = Number.parseFloat(String(route?.duration ?? "0s")) / 60;

  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 1500
    || !Number.isFinite(durationMin) || durationMin <= 0 || durationMin > 2880) {
    throw new Error("لم نحصل على مسار طريق صالح؛ تحقق من نقطتي الانطلاق والوجهة.");
  }

  return { distanceKm, durationMin };
}

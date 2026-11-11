export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateFare(
  km: number,
  category: "economy" | "premium" | "luxury" = "economy",
): number {
  void category;
  return Math.max(0, Math.round(km * 400));
}

export function estimateEtaMinutes(km: number): number {
  return Math.max(2, Math.round(km / 0.5));
}

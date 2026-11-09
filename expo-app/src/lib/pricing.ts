export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateFare(km: number, category: 'economy' | 'premium' | 'luxury' = 'economy'): number {
  const baseFare = category === 'luxury' ? 8000 : category === 'premium' ? 5000 : 3000;
  const perKm = category === 'luxury' ? 1500 : category === 'premium' ? 1000 : 700;
  const raw = baseFare + km * perKm;
  return Math.round(raw / 250) * 250;
}

export function estimateEtaMinutes(km: number): number {
  return Math.max(2, Math.round(km / 0.5));
}

export type MobileGovernorate = {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
};

export const IRAQ_GOVERNORATES: MobileGovernorate[] = [
  { key: "baghdad", name: "بغداد", latitude: 33.3152, longitude: 44.3661 },
  { key: "basra", name: "البصرة", latitude: 30.5085, longitude: 47.7804 },
  { key: "nineveh", name: "نينوى", latitude: 36.34, longitude: 43.13 },
  { key: "erbil", name: "أربيل", latitude: 36.1911, longitude: 44.0092 },
  { key: "sulaymaniyah", name: "السليمانية", latitude: 35.5613, longitude: 45.4306 },
  { key: "duhok", name: "دهوك", latitude: 36.8669, longitude: 42.9503 },
  { key: "kirkuk", name: "كركوك", latitude: 35.4681, longitude: 44.3922 },
  { key: "najaf", name: "النجف", latitude: 32.0259, longitude: 44.3462 },
  { key: "karbala", name: "كربلاء", latitude: 32.616, longitude: 44.0249 },
  { key: "babil", name: "بابل", latitude: 32.4637, longitude: 44.4196 },
  { key: "anbar", name: "الأنبار", latitude: 33.4206, longitude: 43.3058 },
  { key: "diyala", name: "ديالى", latitude: 33.7502, longitude: 44.6066 },
  { key: "saladin", name: "صلاح الدين", latitude: 34.6, longitude: 43.68 },
  { key: "wasit", name: "واسط", latitude: 32.5128, longitude: 45.8182 },
  { key: "dhiqar", name: "ذي قار", latitude: 31.0439, longitude: 46.2573 },
  { key: "maysan", name: "ميسان", latitude: 31.8356, longitude: 47.1449 },
  { key: "muthanna", name: "المثنى", latitude: 31.3099, longitude: 45.2803 },
  { key: "qadisiyah", name: "القادسية", latitude: 31.9929, longitude: 44.925 },
];

export function nearestGovernorateKey(coords: { latitude: number; longitude: number }): string {
  let best = IRAQ_GOVERNORATES[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const governorate of IRAQ_GOVERNORATES) {
    const lat = coords.latitude - governorate.latitude;
    const lng = (coords.longitude - governorate.longitude) * Math.cos((coords.latitude * Math.PI) / 180);
    const distance = lat * lat + lng * lng;
    if (distance < bestDistance) {
      best = governorate;
      bestDistance = distance;
    }
  }
  return best.key;
}

export function getMobileGovernorate(key: string | null | undefined) {
  return IRAQ_GOVERNORATES.find((governorate) => governorate.key === key) ?? null;
}

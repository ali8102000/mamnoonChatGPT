export type Coordinates = { lat: number; lng: number; accuracy?: number };

/** Requests a fresh high-accuracy browser fix; never falls back to cached or low-accuracy coordinates. */
export function getCurrentLocation(
  geolocation: Pick<Geolocation, "getCurrentPosition">,
): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    let best: GeolocationPosition | null = null;
    let attempts = 0;
    const request = () => {
      attempts += 1;
      geolocation.getCurrentPosition(
        (position) => {
          if (!best || (position.coords.accuracy ?? Infinity) < (best.coords.accuracy ?? Infinity)) best = position;
          const accuracy = position.coords.accuracy;
          if (accuracy != null && accuracy <= 35) {
            resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy });
            return;
          }
          if (attempts < 2) { request(); return; }
          if (best && best.coords.accuracy != null && best.coords.accuracy <= 50) {
            resolve({ lat: best.coords.latitude, lng: best.coords.longitude, accuracy: best.coords.accuracy });
            return;
          }
          reject({ code: 3, accuracy: best?.coords.accuracy ?? null });
        },
        (error) => {
          if (error.code === 1 || attempts >= 2) { reject(error); return; }
          request();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    };
    request();
  });
}

export function locationError(error: { code?: number; accuracy?: number | null }) {
  if (error.code === 1) return "اسمح بالوصول للموقع من إعدادات الجهاز أو المتصفح، ثم حاول مرة ثانية.";
  if (error.accuracy != null && error.accuracy > 50) return "إشارة الموقع غير دقيقة حالياً (هامش الخطأ نحو " + Math.round(error.accuracy) + " متر). اطلع لمكان مفتوح وحاول مرة ثانية.";
  if (error.code === 3) return "ما حصلنا إشارة GPS دقيقة كفاية. فعّل GPS وجرّب من مكان مفتوح.";
  return "تعذّر تحديد موقعك؛ فعّل خدمات الموقع وحاول مرة ثانية.";
}

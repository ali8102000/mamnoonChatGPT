/** Never turn unavailable driving routes into invented distances or durations. */
export function parseDrivingRoute(result: {
  routes?: Array<{ distanceMeters?: number; duration?: string }>;
}) {
  const routes = result.routes ?? [];
  const validRoutes = routes.filter((route) =>
    Number.isFinite(route.distanceMeters ?? 0) &&
    (route.distanceMeters ?? 0) >= 0 &&
    typeof route.duration === "string" &&
    /^\d+(\.\d+)?s$/.test(route.duration),
  );
  if (!validRoutes.length) {
    if (!routes.length) throw new Error("لم يتم العثور على طريق للسيارة بين النقطتين");
    throw new Error("تعذّر قراءة مسافة الطريق؛ أعد المحاولة");
  }

  // Google can return up to three valid alternatives. Use the shortest actual
  // road route, rather than letting a sudden preferred-route switch inflate fare.
  const route = validRoutes.reduce((shortest, candidate) =>
    (candidate.distanceMeters ?? 0) < (shortest.distanceMeters ?? 0) ? candidate : shortest,
  );
  const meters = route.distanceMeters ?? 0;
  return { distanceKm: meters / 1000, durationMin: parseFloat(route.duration!) / 60 };
}

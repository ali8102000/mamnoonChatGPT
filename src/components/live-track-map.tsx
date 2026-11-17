import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { loadGoogleMaps } from "@/lib/google-maps";
import { Loader2, Navigation, Maximize2, Minimize2 } from "lucide-react";
import { toast } from "@/lib/toast";

export type Coords = { lat: number; lng: number; heading?: number | null; updatedAt?: string; accuracy?: number };

function haversineKm(a: Coords, b: Coords) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function bearingDeg(a: Coords, b: Coords) {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const lambda1 = (a.lng * Math.PI) / 180;
  const lambda2 = (b.lng * Math.PI) / 180;
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export interface LiveTrackMapProps {
  me: Coords | null;
  other: Coords | null;
  routePoints?: Coords[];
  pickupCoords?: Coords | null;
  destCoords?: Coords | null;
  status?: string;
  myRole?: "customer" | "provider";
  serviceType?: "taxi" | "service";
  driverName?: string;
  driverPhone?: string;
  vehicleCategory?: string;
  meColor?: string;
  otherColor?: string;
  height?: number;
  follow?: boolean;
  onOpenNavigation?: () => void;
  fullscreen?: boolean;
  showStatusOverlay?: boolean;
  onClose?: () => void;
}

export function LiveTrackMap({
  me,
  other,
  routePoints = [],
  pickupCoords,
  destCoords,
  status = "accepted",
  myRole = "customer",
  serviceType = "taxi",
  driverName = "الفني",
  meColor = "#0284c7",
  otherColor = "#16a34a",
  height = 280,
  follow = true,
  onOpenNavigation,
  fullscreen = false,
  showStatusOverlay = true,
  onClose,
}: LiveTrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const meMarkerRef = useRef<any>(null);
  const pickupMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const driverAnimationFrameRef = useRef<number | null>(null);
  const renderedDriverPositionRef = useRef<Coords | null>(null);
  const renderedDriverHeadingRef = useRef(0);
  const routeLineRef = useRef<any>(null);
  const travelledLineRef = useRef<any>(null);
  const readyRef = useRef(false);
  const didInitialFitRef = useRef(false);
  const arrivedNotifiedRef = useRef(false);
  const lastDirectionsRequestRef = useRef<{ origin: Coords; destination: Coords; requestedAt: number; signature: string } | null>(null);
  const directionsSequenceRef = useRef(0);

  const [isFullscreen, setIsFullscreen] = useState(fullscreen);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [atPickup, setAtPickup] = useState(false);
  const [routeMode, setRouteMode] = useState<"road" | "direct" | "waiting">("waiting");
  const [routeProvider, setRouteProvider] = useState<"google" | "osrm" | "none">("none");
  useEffect(() => {
    setIsFullscreen(fullscreen);
  }, [fullscreen]);

  const effectivePickup: Coords | null = pickupCoords ?? (myRole === "customer" ? me : other);
  const activeDriverCoord: Coords | null = myRole === "provider" ? me : other;

  useEffect(() => {
    if (!isFullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
        onClose?.();
      }
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [isFullscreen, onClose]);

  // Initialize Map
  useEffect(() => {
    let cancelled = false;
    setMapReady(false);
    setMapError(false);
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !containerRef.current || !g) return;
        const initialCenter = effectivePickup ??
          activeDriverCoord ?? { lat: 33.3152, lng: 44.3661 };
        const map = new g.maps.Map(containerRef.current, {
          center: initialCenter,
          zoom: 15,
          disableDefaultUI: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        mapRef.current = map;
        lastDirectionsRequestRef.current = null;
        directionsSequenceRef.current += 1;
        setRouteMode("waiting");
        readyRef.current = true;
        setMapReady(true);
        syncMapElements(false);
      })
      .catch(() => {
        if (!cancelled) setMapError(true);
      });

    const markerRefForCleanup = meMarkerRef;
    return () => {
      cancelled = true;
      readyRef.current = false;
      didInitialFitRef.current = false;
      directionsSequenceRef.current += 1;
      if (pickupMarkerRef.current) pickupMarkerRef.current.setMap(null);
      if (destMarkerRef.current) destMarkerRef.current.setMap(null);
      if (markerRefForCleanup.current) markerRefForCleanup.current.setMap(null);
      if (driverMarkerRef.current) driverMarkerRef.current.setMap(null);
      if (routeLineRef.current) routeLineRef.current.setMap(null);
      if (travelledLineRef.current) travelledLineRef.current.setMap(null);
      pickupMarkerRef.current = null;
      destMarkerRef.current = null;
      meMarkerRef.current = null;
      driverMarkerRef.current = null;
      routeLineRef.current = null;
      travelledLineRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullscreen]);

  // Update Markers and Polyline
  function syncMapElements(animate: boolean) {
    const g = (window as any).google;
    const map = mapRef.current;
    if (!g || !map || !readyRef.current) return;

    // Draw the provider's real GPS breadcrumb from Supabase. This is the road
    // actually travelled, not a straight line between two live markers.
    const travelledPath = routePoints.slice(-1200).map((point) => ({ lat: point.lat, lng: point.lng }));
    if (travelledPath.length > 1) {
      if (!travelledLineRef.current) {
        travelledLineRef.current = new g.maps.Polyline({
          path: travelledPath,
          map,
          geodesic: true,
          strokeColor: "#D6A43B",
          strokeOpacity: 0.92,
          strokeWeight: 5,
        });
      } else {
        travelledLineRef.current.setPath(travelledPath);
      }
    }

    // Taxi screens use a clean map; service requests retain their pickup and destination pins.
    if (serviceType !== "taxi") {
      if (effectivePickup) {
        if (pickupMarkerRef.current) pickupMarkerRef.current.setPosition(effectivePickup);
        else pickupMarkerRef.current = new g.maps.Marker({ position: effectivePickup, map, title: "نقطة الانطلاق", zIndex: 10 });
      }
      if (destCoords) {
        const destinationSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="64" viewBox="0 0 52 64"><defs><linearGradient id="destinationFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F04444"/><stop offset=".55" stop-color="#C62828"/><stop offset="1" stop-color="#671818"/></linearGradient><filter id="destinationShadow" x="-50%" y="-40%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#881337" flood-opacity=".35"/></filter></defs><path d="M26 2C12.7 2 2 12.7 2 26c0 17 24 36 24 36s24-19 24-36C50 12.7 39.3 2 26 2Z" fill="url(#destinationFill)" stroke="#fff" stroke-width="3" filter="url(#destinationShadow)"/><circle cx="26" cy="25" r="13" fill="#fff"/><circle cx="26" cy="25" r="8" fill="#be123c"/><circle cx="26" cy="25" r="3" fill="#fff"/></svg>';
        const destinationIcon = { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(destinationSvg), scaledSize: new g.maps.Size(44, 54), anchor: new g.maps.Point(22, 53) };
        if (destMarkerRef.current) {
          destMarkerRef.current.setPosition(destCoords);
          destMarkerRef.current.setIcon(destinationIcon);
        } else {
          destMarkerRef.current = new g.maps.Marker({ position: destCoords, map, icon: destinationIcon, title: "وجهة الوصول", zIndex: 15, optimized: false });
        }
      }
    } else {
      if (pickupMarkerRef.current) pickupMarkerRef.current.setMap(null);
      if (destMarkerRef.current) destMarkerRef.current.setMap(null);
      pickupMarkerRef.current = null;
      destMarkerRef.current = null;
    }

    // 1. Driver marker: a luxury sedan for taxi rides and the original arrow for services.
    if (activeDriverCoord) {
      const previousPosition = renderedDriverPositionRef.current;
      const movementHeading = previousPosition && haversineKm(previousPosition, activeDriverCoord) > 0.003
        ? bearingDeg(previousPosition, activeDriverCoord) : null;
      const heading = activeDriverCoord.heading != null && Number.isFinite(activeDriverCoord.heading)
        ? activeDriverCoord.heading
        : movementHeading ?? (effectivePickup ? bearingDeg(activeDriverCoord, effectivePickup) : renderedDriverHeadingRef.current);
      const carSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><image href="https://raw.githubusercontent.com/ali8102000/mamnoonChatGPT/main/src/assets/car-luxury.png" x="6" y="14" width="52" height="36" preserveAspectRatio="xMidYMid meet" transform="rotate(' + heading + ' 32 32)"/></svg>';
      const carIcon = serviceType === "taxi"
        ? { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(carSvg), scaledSize: new g.maps.Size(58, 58), anchor: new g.maps.Point(29, 29) }
        : { path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, fillColor: "#16a34a", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2.5, rotation: heading };
      if (!driverMarkerRef.current) {
        driverMarkerRef.current = new g.maps.Marker({ position: activeDriverCoord, map, icon: carIcon, title: serviceType === "taxi" ? "سيارة السائق" : driverName, zIndex: 20, optimized: false });
        renderedDriverPositionRef.current = { ...activeDriverCoord };
        renderedDriverHeadingRef.current = heading;
      } else {
        driverMarkerRef.current.setIcon(carIcon);
        if (driverAnimationFrameRef.current !== null) window.cancelAnimationFrame(driverAnimationFrameRef.current);
        const from = renderedDriverPositionRef.current ?? activeDriverCoord;
        const to = { lat: activeDriverCoord.lat, lng: activeDriverCoord.lng };
        const distance = haversineKm(from, to);
        const duration = animate ? Math.min(1800, Math.max(650, distance * 18000)) : 0;
        const start = performance.now();
        if (!duration || distance < 0.001) {
          driverMarkerRef.current.setPosition(to);
          renderedDriverPositionRef.current = { ...activeDriverCoord };
        } else {
          const frame = (now: number) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = progress * progress * (3 - 2 * progress);
            const position = { lat: from.lat + (to.lat - from.lat) * eased, lng: from.lng + (to.lng - from.lng) * eased };
            driverMarkerRef.current?.setPosition(position);
            renderedDriverPositionRef.current = position;
            if (progress < 1) driverAnimationFrameRef.current = window.requestAnimationFrame(frame);
            else { driverAnimationFrameRef.current = null; renderedDriverPositionRef.current = { ...activeDriverCoord }; }
          };
          driverAnimationFrameRef.current = window.requestAnimationFrame(frame);
        }
        renderedDriverHeadingRef.current = heading;
      }
    }

    // 4. Prefer a real road route from Google Directions. The direct line is only
    // a fallback when road routing is unavailable.
    const targetPoint = status === "in_progress" && destCoords ? destCoords : effectivePickup;
    if (activeDriverCoord && targetPoint) {
      const directDistance = haversineKm(activeDriverCoord, targetPoint);
      setAtPickup(status !== "in_progress" && directDistance <= 0.05);
      const hasRoadRouting = typeof g.maps.DirectionsService === "function";
      if (!hasRoadRouting || routeMode !== "road") {
        setDistanceKm(directDistance);
        setEtaMinutes(Math.max(1, Math.round((directDistance / 28) * 60)));
      }

      if (!routeLineRef.current) {
        routeLineRef.current = new g.maps.Polyline({
          path: [activeDriverCoord, targetPoint],
          map,
          geodesic: true,
          strokeColor: "#D6A43B",
          strokeOpacity: 0.98,
          strokeWeight: 6,
        });
      }

      const requestOsrmRoute = async (sequence: number) => {
        try {
          const configuredBase = typeof import.meta !== "undefined" && import.meta.env
            ? (import.meta.env["VITE_OSRM_ROUTING_URL"] as string | undefined)
            : undefined;
          const rawBase = configuredBase || "https://router.project-osrm.org";
          const base = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;
          const url = base + "/route/v1/driving/" + activeDriverCoord.lng + "," + activeDriverCoord.lat + ";" + targetPoint.lng + "," + targetPoint.lat + "?overview=full&geometries=geojson&steps=false";
          const response = await fetch(url, { headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error("OSRM HTTP " + response.status);
          const data = await response.json();
          if (sequence !== directionsSequenceRef.current || !readyRef.current) return;
          const route = data?.code === "Ok" ? data.routes?.[0] : null;
          const coordinates = route?.geometry?.coordinates;
          if (!Array.isArray(coordinates) || coordinates.length < 2) throw new Error("No road route returned");
          routeLineRef.current?.setPath(coordinates.map((point: [number, number]) => ({ lat: point[1], lng: point[0] })));
          setRouteMode("road");
          setRouteProvider("osrm");
          if (typeof route.distance === "number") setDistanceKm(route.distance / 1000);
          if (typeof route.duration === "number") setEtaMinutes(Math.max(1, Math.round(route.duration / 60)));
        } catch (error) {
          if (sequence !== directionsSequenceRef.current || !readyRef.current) return;
          setRouteMode("direct");
          setRouteProvider("none");
          setDistanceKm(directDistance);
          setEtaMinutes(Math.max(1, Math.round((directDistance / 28) * 60)));
          console.warn("[live-map] OSRM road routing unavailable; direct fallback:", error);
        }
      };
      const signature = `${status}:${targetPoint.lat.toFixed(5)}:${targetPoint.lng.toFixed(5)}`;
      const previous = lastDirectionsRequestRef.current;
      const moved = !previous ||
        haversineKm(previous.origin, activeDriverCoord) >= 0.025 ||
        haversineKm(previous.destination, targetPoint) >= 0.02 ||
        previous.signature !== signature ||
        Date.now() - previous.requestedAt >= 10000;

      if (hasRoadRouting && moved) {
        setRouteMode("waiting");
        setRouteProvider("none");
        const sequence = ++directionsSequenceRef.current;
        lastDirectionsRequestRef.current = {
          origin: { lat: activeDriverCoord.lat, lng: activeDriverCoord.lng },
          destination: { lat: targetPoint.lat, lng: targetPoint.lng },
          requestedAt: Date.now(),
          signature,
        };
        const service = new g.maps.DirectionsService();
        service.route({
          origin: activeDriverCoord,
          destination: targetPoint,
          travelMode: g.maps.TravelMode.DRIVING,
          provideRouteAlternatives: false,
          drivingOptions: { departureTime: new Date(), trafficModel: g.maps.TrafficModel?.BEST_GUESS },
        }, (result: any, routeStatus: string) => {
          if (sequence !== directionsSequenceRef.current || !readyRef.current) return;
          const route = result?.routes?.[0];
          const leg = route?.legs?.[0];
          if (routeStatus === "OK" && route?.overview_path?.length && leg) {
            routeLineRef.current?.setPath(route.overview_path);
            setRouteMode("road");
            setRouteProvider("google");
            if (typeof leg.distance?.value === "number") setDistanceKm(leg.distance.value / 1000);
            const durationSeconds = leg.duration_in_traffic?.value ?? leg.duration?.value;
            if (typeof durationSeconds === "number") setEtaMinutes(Math.max(1, Math.round(durationSeconds / 60)));
          } else {
            void requestOsrmRoute(sequence);
            console.warn("[live-map] Google road directions unavailable; trying OSRM:", routeStatus);
          }
        });
      } else if (!hasRoadRouting && moved) {
        void requestOsrmRoute(++directionsSequenceRef.current);
      }

      if (directDistance < 0.07 && !arrivedNotifiedRef.current) {
        arrivedNotifiedRef.current = true;
        if (myRole === "customer") toast.success(serviceType === "taxi" ? "وصل السائق إلى موقعك الآن! 🚗" : "وصل الفني إلى موقعك الآن!");
      }
    }

    // Camera fitting
    if (!didInitialFitRef.current && activeDriverCoord && effectivePickup) {
      const bounds = new g.maps.LatLngBounds();
      bounds.extend(activeDriverCoord);
      bounds.extend(effectivePickup);
      if (destCoords) bounds.extend(destCoords);
      map.fitBounds(bounds, 70);
      didInitialFitRef.current = true;
    } else if (follow && activeDriverCoord) {
      if (effectivePickup) {
        map.panTo({
          lat: (activeDriverCoord.lat + effectivePickup.lat) / 2,
          lng: (activeDriverCoord.lng + effectivePickup.lng) / 2,
        });
      } else {
        map.panTo(activeDriverCoord);
      }
    }
  }

  useEffect(() => {
    if (readyRef.current) syncMapElements(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeDriverCoord?.lat,
    activeDriverCoord?.lng,
    activeDriverCoord?.heading,
    routePoints.length,
    routePoints[routePoints.length - 1]?.lat,
    routePoints[routePoints.length - 1]?.lng,
    effectivePickup?.lat,
    effectivePickup?.lng,
    destCoords?.lat,
    destCoords?.lng,
    status,
    routeMode,
  ]);

  function centerOnDriver() {
    if (mapRef.current && activeDriverCoord) {
      mapRef.current.panTo(activeDriverCoord);
      mapRef.current.setZoom(17);
    }
  }

  const content = (
    <div
      className={`overflow-hidden transition-all duration-300 ${
        isFullscreen
          ? "fixed inset-0 z-[80] rounded-none bg-background"
          : "relative rounded-3xl border border-border shadow-md"
      }`}
      style={{ height: isFullscreen ? "100dvh" : height }}
    >
      {/* Map canvas */}
      <div ref={containerRef} className="absolute inset-0 z-0 bg-muted" />

      {/* Top Floating Status & ETA Card */}
      <div className="absolute top-3 inset-x-3 z-10 flex flex-wrap gap-2 items-center justify-between pointer-events-none">
        {showStatusOverlay && <div className="bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-2xl shadow-lg border border-border/40 pointer-events-auto flex items-center gap-2.5">
          <div className={`h-3 w-3 rounded-full shrink-0 ${activeDriverCoord?.updatedAt && Date.now() - new Date(activeDriverCoord.updatedAt).getTime() < 20000 ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
          <div className="text-right">
            <div className="text-xs font-black flex items-center gap-1.5 text-foreground">
              <span>
                {!activeDriverCoord
                  ? "بانتظار مشاركة الموقع"
                  : status === "in_progress"
                    ? "في الطريق إلى الوجهة"
                    : myRole === "provider"
                      ? "موقع العميل"
                      : "الكابتن متجه إليك"}
              </span>
              {serviceType === "taxi" && myRole === "customer" && status !== "in_progress" ? (
                <span className="text-primary font-black">
                  · {atPickup ? "انا في نقطة الانطلاق" : etaMinutes != null && etaMinutes <= 2 ? "دقيقتين واوصل" : etaMinutes != null ? `باقي ${etaMinutes} دقيقة واوصل` : "السائق متجه إليك"}
                </span>
              ) : etaMinutes != null ? (
                <span className="text-primary font-black">· ~{etaMinutes} دقيقة</span>
              ) : null}
            </div>
            {distanceKm != null && (
              <div className="text-[11px] text-muted-foreground font-semibold">
                المسافة المتبقية:{" "}
                {distanceKm < 1
                  ? `${Math.round(distanceKm * 1000)} متر`
                  : `${distanceKm.toFixed(1)} كم`}
                <span className="mr-2 text-[10px]">{routeMode === "road" ? "· مسار الشوارع" : routeMode === "waiting" ? "· جارٍ حساب الطريق" : "· تقدير مباشر"}</span>
              </div>
            )}
          </div>
        </div>}

        {/* Map View Controls */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <Button
            type="button"
            onClick={centerOnDriver}
            className="h-10 w-10 rounded-2xl bg-white shadow-lg grid place-items-center btn-press border border-border/40 text-emerald-600"
            title={serviceType === "taxi" ? "موقع السائق" : "موقع الفني"}
            aria-label={serviceType === "taxi" ? "موقع السائق" : "موقع الفني"}
          >
            <Navigation className="h-4 w-4" />
          </Button>
          {myRole === "provider" && onOpenNavigation && (
            <Button
              type="button"
              onClick={onOpenNavigation}
              className="h-10 px-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg flex items-center justify-center gap-1 btn-press border border-emerald-500 text-[10px] font-black"
              title="ملاحة"
              aria-label="ملاحة"
            >
              <span>ملاحة</span>
            </Button>
          )}
          <Button
            type="button"
            onClick={() => {
              if (isFullscreen && onClose) onClose();
              else setIsFullscreen((f) => !f);
              setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
            }}
            className="h-10 w-10 rounded-2xl bg-white shadow-lg grid place-items-center btn-press border border-border/40 text-foreground"
            title={isFullscreen ? "تصغير" : "شاشة كاملة"}
            aria-label={isFullscreen ? "تصغير" : "شاشة كاملة"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="absolute bottom-3 inset-x-3 z-10 flex items-center justify-between pointer-events-none">
        {serviceType !== "taxi" && <div className="bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-2xl shadow-lg border border-border/40 pointer-events-auto flex items-center gap-3 text-[11px] font-bold">
          <span className="flex items-center gap-1.5 text-sky-700"><span className="h-2.5 w-2.5 rounded-full bg-sky-500 ring-2 ring-sky-200" />نقطة الانطلاق</span>
          <span className="flex items-center gap-1.5 text-emerald-700"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200 animate-pulse" />الفني {driverName}</span>
          {destCoords && <span className="flex items-center gap-1.5 text-rose-700"><span className="h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-rose-200" />الوجهة</span>}
        </div>}
        {routeProvider === "osrm" && <span className="text-[9px] text-muted-foreground bg-white/90 px-2 py-1 rounded-lg pointer-events-auto">© OpenStreetMap · OSRM</span>}
        {isFullscreen && (
          <Button type="button" onClick={() => { setIsFullscreen(false); onClose?.(); setTimeout(() => window.dispatchEvent(new Event("resize")), 100); }} className="pointer-events-auto px-4 py-2 rounded-2xl bg-primary text-primary-foreground text-xs font-bold shadow-lg btn-press">
            العودة للتفاصيل
          </Button>
        )}
      </div>

      {!mapReady && (
        <div className="absolute inset-0 grid place-items-center bg-white/70 z-20">
          {mapError ? (
            <div className="text-center text-sm text-foreground space-y-3">
              <p>تعذّر تحميل الخريطة؛ تحقق من الاتصال وأعد المحاولة.</p>
              <Button
                onClick={() => {
                  if (onClose) onClose();
                  else window.location.reload();
                }}
              >
                العودة
              </Button>
            </div>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          )}
        </div>
      )}
    </div>
  );
  return isFullscreen ? createPortal(content, document.body) : content;
}

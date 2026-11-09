// Lightweight Google Maps JS API loader (singleton).
// Falls back to Leaflet/OpenStreetMap if no API key is available.

type GoogleMapsApi = typeof google;
type BrowserWindow = Window & {
  google?: GoogleMapsApi;
  L?: LeafletNamespace;
  gm_authFailure?: () => void;
};
type LeafletPoint = { lat: number; lng: number };
type LeafletCallback = (...args: unknown[]) => void;
type LeafletBounds = {
  extend(position: [number, number]): void;
  getSouthWest(): LeafletPoint;
  getNorthEast(): LeafletPoint;
};
type LeafletMap = {
  getCenter(): LeafletPoint;
  panTo(position: [number, number]): void;
  setZoom(zoom: number): void;
  fitBounds(bounds: LeafletBounds, options?: { padding?: [number, number] }): void;
  on(event: string, callback: LeafletCallback): void;
};
type LeafletLayer = { addTo(map: LeafletMap): unknown };
type LeafletMarker = {
  addTo(map: LeafletMap): LeafletMarker;
  on(event: string, callback: LeafletCallback): void;
  setLatLng(position: [number, number]): void;
  getLatLng(): LeafletPoint;
  remove(): void;
};
type LeafletPolyline = {
  addTo(map: LeafletMap): LeafletPolyline;
  setLatLngs(points: Array<[number, number]>): void;
  remove(): void;
};
type LeafletNamespace = {
  map(element: HTMLElement, options: Record<string, unknown>): LeafletMap;
  tileLayer(url: string, options: { maxZoom: number }): LeafletLayer;
  marker(position: [number, number], options: { icon: unknown }): LeafletMarker;
  divIcon(options: { className: string; html: string; iconSize: [number, number] }): unknown;
  polyline(
    points: Array<[number, number]>,
    options: { color: string; weight: number; opacity: number },
  ): LeafletPolyline;
  latLngBounds(points: Array<[number, number]>): LeafletBounds;
};
type AdapterMap = { _map: LeafletMap };
type LatLngInput = google.maps.LatLng | google.maps.LatLngLiteral;

function coordinates(position: LatLngInput): [number, number] {
  const LatLngConstructor = (window as BrowserWindow).google?.maps.LatLng;
  if (LatLngConstructor && position instanceof LatLngConstructor) {
    return [position.lat(), position.lng()];
  }
  const literal = position as google.maps.LatLngLiteral;
  return [literal.lat, literal.lng];
}

let loaderPromise: Promise<GoogleMapsApi> | null = null;
let provider: "google" | "leaflet" | null = null;

if (typeof window !== "undefined") {
  const browser = window as BrowserWindow;
  const originalAuthFailure = browser.gm_authFailure;
  browser.gm_authFailure = () => {
    provider = "leaflet";
    try {
      originalAuthFailure?.();
    } catch {}
    document
      .querySelectorAll(".gm-err-container, .gm-err-content, .dismissButton")
      .forEach((element) => {
        element.closest(".gm-err-container")?.remove();
        element.remove();
      });
  };
}

export function getMapProvider(): "google" | "leaflet" | null {
  return provider;
}

export function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  const browser = window as BrowserWindow;
  if (browser.google?.maps) {
    provider = "google";
    return Promise.resolve(browser.google);
  }
  if (loaderPromise) return loaderPromise;

  const key =
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ||
    (import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined);
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as
    string | undefined;

  if (!key) {
    loaderPromise = loadLeafletFallback();
    return loaderPromise;
  }

  loaderPromise = new Promise((resolve, reject) => {
    const callbackName = `__gmInit_${Date.now()}`;
    const callbackHost = window as unknown as Record<string, unknown>;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      delete callbackHost[callbackName];
      void loadLeafletFallback().then(resolve).catch(reject);
    }, 6000);

    callbackHost[callbackName] = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      delete callbackHost[callbackName];
      if (provider === "leaflet") {
        void loadLeafletFallback().then(resolve).catch(reject);
        return;
      }
      provider = "google";
      const api = (window as BrowserWindow).google;
      if (api?.maps) resolve(api);
      else void loadLeafletFallback().then(resolve).catch(reject);
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=${callbackName}&language=ar&region=IQ${channel ? `&channel=${encodeURIComponent(channel)}` : ""}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      loaderPromise = null;
      void loadLeafletFallback().then(resolve).catch(reject);
    };
    document.head.appendChild(script);
  });

  return loaderPromise;
}

async function loadLeafletFallback(): Promise<GoogleMapsApi> {
  if (!document.querySelector('link[href*="leaflet"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
  }

  const browser = window as BrowserWindow;
  if (browser.L) {
    provider = "leaflet";
    return createLeafletAdapter(browser.L);
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => {
      const leaflet = (window as BrowserWindow).L;
      if (!leaflet) {
        reject(new Error("Leaflet script loaded without its API"));
        return;
      }
      provider = "leaflet";
      resolve(createLeafletAdapter(leaflet));
    };
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error("Failed to load map"));
    };
    document.head.appendChild(script);
  });
}

function createLeafletAdapter(L: LeafletNamespace): GoogleMapsApi {
  class MapAdapter {
    readonly _map: LeafletMap;
    readonly _listeners: Record<string, LeafletCallback[]> = {};

    constructor(element: HTMLElement, options: google.maps.MapOptions) {
      const center = options.center
        ? coordinates(options.center)
        : ([33.3152, 44.3661] as [number, number]);
      const map = L.map(element, {
        center,
        zoom: options.zoom || 14,
        zoomControl: options.zoomControl !== false,
        attributionControl: false,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      this._map = map;
    }

    getCenter(): google.maps.LatLngLiteral {
      const center = this._map.getCenter();
      return { lat: center.lat, lng: center.lng };
    }

    panTo(position: LatLngInput): void {
      this._map.panTo(coordinates(position));
    }

    setZoom(zoom: number): void {
      this._map.setZoom(zoom);
    }

    fitBounds(bounds: google.maps.LatLngBounds, padding?: number): void {
      const southWest = bounds.getSouthWest();
      const northEast = bounds.getNorthEast();
      const leafletBounds = L.latLngBounds([
        [southWest.lat(), southWest.lng()],
        [northEast.lat(), northEast.lng()],
      ]);
      this._map.fitBounds(leafletBounds, { padding: padding ? [padding, padding] : undefined });
    }

    addListener(event: string, callback: LeafletCallback): void {
      const leafletEvent = event === "idle" ? "moveend" : event;
      this._map.on(leafletEvent, callback);
      (this._listeners[leafletEvent] ??= []).push(callback);
    }
  }

  class MarkerAdapter {
    readonly _marker: LeafletMarker;

    constructor(options: google.maps.MarkerOptions) {
      const position = options.position;
      if (!position) throw new Error("Marker position is required");
      const [lat, lng] = coordinates(position);
      const map = options.map as unknown as AdapterMap | null;
      this._marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: "custom-marker",
          html: '<div style="width:20px;height:20px;background:#0ea5e9;border:2px solid white;border-radius:50%;"></div>',
          iconSize: [20, 20],
        }),
      }).addTo(map?._map ?? (options.map as unknown as LeafletMap));
    }

    addListener(event: string, callback: LeafletCallback): void {
      this._marker.on(event, callback);
    }

    setPosition(position: LatLngInput): void {
      this._marker.setLatLng(coordinates(position));
    }

    getPosition(): google.maps.LatLng {
      const point = this._marker.getLatLng();
      return {
        lat: () => point.lat,
        lng: () => point.lng,
        toJSON: () => ({ lat: point.lat, lng: point.lng }),
      } as google.maps.LatLng;
    }

    setMap(map: google.maps.Map | null): void {
      if (!map) this._marker.remove();
    }

    setIcon(icon: string | google.maps.Icon | google.maps.Symbol): void {
      void icon;
    }

    getIcon(): string | google.maps.Icon | google.maps.Symbol | null {
      return null;
    }
  }

  class PolylineAdapter {
    readonly _line: LeafletPolyline;

    constructor(options: google.maps.PolylineOptions) {
      const map = options.map as unknown as AdapterMap | null;
      this._line = L.polyline([], {
        color: options.strokeColor || "#0284c7",
        weight: options.strokeWeight || 3,
        opacity: options.strokeOpacity || 0.5,
      }).addTo(map?._map ?? (options.map as unknown as LeafletMap));
    }

    setPath(
      path:
        | google.maps.MVCArray<google.maps.LatLng>
        | google.maps.LatLng[]
        | google.maps.LatLngLiteral[],
    ): void {
      const points = Array.isArray(path) ? path : path.getArray();
      this._line.setLatLngs(points.map((point) => coordinates(point)));
    }

    setMap(map: google.maps.Map | null): void {
      if (!map) this._line.remove();
    }
  }

  class GeocoderAdapter {
    geocode(
      request: google.maps.GeocoderRequest,
      callback: (
        results: google.maps.GeocoderResult[] | null,
        status: google.maps.GeocoderStatus,
      ) => void,
    ): void {
      if (!request.location) {
        callback(null, "INVALID_REQUEST" as google.maps.GeocoderStatus);
        return;
      }
      const [lat, lng] = coordinates(request.location);
      void fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ar`,
      )
        .then((response) => response.json())
        .then((data: unknown) => {
          const record = data as { display_name?: string };
          const results = [
            { formatted_address: record.display_name ?? "" },
          ] as unknown as google.maps.GeocoderResult[];
          callback(results, "OK" as google.maps.GeocoderStatus);
        })
        .catch(() => callback(null, "ERROR" as google.maps.GeocoderStatus));
    }
  }

  class AutocompleteAdapter {
    getPlacePredictions(
      request: google.maps.places.AutocompletionRequest,
      callback: (
        predictions: google.maps.places.AutocompletePrediction[] | null,
        status: google.maps.places.PlacesServiceStatus,
      ) => void,
    ): void {
      void fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(request.input)}&countrycodes=iq&accept-language=ar&limit=6`,
      )
        .then((response) => response.json())
        .then((data: unknown) => {
          const rows = Array.isArray(data)
            ? (data as Array<{
                place_id?: number;
                osm_id?: number;
                display_name?: string;
                name?: string;
              }>)
            : [];
          const predictions = rows.map((row) => ({
            place_id: row.place_id?.toString() ?? row.osm_id?.toString() ?? "",
            description: row.display_name ?? "",
            structured_formatting: {
              main_text: row.name ?? row.display_name?.split(",")[0] ?? "",
              secondary_text: row.display_name?.split(",").slice(1).join(",").trim() ?? "",
            },
          })) as unknown as google.maps.places.AutocompletePrediction[];
          callback(predictions, "OK" as google.maps.places.PlacesServiceStatus);
        })
        .catch(() => callback([], "ERROR" as google.maps.places.PlacesServiceStatus));
    }
  }

  class PlacesServiceAdapter {
    constructor(map: google.maps.Map) {
      void map;
    }

    getDetails(
      request: google.maps.places.PlaceDetailsRequest,
      callback: (
        place: google.maps.places.PlaceResult | null,
        status: google.maps.places.PlacesServiceStatus,
      ) => void,
    ): void {
      void fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(request.placeId)}&accept-language=ar&limit=1`,
      )
        .then((response) => response.json())
        .then((data: unknown) => {
          const rows = Array.isArray(data)
            ? (data as Array<{ lat: string; lon: string; display_name?: string; name?: string }>)
            : [];
          const first = rows[0];
          if (!first) {
            callback(null, "ZERO_RESULTS" as google.maps.places.PlacesServiceStatus);
            return;
          }
          const place = {
            geometry: {
              location: {
                lat: () => Number.parseFloat(first.lat),
                lng: () => Number.parseFloat(first.lon),
              },
            },
            formatted_address: first.display_name ?? "",
            name: first.name ?? first.display_name?.split(",")[0] ?? "",
          } as unknown as google.maps.places.PlaceResult;
          callback(place, "OK" as google.maps.places.PlacesServiceStatus);
        })
        .catch(() => callback(null, "ERROR" as google.maps.places.PlacesServiceStatus));
    }
  }

  class LatLngBoundsAdapter {
    readonly _bounds: LeafletBounds;

    constructor() {
      this._bounds = L.latLngBounds([]);
    }

    extend(position: LatLngInput): void {
      const [lat, lng] = coordinates(position);
      this._bounds.extend([lat, lng]);
    }

    getSouthWest(): google.maps.LatLng {
      const point = this._bounds.getSouthWest();
      return { lat: () => point.lat, lng: () => point.lng } as google.maps.LatLng;
    }

    getNorthEast(): google.maps.LatLng {
      const point = this._bounds.getNorthEast();
      return { lat: () => point.lat, lng: () => point.lng } as google.maps.LatLng;
    }
  }

  const adapter = {
    maps: {
      Map: MapAdapter,
      Marker: MarkerAdapter,
      Polyline: PolylineAdapter,
      Geocoder: GeocoderAdapter,
      places: {
        AutocompleteService: AutocompleteAdapter,
        AutocompleteSessionToken: class {},
        PlacesService: PlacesServiceAdapter,
      },
      SymbolPath: {
        FORWARD_CLOSED_ARROW: 1,
        CIRCLE: 0,
      },
      LatLngBounds: LatLngBoundsAdapter,
      Animation: { DROP: 1 },
    },
  };
  (window as BrowserWindow).google = adapter as unknown as GoogleMapsApi;
  return adapter as unknown as GoogleMapsApi;
}

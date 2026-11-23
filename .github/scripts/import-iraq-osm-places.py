#!/usr/bin/env python3
"""Incrementally import named Iraqi OSM places into Mamnoon's governorate index.

The importer is additive/upsert-only: it never deactivates or deletes existing rows.
Requires pyosmium. Reads the repository's authoritative ADM1 GeoJSON boundaries.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

import osmium

ROOT = Path(__file__).resolve().parents[2]
BOUNDARIES_FILE = ROOT / "src/lib/iraq-governorate-boundaries.json"
PBF_URL = os.environ.get(
    "OSM_PBF_URL", "https://download.geofabrik.de/asia/iraq-latest.osm.pbf"
)
CHUNK_SIZE = 400
MAX_RETRIES = 5

ISO_TO_KEY = {
    "IQ-AN": "anbar", "IQ-BB": "babil", "IQ-BG": "baghdad",
    "IQ-BA": "basra", "IQ-QA": "qadisiyah", "IQ-DQ": "dhiqar",
    "IQ-DI": "diyala", "IQ-DA": "duhok", "IQ-AR": "erbil",
    "IQ-KI": "kirkuk", "IQ-KA": "karbala", "IQ-MA": "maysan",
    "IQ-MU": "muthanna", "IQ-NA": "najaf", "IQ-NI": "nineveh",
    "IQ-SD": "saladin", "IQ-SU": "sulaymaniyah", "IQ-WA": "wasit",
}
GOVERNORATE_AR = {
    "anbar": "الأنبار", "babil": "بابل", "baghdad": "بغداد",
    "basra": "البصرة", "qadisiyah": "القادسية", "dhiqar": "ذي قار",
    "diyala": "ديالى", "duhok": "دهوك", "erbil": "أربيل",
    "kirkuk": "كركوك", "karbala": "كربلاء", "maysan": "ميسان",
    "muthanna": "المثنى", "najaf": "النجف", "nineveh": "نينوى",
    "saladin": "صلاح الدين", "sulaymaniyah": "السليمانية", "wasit": "واسط",
}
NAME_KEYS = ("name:ar", "name", "name:en", "name:ku", "name:ckb", "official_name", "alt_name", "loc_name")
SEARCH_KEYS = (
    "name:ar", "name", "name:en", "name:ku", "name:ckb", "official_name",
    "alt_name", "old_name", "loc_name", "short_name", "brand", "operator",
    "addr:street", "addr:suburb", "addr:neighbourhood", "addr:city",
    "addr:district", "addr:place", "ref", "int_name",
)
FEATURE_KEYS = {
    "place", "amenity", "shop", "tourism", "leisure", "healthcare",
    "emergency", "public_transport", "railway", "highway", "historic",
    "man_made", "natural", "waterway", "landuse", "building",
    "office", "craft", "sport", "aeroway", "military", "boundary",
    "route", "club", "government", "power", "barrier",
}
CATEGORY_AR = {
    "hospital": "مستشفى", "clinic": "عيادة", "doctors": "طبيب",
    "pharmacy": "صيدلية", "school": "مدرسة", "university": "جامعة",
    "college": "كلية", "kindergarten": "روضة", "mosque": "جامع مسجد",
    "place_of_worship": "دار عبادة جامع كنيسة", "restaurant": "مطعم",
    "cafe": "مقهى", "fast_food": "مطعم وجبات سريعة", "marketplace": "سوق",
    "supermarket": "سوبر ماركت", "mall": "مول مركز تجاري",
    "fuel": "محطة وقود", "bank": "مصرف بنك", "atm": "صراف آلي",
    "police": "شرطة", "fire_station": "دفاع مدني إطفاء",
    "bus_station": "كراج محطة حافلات", "taxi": "موقف تاكسي",
    "park": "حديقة متنزه", "playground": "ملعب أطفال",
    "museum": "متحف", "monument": "نصب تذكاري", "memorial": "نصب تذكاري",
    "hotel": "فندق", "guest_house": "دار ضيافة", "hotel": "فندق",
    "cinema": "سينما", "stadium": "ملعب", "sports_centre": "مركز رياضي",
    "government": "دائرة حكومية", "courthouse": "محكمة",
    "townhall": "بلدية", "post_office": "بريد",
}

def download(url: str, target: Path) -> None:
    # curl handles Geofabrik's redirect/CDN more reliably than urllib on long transfers.
    # Retry transient network timeouts and resume partial downloads where supported.
    import subprocess
    command = [
        "curl", "--fail", "--location", "--show-error",
        "--retry", "8", "--retry-all-errors", "--retry-delay", "5",
        "--connect-timeout", "45", "--max-time", "2400",
        "--continue-at", "-", "--user-agent", "Mamnoon-Iraq-Places-Importer/1.0",
        "--output", str(target), url,
    ]
    subprocess.run(command, check=True)
    if not target.exists() or target.stat().st_size < 1024 * 1024:
        raise RuntimeError("Downloaded Iraq OSM extract is missing or unexpectedly small.")

def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i, point in enumerate(ring):
        xi, yi = point[0], point[1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat):
            cross = (xj - xi) * (lat - yi) / ((yj - yi) or 1e-30) + xi
            if lon < cross:
                inside = not inside
        j = i
    return inside

def point_in_polygon(lon: float, lat: float, polygon: list[list[list[float]]]) -> bool:
    if not polygon or not point_in_ring(lon, lat, polygon[0]):
        return False
    return not any(point_in_ring(lon, lat, ring) for ring in polygon[1:])

def build_governorates() -> list[tuple[str, list[tuple[tuple[float, float, float, float], list]]]]:
    data = json.loads(BOUNDARIES_FILE.read_text(encoding="utf-8"))
    result = []
    for feature in data["features"]:
        key = ISO_TO_KEY.get(feature.get("properties", {}).get("shapeISO"))
        if not key:
            continue
        geometry = feature["geometry"]
        kind, coords = geometry["type"], geometry["coordinates"]
        polygons = coords if kind == "MultiPolygon" else [coords]
        indexed = []
        for polygon in polygons:
            outer = polygon[0]
            lons = [point[0] for point in outer]
            lats = [point[1] for point in outer]
            bbox = (min(lons), min(lats), max(lons), max(lats))
            indexed.append((bbox, polygon))
        result.append((key, indexed))
    if len(result) != 18:
        raise RuntimeError(f"Expected 18 governorate boundaries; found {len(result)}")
    return result

GOVERNORATES = build_governorates()

def find_governorate(lon: float, lat: float) -> str | None:
    # Bounding-box rejection avoids scanning detailed polygon rings for distant governorates.
    for key, polygons in GOVERNORATES:
        for (min_lon, min_lat, max_lon, max_lat), polygon in polygons:
            if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
                if point_in_polygon(lon, lat, polygon):
                    return key
    return None

def choose_name(tags) -> str:
    for key in NAME_KEYS:
        value = tags.get(key)
        if value and value.strip():
            return value.strip()[:240]
    return ""

def category_terms(tags) -> str:
    values = []
    for key in FEATURE_KEYS:
        value = tags.get(key)
        if value:
            values.extend([key, value, CATEGORY_AR.get(value, "")])
    return " ".join(v.strip() for v in values if v and v.strip())

def make_row(element_type: str, element_id: int, tags, lon: float, lat: float):
    name = choose_name(tags)
    if not name or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    if not any(key in tags for key in FEATURE_KEYS):
        return None
    governorate = find_governorate(lon, lat)
    if not governorate:
        return None
    names = [tags.get(key, "") for key in SEARCH_KEYS]
    address_parts = [
        tags.get("addr:street", ""), tags.get("addr:suburb", ""),
        tags.get("addr:neighbourhood", ""), tags.get("addr:district", ""),
        tags.get("addr:city", ""), tags.get("addr:place", ""),
        GOVERNORATE_AR[governorate], "العراق",
    ]
    address = "، ".join(dict.fromkeys(x.strip() for x in address_parts if x and x.strip()))
    terms = " ".join(dict.fromkeys(
        [x.strip() for x in names if x and x.strip()]
        + [category_terms(tags), governorate, GOVERNORATE_AR[governorate], "Iraq"]
    ))
    return {
        "governorate_key": governorate,
        "source": "openstreetmap",
        "source_key": f"osm:{element_type}:{element_id}",
        "name_ar": name,
        "address": address or name,
        "search_terms": terms[:4000],
        "latitude": round(lat, 7),
        "longitude": round(lon, 7),
        "is_active": True,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

class NamedPlaces(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.rows: dict[tuple[str, str], dict] = {}
        self.counts = Counter()

    def add(self, element_type: str, element_id: int, tags, lon: float, lat: float):
        row = make_row(element_type, element_id, tags, lon, lat)
        if row:
            self.rows[(row["governorate_key"], row["source_key"])] = row
            self.counts[row["governorate_key"]] += 1

    def node(self, node):
        if node.location.valid():
            self.add("node", node.id, node.tags, node.location.lon, node.location.lat)

    def way(self, way):
        coords = [(n.lon, n.lat) for n in way.nodes if n.location.valid()]
        if not coords:
            return
        # A length/area-weighted centroid is not required for search discovery;
        # the mean of vertices is a stable approximate map pin, then boundary checked.
        lon = sum(p[0] for p in coords) / len(coords)
        lat = sum(p[1] for p in coords) / len(coords)
        self.add("way", way.id, way.tags, lon, lat)

def rest_upsert(rows: list[dict], base_url: str, service_key: str) -> None:
    endpoint = base_url.rstrip("/") + "/rest/v1/map_place_suggestions?on_conflict=governorate_key%2Csource_key"
    body = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        endpoint, data=body, method="POST",
        headers={
            "apikey": service_key,
            "Authorization": "Bearer " + service_key,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                if response.status not in (200, 201, 204):
                    raise RuntimeError(f"Supabase REST returned HTTP {response.status}")
                return
        except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
            if attempt == MAX_RETRIES - 1:
                raise
            wait = 2 ** attempt
            print(f"Upsert retry {attempt + 1}/{MAX_RETRIES} in {wait}s: {exc}", flush=True)
            time.sleep(wait)

def main() -> int:
    dry_run = os.environ.get("DRY_RUN", "").strip().lower() in ("1", "true", "yes")
    base_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not dry_run and (not base_url or not service_key):
        raise RuntimeError("Set the SUPABASE_SERVICE_ROLE_KEY GitHub secret before importing.")
    work = Path(os.environ.get("RUNNER_TEMP", "/tmp"))
    pbf = work / "iraq-latest.osm.pbf"
    print(f"Downloading current Iraq extract: {PBF_URL}", flush=True)
    download(PBF_URL, pbf)
    print(f"Parsing {pbf.stat().st_size:,} bytes with 18 governorate polygons", flush=True)
    handler = NamedPlaces()
    handler.apply_file(str(pbf), locations=True, idx="flex_mem")
    rows = list(handler.rows.values())
    print(f"Prepared {len(rows):,} named places", flush=True)
    for key in sorted(handler.counts):
        print(f"  {key}: {handler.counts[key]:,}", flush=True)
    if len(rows) < 5000:
        raise RuntimeError(f"Safety stop: only {len(rows)} rows parsed; refusing a suspiciously small import.")
    if dry_run:
        print("DRY_RUN enabled: no database writes were made.", flush=True)
        return 0
    uploaded = 0
    for offset in range(0, len(rows), CHUNK_SIZE):
        rest_upsert(rows[offset:offset + CHUNK_SIZE], base_url, service_key)
        uploaded += len(rows[offset:offset + CHUNK_SIZE])
        if uploaded % 4000 == 0 or uploaded == len(rows):
            print(f"Upserted {uploaded:,}/{len(rows):,}", flush=True)
    print("Import complete. Existing records were preserved; no rows were deleted or deactivated.", flush=True)
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise

#!/usr/bin/env python3
"""Incrementally import named Iraqi OSM places into Mamnoon's governorate index.

The importer is additive/upsert-only: it never deactivates or deletes existing rows.
Requires pyosmium. Reads the repository's authoritative ADM1 GeoJSON boundaries.
"""
from __future__ import annotations

import json
import os
import re
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
PBF_INDEX_URL = "https://download.geofabrik.de/asia/iraq/index.html"
PBF_LATEST_URL = "https://download.geofabrik.de/asia/iraq/iraq-latest.osm.pbf"

def candidate_pbf_urls() -> list[str]:
    override = os.environ.get("OSM_PBF_URL", "").strip()
    if override:
        return [override]
    urls = [PBF_LATEST_URL]
    try:
        request = urllib.request.Request(
            PBF_INDEX_URL,
            headers={"User-Agent": "Mamnoon-Iraq-Places-Importer/1.0"},
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            html = response.read().decode("utf-8", errors="replace")
        dated_files = sorted(set(re.findall(r"iraq-\d{6}\.osm\.pbf", html)), reverse=True)
        urls.extend(
            f"https://download.geofabrik.de/asia/iraq/{filename}"
            for filename in dated_files[:8]
        )
    except Exception as exc:
        print(f"Could not read Geofabrik index; trying latest alias only: {exc}", flush=True)
    return list(dict.fromkeys(urls))
CHUNK_SIZE = 100
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
    "addr:street", "addr:housenumber", "addr:unit", "addr:postcode", "addr:suburb", "addr:neighbourhood", "addr:city",
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

def download(urls: list[str], target: Path) -> None:
    # Geofabrik's latest alias can briefly point to a dated extract before it is
    # published on every mirror. Try the alias, then the newest dated files.
    import subprocess
    errors = []
    for url in urls:
        print(f"Trying Iraq OSM extract: {url}", flush=True)
        target.unlink(missing_ok=True)
        command = [
            "curl", "--fail", "--location", "--show-error",
            "--retry", "3", "--retry-delay", "2",
            "--connect-timeout", "15", "--max-time", "900",
            "--user-agent", "Mozilla/5.0 (compatible; Mamnoon-Iraq-Places-Importer/1.0)",
            "--output", str(target), url,
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode == 0 and target.exists() and target.stat().st_size >= 1024 * 1024:
            print(f"Downloaded {target.stat().st_size:,} bytes from {url}", flush=True)
            return
        error = (result.stderr or result.stdout or f"curl exit {result.returncode}").strip()
        errors.append(f"{url}: {error}")
        print(f"Extract unavailable; trying next mirror/date: {error}", flush=True)
    raise RuntimeError("Could not download an Iraq OSM extract. " + " | ".join(errors[-5:]))

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

def normalize_search_term(value: str) -> str:
    value = re.sub(r"[\u064B-\u065F\u0670]", "", value)
    value = value.replace("ـ", "")
    value = value.translate(str.maketrans({
        "إ": "ا", "أ": "ا", "آ": "ا", "ٱ": "ا",
        "ؤ": "و", "ئ": "ي", "ى": "ي", "ة": "ه",
    }))
    return re.sub(r"\s+", " ", value).strip().lower()


def category_terms(tags) -> str:
    values = []
    for key in FEATURE_KEYS:
        value = tags.get(key)
        if value:
            values.extend([key, value, CATEGORY_AR.get(value, "")])
    return " ".join(v.strip() for v in values if v and v.strip())

def make_row(element_type: str, element_id: int, tags, lon: float, lat: float):
    name = choose_name(tags)
    # Addressable buildings are useful destination suggestions even when OSM
    # has no POI name. Keep them clearly labelled as a street/house number.
    house_number = tags.get("addr:housenumber", "").strip()
    street = (tags.get("addr:street") or tags.get("addr:place") or "").strip()
    if not name and tags.get("building") and house_number and street:
        name = f"{street}، رقم {house_number}"
    if not name or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    if not any(key in tags for key in FEATURE_KEYS):
        return None
    governorate = find_governorate(lon, lat)
    if not governorate:
        return None
    names = [tags.get(key, "") for key in SEARCH_KEYS]
    address_parts = [
        tags.get("addr:street", ""), f"رقم {house_number}" if house_number else "",
        tags.get("addr:unit", ""), tags.get("addr:suburb", ""),
        tags.get("addr:neighbourhood", ""), tags.get("addr:district", ""),
        tags.get("addr:city", ""), tags.get("addr:place", ""),
        GOVERNORATE_AR[governorate], "العراق",
    ]
    address = "، ".join(dict.fromkeys(x.strip() for x in address_parts if x and x.strip()))
    raw_terms = [
        x.strip() for x in names if x and x.strip()
    ] + [category_terms(tags), governorate, GOVERNORATE_AR[governorate], "Iraq"]
    normalized_terms = [normalize_search_term(value) for value in raw_terms if value]
    terms = " ".join(dict.fromkeys(
        [value for value in raw_terms + normalized_terms if value]
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
            "Prefer": "resolution=ignore-duplicates,return=minimal",
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
    urls = candidate_pbf_urls()
    print(f"Found {len(urls)} possible Geofabrik extract URLs", flush=True)
    download(urls, pbf)
    print(f"Parsing {pbf.stat().st_size:,} bytes with 18 governorate polygons", flush=True)
    handler = NamedPlaces()
    handler.apply_file(str(pbf), locations=True, idx="flex_mem")
    rows = list(handler.rows.values())
    print(f"Prepared {len(rows):,} place/address suggestions", flush=True)
    for key in sorted(handler.counts):
        print(f"  {key}: {handler.counts[key]:,}", flush=True)
    if len(rows) < 5000:
        raise RuntimeError(f"Safety stop: only {len(rows)} rows parsed; refusing a suspiciously small import.")
    undercovered = {
        key: handler.counts.get(key, 0)
        for key in GOVERNORATE_AR
        if handler.counts.get(key, 0) < 500
    }
    if undercovered:
        raise RuntimeError(f"Safety stop: insufficient coverage in governorates: {undercovered}")
    if dry_run:
        print("DRY_RUN enabled: no database writes were made.", flush=True)
        return 0
    uploaded = 0
    for offset in range(0, len(rows), CHUNK_SIZE):
        rest_upsert(rows[offset:offset + CHUNK_SIZE], base_url, service_key)
        uploaded += len(rows[offset:offset + CHUNK_SIZE])
        if uploaded % 2000 == 0 or uploaded == len(rows):
            print(f"Processed {uploaded:,}/{len(rows):,} (existing OSM keys are skipped)", flush=True)
    print("Import complete. New OSM records were added; existing rows were left untouched and no rows were deleted or deactivated.", flush=True)
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise

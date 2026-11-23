# Iraq Local Map Data — Mamnoon

## Initial production import (2026-11-19)

The first nationwide local-place seed has been written to `public.map_place_suggestions`.

- 18 configured governorates covered by the same search index.
- 15,251 active records with `source = openstreetmap` at the post-import verification query.
- 15,554 total active map suggestions, including the earlier Photon-derived Najaf records.
- Halabja was queried through its own OSM administrative relation and its records were stored under `sulaymaniyah`, per the product's current governorate selection decision. It is not a separate Mamnoon governorate.

## Source and categories

Source: OpenStreetMap / Overpass API, queried on 2026-11-19. The seed included:

- Named places and facilities within each governorate boundary.
- Public amenities, including schools, health services, restaurants, public facilities and transport-related POIs.
- Nationwide named shops, leisure features, tourism places and named roads, assigned to governorates using the repository's governorate polygons.
- Arabic, English and available Kurdish names, alternate names, address tags and OSM category tags were added to searchable terms.

Every imported row is keyed by its OSM element type and ID (`osm:node:<id>`, `osm:way:<id>` or `osm:relation:<id>`) so later imports can update rather than duplicate the same object. Existing rows are upserted; this import did not delete existing place records.

## Important coverage limits

This is a substantial initial seed, not a claim that every Iraqi place is mapped:

- Some Overpass category extracts were capped at 2,000 nationwide records; broad and amenity queries were capped at 350 records per governorate. More records may exist beyond those limits.
- OSM completeness varies by city, district and category. Smaller schools, informal parks, local market names and colloquial street names may still be absent or outdated.
- The point returned for a way/relation is its OSM centre point; for long roads or large areas it is an approximate search pin, not a surveyed entrance.
- The search should continue enriching from Photon/OSM on demand. Future scheduled refreshes should use OSM element IDs and timestamps, preserve ODbL attribution, and avoid deleting records just because one extract omits them.

## Attribution and licence

Display attribution to **© OpenStreetMap contributors** and comply with the Open Database License (ODbL 1.0). OSM source objects can be opened by constructing `https://www.openstreetmap.org/{type}/{id}` from the stored `source_key`.

- https://www.openstreetmap.org/copyright
- https://opendatacommons.org/licenses/odbl/1-0/

## Nearby landmark lookup

The maps proxy now exposes a governorate-scoped `nearby` action. It returns up to three named nearby places within 1.8 km, prioritizing categorized POIs and excluding the selected point itself. Web and Expo clients request these details only after moving the selected map pin, so landmark lookup does not delay the pin jump.


## Nationwide incremental refresh pipeline

A GitHub Actions workflow, `.github/workflows/refresh-iraq-osm-places.yml`, downloads the latest available Geofabrik Iraq PBF extract and imports named OSM nodes and ways plus addressable buildings into the governorate-scoped catalogue. It runs weekly, can be started manually, and runs after changes to the import pipeline. The importer:

- Uses the repository's 18 ADM1 governorate polygons and assigns every imported point to the polygon that contains it.
- Indexes Arabic, English, Kurdish and alternate names, normalized Arabic spelling variants, addresses, house numbers and feature-category terms.
- Uses stable OSM element keys (`osm:node:<id>`, `osm:way:<id>`) and `resolution=ignore-duplicates`; existing rows are skipped while newly mapped OSM objects are added.
- Is strictly additive: it never rewrites, deletes or deactivates existing records. This avoids unnecessary GIN-index rewrites during the large initial import.
- Stops if the extract unexpectedly yields fewer than 5,000 records or any governorate has fewer than 500.
- Does not import relation geometries yet; large multipolygon POIs and some area features require a later dedicated area-processing pass.

Required GitHub Actions secret: `SUPABASE_SERVICE_ROLE_KEY`. The public project URL is configured in the workflow. The workflow installs `osmium` directly and intentionally does not use pip cache because this repository has no Python dependency lockfile. The first successful dry run prepared more than 234,000 place/address suggestions across all 18 governorates.

OpenStreetMap data is available under ODbL 1.0. Keep visible attribution to © OpenStreetMap contributors and comply with ODbL share-alike requirements for derived databases. Source: https://download.geofabrik.de/asia/iraq/index.html

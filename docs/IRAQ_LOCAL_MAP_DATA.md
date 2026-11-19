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

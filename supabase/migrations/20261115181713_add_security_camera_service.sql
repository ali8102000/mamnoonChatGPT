-- Add the security-camera installation service to the shared worker catalog.
-- Applied to the linked production project on 2026-11-15 (Supabase migration version 20261115181713).
-- Keep this filename/version aligned with the remote migration history.
BEGIN;

INSERT INTO public.services (slug, name_ar, name_en, icon, sort_order)
VALUES (
  'security_cameras',
  'تنصيب كامرات مراقبة',
  'Security Camera Installation',
  'cctv',
  22
)
ON CONFLICT (slug) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order;

COMMIT;

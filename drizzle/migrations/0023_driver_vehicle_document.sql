-- Store a driver's vehicle registration (سنوية) or power-of-attorney (وكالة) photo.
ALTER TABLE public.provider_verifications
  ADD COLUMN IF NOT EXISTS vehicle_document_path text;

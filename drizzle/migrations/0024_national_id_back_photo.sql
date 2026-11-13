ALTER TABLE public.provider_verifications
  ADD COLUMN IF NOT EXISTS id_card_back_photo_path text;

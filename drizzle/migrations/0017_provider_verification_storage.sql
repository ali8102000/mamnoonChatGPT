-- Persist provider identity documents in private Supabase Storage.
BEGIN;

CREATE TABLE IF NOT EXISTS public.provider_verifications (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider_type text NOT NULL CHECK (provider_type IN ('driver','worker')),
  legal_name text NOT NULL,
  phone text,
  email text,
  face_photo_path text NOT NULL,
  id_card_photo_path text NOT NULL,
  document_type text NOT NULL DEFAULT 'national_id',
  id_number text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_verifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.provider_verifications TO authenticated;
GRANT ALL ON public.provider_verifications TO service_role;

CREATE POLICY "Providers read own verification"
ON public.provider_verifications FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_staff_role(auth.uid()));

CREATE POLICY "Providers submit own verification"
ON public.provider_verifications FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Providers update own verification"
ON public.provider_verifications FOR UPDATE TO authenticated
USING (auth.uid() = user_id OR public.has_staff_role(auth.uid()))
WITH CHECK (
  (auth.uid() = user_id AND status = 'pending')
  OR public.has_staff_role(auth.uid())
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('provider-verification', 'provider-verification', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

CREATE POLICY "Provider uploads own verification files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'provider-verification'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Provider reads own verification files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'provider-verification'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_staff_role(auth.uid())
  )
);

CREATE POLICY "Provider updates own verification files"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'provider-verification'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'provider-verification'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

COMMIT;

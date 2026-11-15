ALTER TABLE public.ratings
  DROP CONSTRAINT IF EXISTS ratings_reasons_max_count;

ALTER TABLE public.ratings
  ADD CONSTRAINT ratings_reasons_max_count
  CHECK (cardinality(reasons) <= 12);

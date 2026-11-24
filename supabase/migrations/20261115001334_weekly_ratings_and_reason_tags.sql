ALTER TABLE public.ratings
  ADD COLUMN IF NOT EXISTS reasons text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ratings_reasons_max_count'
      AND conrelid = 'public.ratings'::regclass
  ) THEN
    ALTER TABLE public.ratings
      ADD CONSTRAINT ratings_reasons_max_count
      CHECK (cardinality(reasons) <= 10);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_weekly_rating_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Serialize concurrent attempts by the same rater/ratee pair.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.rater_id::text || ':' || NEW.ratee_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.ratings existing
    WHERE existing.rater_id = NEW.rater_id
      AND existing.ratee_id = NEW.ratee_id
      AND existing.created_at >= now() - interval '7 days'
      AND (TG_OP <> 'UPDATE' OR existing.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'rating_already_given_this_week';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_weekly_rating_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_weekly_rating_limit_trigger ON public.ratings;
CREATE TRIGGER enforce_weekly_rating_limit_trigger
  BEFORE INSERT OR UPDATE OF rater_id, ratee_id ON public.ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_weekly_rating_limit();

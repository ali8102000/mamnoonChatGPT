-- Prevent duplicate pg_cron jobs for taxi dispatch.
-- Keep the existing nearest-first stages in advance_taxi_dispatch().
BEGIN;

CREATE OR REPLACE FUNCTION public.on_taxi_dispatch_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.type <> 'taxi' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(91840060);

  IF NEW.status IN ('pending', 'searching') AND NEW.provider_id IS NULL THEN
    -- Re-queue only for a new taxi request or when it becomes eligible again.
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.taxi_dispatch_queue(request_id)
      VALUES (NEW.id)
      ON CONFLICT (request_id) DO NOTHING;
      PERFORM public.advance_taxi_dispatch(NEW.id);
    ELSIF OLD.type IS DISTINCT FROM 'taxi'
       OR OLD.status NOT IN ('pending', 'searching')
       OR OLD.provider_id IS NOT NULL THEN
      INSERT INTO public.taxi_dispatch_queue(request_id)
      VALUES (NEW.id)
      ON CONFLICT (request_id) DO NOTHING;
      PERFORM public.advance_taxi_dispatch(NEW.id);
    END IF;

    -- A single named cron job services all queued taxi requests.
    IF EXISTS (SELECT 1 FROM public.taxi_dispatch_queue)
       AND NOT EXISTS (
         SELECT 1 FROM cron.job
         WHERE jobname = 'mamnoon-taxi-dispatch'
       ) THEN
      PERFORM cron.schedule(
        'mamnoon-taxi-dispatch',
        '5 seconds',
        'SELECT public.process_taxi_dispatch()'
      );
    END IF;
  ELSE
    DELETE FROM public.taxi_dispatch_queue
    WHERE request_id = NEW.id;

    UPDATE public.request_offers
    SET status = 'cancelled',
        responded_at = now()
    WHERE request_id = NEW.id
      AND status = 'pending'
      AND provider_id IS DISTINCT FROM NEW.provider_id;

    IF NOT EXISTS (SELECT 1 FROM public.taxi_dispatch_queue)
       AND EXISTS (
         SELECT 1 FROM cron.job
         WHERE jobname = 'mamnoon-taxi-dispatch'
       ) THEN
      PERFORM cron.unschedule('mamnoon-taxi-dispatch');
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

COMMIT;

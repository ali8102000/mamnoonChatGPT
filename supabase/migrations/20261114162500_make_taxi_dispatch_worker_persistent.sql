-- Make taxi dispatch a persistent background worker.
-- The first offer is dispatched synchronously by the request trigger; pg_cron
-- advances pending queues on a permanent schedule even if every client closes.
CREATE OR REPLACE FUNCTION public.process_taxi_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT request_id
    FROM public.taxi_dispatch_queue
    WHERE next_at <= now()
    ORDER BY next_at, request_id
    LIMIT 100
  LOOP
    BEGIN
      PERFORM public.advance_taxi_dispatch(v_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Taxi dispatch failed for request %: %', v_id, SQLERRM;
      UPDATE public.taxi_dispatch_queue
      SET next_at = now() + interval '30 seconds'
      WHERE request_id = v_id;
    END;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_taxi_dispatch_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.type <> 'taxi' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('pending', 'searching') AND NEW.provider_id IS NULL THEN
    IF TG_OP = 'INSERT'
       OR OLD.type IS DISTINCT FROM 'taxi'
       OR OLD.status NOT IN ('pending', 'searching')
       OR OLD.provider_id IS NOT NULL THEN
      INSERT INTO public.taxi_dispatch_queue(request_id)
      VALUES (NEW.id)
      ON CONFLICT (request_id) DO NOTHING;
      PERFORM public.advance_taxi_dispatch(NEW.id);
    END IF;
  ELSE
    DELETE FROM public.taxi_dispatch_queue WHERE request_id = NEW.id;
    UPDATE public.request_offers
    SET status = 'cancelled', responded_at = now()
    WHERE request_id = NEW.id
      AND status = 'pending'
      AND provider_id IS DISTINCT FROM NEW.provider_id;
  END IF;
  RETURN NEW;
END;
$function$;

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mamnoon-taxi-dispatch') THEN
    PERFORM cron.unschedule('mamnoon-taxi-dispatch');
  END IF;
  PERFORM cron.schedule(
    'mamnoon-taxi-dispatch',
    '* * * * *',
    'SELECT public.process_taxi_dispatch()'
  );
END
$schedule$;

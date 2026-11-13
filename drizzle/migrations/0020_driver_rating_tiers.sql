-- Driver reputation tiers based on verified customer ratings (50 minimum)
CREATE OR REPLACE FUNCTION public.get_provider_reputation(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_avg numeric; v_prof numeric; v_punc numeric; v_qual numeric;
  v_cnt int; v_done int; v_score int;
  v_level text; v_name text; v_icon text; v_color text;
  v_badges jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(AVG(stars),5), COALESCE(AVG(professionalism),5),
         COALESCE(AVG(punctuality),5), COALESCE(AVG(quality),5), COUNT(*)
    INTO v_avg, v_prof, v_punc, v_qual, v_cnt
  FROM public.ratings WHERE ratee_id = p_user_id;

  SELECT COUNT(*) INTO v_done
  FROM public.service_requests WHERE provider_id = p_user_id AND status = 'completed';

  v_score := LEAST(1000, ROUND(v_avg * 100 + LEAST(v_done, 500))::int);

  IF EXISTS (SELECT 1 FROM public.driver_profiles WHERE user_id = p_user_id) THEN
    IF v_cnt < 50 THEN
      v_level := 'unranked'; v_name := 'قيد التقييم'; v_icon := '🌱'; v_color := '#94A3B8';
    ELSIF v_avg >= 4.75 THEN
      v_level := 'luxury'; v_name := 'فاخر'; v_icon := '👑'; v_color := '#A78BFA';
    ELSIF v_avg >= 4.5 THEN
      v_level := 'premium'; v_name := 'متميز'; v_icon := '⭐'; v_color := '#0EA5E9';
    ELSIF v_avg >= 4.0 THEN
      v_level := 'economy'; v_name := 'اقتصادي'; v_icon := '🚕'; v_color := '#10B981';
    ELSE
      v_level := 'unranked'; v_name := 'قيد التقييم'; v_icon := '🌱'; v_color := '#94A3B8';
    END IF;
  ELSE
    IF v_done >= 200 AND v_avg >= 4.7 THEN v_level := 'diamond'; v_name := 'ماسي'; v_icon := '💎'; v_color := '#7DD3FC';
    ELSIF v_done >= 100 AND v_avg >= 4.5 THEN v_level := 'gold'; v_name := 'ذهبي'; v_icon := '🥇'; v_color := '#FFD700';
    ELSIF v_done >= 30 AND v_avg >= 4.0 THEN v_level := 'silver'; v_name := 'فضي'; v_icon := '🥈'; v_color := '#C0C0C0';
    ELSE v_level := 'bronze'; v_name := 'برونزي'; v_icon := '🥉'; v_color := '#CD7F32'; END IF;
  END IF;

  IF v_cnt >= 10 AND v_avg >= 4.8 THEN v_badges := v_badges || jsonb_build_object('code','top_rated','name_ar','الأعلى تقييماً','icon','⭐','color','#F59E0B'); END IF;
  IF v_cnt >= 5 AND v_punc >= 4.8 THEN v_badges := v_badges || jsonb_build_object('code','punctual','name_ar','دقيق بالمواعيد','icon','⏱️','color','#10B981'); END IF;
  IF v_cnt >= 5 AND v_qual >= 4.8 THEN v_badges := v_badges || jsonb_build_object('code','quality','name_ar','جودة عالية','icon','🏆','color','#6366F1'); END IF;
  IF v_done >= 100 THEN v_badges := v_badges || jsonb_build_object('code','veteran','name_ar','خبرة +100','icon','🎖️','color','#EF4444'); END IF;

  RETURN jsonb_build_object(
    'score', v_score, 'level', v_level, 'level_name', v_name, 'level_icon', v_icon, 'level_color', v_color,
    'avg_stars', round(v_avg, 2), 'professionalism_avg', round(v_prof, 2),
    'punctuality_avg', round(v_punc, 2), 'quality_avg', round(v_qual, 2),
    'ratings_count', v_cnt, 'completed_jobs', v_done, 'badges', v_badges
  );
END $$;

CREATE OR REPLACE FUNCTION public.notify_driver_rating_tier()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_avg numeric;
  v_previous_count int;
  v_previous_avg numeric;
  v_name text;
  v_target text;
  v_target_name text;
  v_previous_tier int := 0;
  v_current_tier int := 0;
  v_near_tier int := 0;
  v_near_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.driver_profiles WHERE user_id = NEW.ratee_id) THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*), COALESCE(AVG(stars),0)
    INTO v_count, v_avg
  FROM public.ratings WHERE ratee_id = NEW.ratee_id;

  SELECT COUNT(*), COALESCE(AVG(stars),0)
    INTO v_previous_count, v_previous_avg
  FROM public.ratings WHERE ratee_id = NEW.ratee_id AND id <> NEW.id;

  SELECT COALESCE(full_name, 'سائقنا العزيز') INTO v_name
  FROM public.profiles WHERE id = NEW.ratee_id;

  IF v_previous_count >= 50 THEN
    IF v_previous_avg >= 4.75 THEN v_previous_tier := 3;
    ELSIF v_previous_avg >= 4.5 THEN v_previous_tier := 2;
    ELSIF v_previous_avg >= 4.0 THEN v_previous_tier := 1;
    END IF;
  END IF;

  IF v_count >= 50 THEN
    IF v_avg >= 4.75 THEN v_current_tier := 3;
    ELSIF v_avg >= 4.5 THEN v_current_tier := 2;
    ELSIF v_avg >= 4.0 THEN v_current_tier := 1;
    END IF;
  END IF;

  IF v_current_tier > v_previous_tier THEN
    v_target := CASE v_current_tier WHEN 1 THEN 'economy' WHEN 2 THEN 'premium' ELSE 'luxury' END;
    v_target_name := CASE v_current_tier WHEN 1 THEN 'اقتصادي' WHEN 2 THEN 'متميز' ELSE 'فاخر' END;
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = NEW.ratee_id AND data->>'rank_event' = 'promoted_' || v_target
    ) THEN
      INSERT INTO public.notifications (user_id, type, title, body, link, data)
      VALUES (
        NEW.ratee_id, 'driver_rank_up', 'مبروك الترقية يا ' || v_name,
        'تستاهل! وصلت إلى رتبة ' || v_target_name || ' بفضل تقييمات الزبائن وثقتهم بيك.',
        '/profile', jsonb_build_object('rank_event','promoted_' || v_target,'rank',v_target,'ratings_count',v_count,'average_stars',round(v_avg,2))
      );
    END IF;
    RETURN NEW;
  END IF;

  IF v_count >= 50 THEN
    IF v_current_tier = 1 AND v_avg >= 4.25 THEN v_near_tier := 2; v_near_name := 'متميز';
    ELSIF v_current_tier = 2 AND v_avg >= 4.5 AND v_avg < 4.75 THEN v_near_tier := 3; v_near_name := 'فاخر';
    ELSIF v_current_tier = 0 AND v_avg >= 3.75 AND v_avg < 4.0 THEN v_near_tier := 1; v_near_name := 'اقتصادي';
    END IF;

    IF v_near_tier > 0 THEN
      v_target := CASE v_near_tier WHEN 1 THEN 'economy' WHEN 2 THEN 'premium' ELSE 'luxury' END;
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id = NEW.ratee_id AND data->>'rank_event' = 'near_' || v_target
      ) THEN
        INSERT INTO public.notifications (user_id, type, title, body, link, data)
        VALUES (
          NEW.ratee_id, 'driver_rank_progress', 'قريب من الترقية!',
          'مستواك يتقدم يا ' || v_name || '. استمر بالمحافظة على تقييماتك حتى تصل إلى رتبة ' || v_near_name || '.',
          '/profile', jsonb_build_object('rank_event','near_' || v_target,'rank',v_target,'ratings_count',v_count,'average_stars',round(v_avg,2))
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_driver_rating_tier_notice ON public.ratings;
CREATE TRIGGER trg_driver_rating_tier_notice
AFTER INSERT ON public.ratings
FOR EACH ROW EXECUTE FUNCTION public.notify_driver_rating_tier();

REVOKE ALL ON FUNCTION public.notify_driver_rating_tier() FROM PUBLIC, anon, authenticated;

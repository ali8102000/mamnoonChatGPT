-- Company branding is controlled by the verified Mamnoon owner account.
CREATE TABLE IF NOT EXISTS public.company_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  company_name text NOT NULL DEFAULT 'شركة ممنون',
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.company_settings (id, company_name)
VALUES (1, 'شركة ممنون')
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users read company name" ON public.company_settings;
CREATE POLICY "Authenticated users read company name"
  ON public.company_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Super admin updates company name" ON public.company_settings;
CREATE POLICY "Super admin updates company name"
  ON public.company_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "Super admin inserts company name" ON public.company_settings;
CREATE POLICY "Super admin inserts company name"
  ON public.company_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.company_settings TO authenticated;
GRANT ALL ON public.company_settings TO service_role;

-- Explicitly authorize the owner account requested by the app owner.
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'super_admin'::public.app_role
FROM auth.users
WHERE lower(email) = 'a7md0555666@gmail.com'
ON CONFLICT DO NOTHING;

-- New providers must start with zero reputation until real ratings/jobs exist.
CREATE OR REPLACE FUNCTION public.get_provider_reputation(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_avg numeric; v_prof numeric; v_punc numeric; v_qual numeric;
  v_cnt int; v_done int; v_score int;
  v_level text; v_name text; v_icon text; v_color text;
  v_badges jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(AVG(stars),0), COALESCE(AVG(professionalism),0),
         COALESCE(AVG(punctuality),0), COALESCE(AVG(quality),0), COUNT(*)
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

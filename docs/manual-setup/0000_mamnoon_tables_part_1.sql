CREATE TYPE public.app_role AS ENUM ('customer','driver','worker','admin','super_admin','support','finance','moderator');

CREATE TYPE public.worker_level AS ENUM ('fani','khabir');

CREATE TYPE public.request_type AS ENUM ('taxi','service');

CREATE TYPE public.request_status AS ENUM ('pending','searching','accepted','in_progress','completed','cancelled');

CREATE TYPE public.vehicle_category AS ENUM ('economy','premium','luxury');

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL UNIQUE,
  full_name text NOT NULL DEFAULT '',
  avatar_url text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX profiles_email_unique ON public.profiles (lower(email)) WHERE email IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);

GRANT SELECT, INSERT ON public.user_roles TO authenticated;

GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_staff_role(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id
    AND role IN ('super_admin','admin','support','finance','moderator'))
$$;

CREATE OR REPLACE FUNCTION public.has_admin_access(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role IN ('super_admin','admin'))
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.get_staff_roles(p_user_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(role::text ORDER BY role::text), ARRAY[]::text[]) FROM public.user_roles
  WHERE user_id = p_user_id AND role IN ('super_admin','admin','support','finance','moderator')
    AND (p_user_id = auth.uid() OR public.has_staff_role(auth.uid()) OR auth.uid() IS NULL)
$$;

REVOKE ALL ON FUNCTION public.has_staff_role(uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.has_admin_access(uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.get_staff_roles(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_staff_role(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.has_admin_access(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_staff_roles(uuid) TO authenticated, service_role;

CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_staff_role(auth.uid()));

CREATE POLICY "Users self-assign customer role" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND role = 'customer'::public.app_role);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phone text;
BEGIN
  v_phone := NULLIF(trim(NEW.raw_user_meta_data->>'phone'), '');
  IF v_phone IS NULL OR EXISTS (SELECT 1 FROM public.profiles WHERE phone = v_phone) THEN
    v_phone := 'user-' || NEW.id::text;
  END IF;
  INSERT INTO public.profiles (id, phone, full_name, email)
  VALUES (NEW.id, v_phone, COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
          CASE WHEN NEW.email LIKE '%@mamnoon.app' THEN NULL ELSE lower(NEW.email) END)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer') ON CONFLICT DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer') ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  icon text NOT NULL DEFAULT 'wrench',
  sort_order int NOT NULL DEFAULT 0
);

GRANT SELECT ON public.services TO authenticated, anon;

GRANT ALL ON public.services TO service_role;

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Services are public" ON public.services FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.services (slug, name_ar, name_en, icon, sort_order) VALUES
  ('build','بناء','Building','hammer',1),
  ('plaster','لبخ جدران وسقوف','Plastering','layers',2),
  ('carpentry_form','نجارة بيوت وقالب','Form Carpentry','square',3),
  ('flooring','تطبيق أرضيات','Flooring','grid',4),
  ('chef','طباخ (شيف)','Chef','chef-hat',5),
  ('plumbing','تأسيس ماء','Plumbing','droplet',6),
  ('electric_setup','تأسيس كهرباء','Electrical Setup','zap',7),
  ('electric_street','ربط كهرباء وتصليح أسلاك الشارع','Street Electric','cable',8),
  ('washer_repair','تصليح غسالة','Washer Repair','washing-machine',9),
  ('stove_repair','تصليح طباخ','Stove Repair','flame',10),
  ('fridge_repair','تصليح ثلاجة','Fridge Repair','refrigerator',11),
  ('ac_repair','تصليح وتنظيف سبلت','AC Service','wind',12),
  ('cleaning','تنظيف بيوت','House Cleaning','sparkles',13),
  ('wood_carpentry','نجارة أخشاب منزلية','Wood Carpentry','axe',14),
  ('blacksmith','حدادة','Blacksmith','anvil',15),
  ('general','خدمات منزلية عامة','General Home','home',16);

CREATE TABLE public.worker_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  level public.worker_level NOT NULL DEFAULT 'fani',
  available boolean NOT NULL DEFAULT false,
  bio text,
  status text NOT NULL DEFAULT 'approved',
  rating_avg numeric(3,2) NOT NULL DEFAULT 5.00,
  ratings_count int NOT NULL DEFAULT 0,
  completed_jobs int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.worker_profiles TO authenticated;

GRANT ALL ON public.worker_profiles TO service_role;

ALTER TABLE public.worker_profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER worker_profiles_updated_at BEFORE UPDATE ON public.worker_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.worker_services (
  worker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (worker_id, service_id)
);

GRANT SELECT, INSERT, DELETE ON public.worker_services TO authenticated;

GRANT ALL ON public.worker_services TO service_role;

ALTER TABLE public.worker_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Worker services viewable" ON public.worker_services FOR SELECT TO authenticated USING (true);

CREATE POLICY "Worker inserts own services" ON public.worker_services FOR INSERT TO authenticated WITH CHECK (auth.uid() = worker_id);

CREATE POLICY "Worker deletes own services" ON public.worker_services FOR DELETE TO authenticated USING (auth.uid() = worker_id);

CREATE TABLE public.driver_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  available boolean NOT NULL DEFAULT false,
  vehicle_make text,
  vehicle_model text,
  vehicle_year int,
  vehicle_plate text,
  vehicle_color text,
  vehicle_category public.vehicle_category,
  status text NOT NULL DEFAULT 'approved',
  rating_avg numeric(3,2) NOT NULL DEFAULT 5.00,
  ratings_count int NOT NULL DEFAULT 0,
  completed_rides int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_driver_profiles_available_cat ON public.driver_profiles (available, vehicle_category);

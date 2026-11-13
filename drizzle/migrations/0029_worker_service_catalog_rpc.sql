BEGIN;

-- Ensure the worker profession catalog is populated.
INSERT INTO public.services (slug, name_ar, name_en, icon, sort_order)
VALUES
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
  ('general','خدمات منزلية عامة','General Home','home',16)
ON CONFLICT (slug) DO NOTHING;

-- A narrow read-only RPC avoids catalog-loading failures caused by client-side table grants/RLS.
CREATE OR REPLACE FUNCTION public.get_worker_service_catalog()
RETURNS TABLE (id uuid, slug text, name_ar text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.slug, s.name_ar
  FROM public.services AS s
  ORDER BY s.sort_order, s.name_ar;
$$;

REVOKE ALL ON FUNCTION public.get_worker_service_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_worker_service_catalog() TO authenticated;

COMMIT;

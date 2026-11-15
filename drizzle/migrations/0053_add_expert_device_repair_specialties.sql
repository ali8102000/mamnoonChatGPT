INSERT INTO public.services (slug, name_ar, name_en, icon, sort_order)
SELECT v.slug, v.name_ar, v.name_en, v.icon, v.sort_order
FROM (VALUES
  ('phone_repair', 'صيانة الهواتف', 'Mobile phone repair', 'smartphone', 110),
  ('electronics_repair', 'صيانة الأجهزة الإلكترونية', 'Electronics repair', 'monitor', 111),
  ('computer_repair', 'صيانة الحاسبات واللابتوبات', 'Computer and laptop repair', 'laptop', 112)
) AS v(slug, name_ar, name_en, icon, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.services s WHERE s.slug = v.slug
);

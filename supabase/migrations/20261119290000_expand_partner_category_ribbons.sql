-- Expand restaurant and store category ribbon catalog.
begin;
insert into public.partner_catalog_categories
(category_key,vertical,title,image_url,sort_order)
values
('shawarma','restaurant','شاورما','https://images.unsplash.com/photo-1561651823-34feb02250e4?w=240&h=240&fit=crop',115),
('burgers','restaurant','برغر','https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=240&h=240&fit=crop',125),
('breakfast','restaurant','فطور صباحي','https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?w=240&h=240&fit=crop',135),
('seafood','restaurant','مأكولات بحرية','https://images.unsplash.com/photo-1559847844-5315695dadae?w=240&h=240&fit=crop',145),
('iraqi_food','restaurant','أكلات عراقية','https://images.unsplash.com/photo-1547592180-85f173990554?w=240&h=240&fit=crop',155),
('bakery','restaurant','مخابز ومعجنات','https://images.unsplash.com/photo-1509440159596-0249088772ff?w=240&h=240&fit=crop',165),
('ice_cream','restaurant','آيس كريم','https://images.unsplash.com/photo-1501446529957-6226bd447c46?w=240&h=240&fit=crop',175),
('drinks','restaurant','مشروبات باردة','https://images.unsplash.com/photo-1544145945-f90425340c7e?w=240&h=240&fit=crop',185),
('bags','store','حقائب','https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=240&h=240&fit=crop',25),
('watches','store','ساعات','https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=240&h=240&fit=crop',35),
('jewelry','store','ذهب ومجوهرات','https://images.unsplash.com/photo-1611652022419-a9419f74343d?w=240&h=240&fit=crop',45),
('furniture','store','أثاث','https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=240&h=240&fit=crop',85),
('appliances','store','أجهزة منزلية','https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=240&h=240&fit=crop',95),
('mobile_phones','store','موبايلات','https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=240&h=240&fit=crop',105),
('sports','store','رياضة','https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=240&h=240&fit=crop',115),
('gifts','store','هدايا','https://images.unsplash.com/photo-1513201099705-a9746e1e201f?w=240&h=240&fit=crop',125),
('stationery','store','قرطاسية','https://images.unsplash.com/photo-1455390582262-044cdee6e3f?w=240&h=240&fit=crop',135)
on conflict (category_key) do nothing;
commit;

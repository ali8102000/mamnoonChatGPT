begin;
insert into public.partner_catalog_categories
(category_key, vertical, title, image_url, is_active, sort_order)
values
('kebab','restaurant','كباب عراقي','https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=240&h=240&fit=crop',true,190),
('dolma','restaurant','دولمة ومحاشي','https://images.unsplash.com/photo-1547592180-85f173990554?w=240&h=240&fit=crop',true,200),
('biryani','restaurant','برياني','https://images.unsplash.com/photo-1512058564366-18510be2db19?w=240&h=240&fit=crop',true,210),
('quzi','restaurant','قوزي ومناسف','https://images.unsplash.com/photo-1547592180-85f173990554?w=240&h=240&fit=crop',true,220),
('mandi','restaurant','مندي ومظبي','https://images.unsplash.com/photo-1512058564366-18510be2db19?w=240&h=240&fit=crop',true,230),
('masgouf','restaurant','مسگوف وسمك عراقي','https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=240&h=240&fit=crop',true,240),
('falafel','restaurant','فلافل وفول','https://images.unsplash.com/photo-1593001874117-c99c800e3eb6?w=240&h=240&fit=crop',true,250),
('shawarma_rice','restaurant','وجبات رز ودجاج','https://images.unsplash.com/photo-1512058564366-18510be2db19?w=240&h=240&fit=crop',true,260),
('computers','store','حاسبات وكمبيوتر','https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=240&h=240&fit=crop',true,145),
('toys','store','ألعاب أطفال','https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=240&h=240&fit=crop',true,155),
('car_accessories','store','إكسسوارات سيارات','https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=240&h=240&fit=crop',true,165),
('kitchenware','store','أدوات ومستلزمات مطبخ','https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=240&h=240&fit=crop',true,175),
('building_supplies','store','مواد وأدوات بناء','https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=240&h=240&fit=crop',true,185),
('baby_supplies','store','مستلزمات أطفال','https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=240&h=240&fit=crop',true,195),
('textiles','store','أقمشة وخياطة','https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?w=240&h=240&fit=crop',true,205),
('garden','store','حدائق وزراعة','https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=240&h=240&fit=crop',true,215)
on conflict (category_key) do update set
 vertical=excluded.vertical, title=excluded.title, image_url=excluded.image_url,
 is_active=true, sort_order=excluded.sort_order, updated_at=now();
commit;
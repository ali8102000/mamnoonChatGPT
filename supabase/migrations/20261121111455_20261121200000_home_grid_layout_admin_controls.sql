-- Register the responsive customer-home grid as an admin-editable visual element.
insert into public.app_ui_elements
  (element_key,label,screen_key,placement_key,element_type,action_key,title,subtitle,width_px,height_px,sort_order,is_enabled,is_published,config,published_config)
values
  ('home_customer_grid_layout','تخطيط شبكة الصفحة الرئيسية','home','home.customer.grid','card','layout.home.grid','تخطيط الصفحة الرئيسية','مقاسات البطاقات والبانر والمسافات',336,188,1,true,true,
   '{"grid_gap_px":12,"first_row_height_px":145,"second_row_height_px":188,"top_banner_height_px":130,"wide_column_ratio":2,"card_radius_px":20,"taxi_icon_size_px":56,"service_icon_size_px":64,"large_icon_size_px":56,"carousel_height_px":188}'::jsonb,
   '{"grid_gap_px":12,"first_row_height_px":145,"second_row_height_px":188,"top_banner_height_px":130,"wide_column_ratio":2,"card_radius_px":20,"taxi_icon_size_px":56,"service_icon_size_px":64,"large_icon_size_px":56,"carousel_height_px":188}'::jsonb)
on conflict (element_key) do nothing;

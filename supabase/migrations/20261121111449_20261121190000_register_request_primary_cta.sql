-- Register the primary request action in the visual admin editor for web and native apps.
insert into public.app_ui_elements
  (element_key,label,screen_key,placement_key,element_type,action_key,title,subtitle,width_px,height_px,sort_order,is_published,config,published_config)
values
  ('request_primary_cta','زر إرسال الطلب','request.new','request.form.primary_action','icon_button','request.submit','اطلب الآن',null,320,56,70,true,
   '{"element_scale":1,"card_padding_px":16,"border_radius_px":16}'::jsonb,
   '{"element_scale":1,"card_padding_px":16,"border_radius_px":16}'::jsonb)
on conflict (element_key) do nothing;

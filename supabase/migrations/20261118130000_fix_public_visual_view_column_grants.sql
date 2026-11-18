-- Security-invoker public views need column-level SELECT grants after base-table revocation.
grant select (
  element_key,label,screen_key,placement_key,element_type,action_key,title,subtitle,
  sort_order,is_enabled,is_published,published_config,updated_at
) on public.app_ui_elements to anon;

grant select (
  id,title,section_type,placement_key,sort_order,is_enabled,is_published,published_config,updated_at
) on public.app_content_sections to anon;

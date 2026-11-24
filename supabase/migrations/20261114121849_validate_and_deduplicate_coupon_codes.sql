create unique index if not exists coupons_code_upper_unique
on public.coupons (upper(trim(code)));

create or replace function public.admin_save_coupon(
  p_id uuid,
  p_code text,
  p_type text,
  p_value numeric,
  p_max_uses integer,
  p_expires_at timestamptz,
  p_active boolean,
  p_min_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id uuid;
  v_code text := upper(trim(coalesce(p_code,'')));
  v_used integer := 0;
begin
  perform public.assert_staff('admin');

  if length(v_code)<2 or length(v_code)>50 then
    raise exception 'رمز الكوبون يجب أن يكون بين حرفين و50 حرفاً';
  end if;
  if p_type not in ('percentage','fixed') then
    raise exception 'نوع الخصم غير صحيح';
  end if;
  if p_value is null or p_value<=0 then
    raise exception 'قيمة الخصم يجب أن تكون أكبر من صفر';
  end if;
  if p_type='percentage' and p_value>100 then
    raise exception 'نسبة الخصم لا يمكن أن تتجاوز 100 بالمئة';
  end if;
  if p_max_uses is null or p_max_uses<1 then
    raise exception 'عدد مرات الاستخدام يجب أن يكون واحداً أو أكثر';
  end if;
  if p_min_amount is null or p_min_amount<0 then
    raise exception 'الحد الأدنى للطلب غير صحيح';
  end if;
  if coalesce(p_active,true) and p_expires_at is not null and p_expires_at<=now() then
    raise exception 'تاريخ انتهاء الكوبون يجب أن يكون في المستقبل';
  end if;

  if p_id is null then
    insert into public.coupons(code,type,value,max_uses,expires_at,active,min_amount)
    values(v_code,p_type,p_value,p_max_uses,p_expires_at,coalesce(p_active,true),p_min_amount)
    returning id into v_id;
    perform public.log_admin_action('create_coupon','coupon',v_id::text,jsonb_build_object('code',v_code));
  else
    select used_count into v_used from public.coupons where id=p_id for update;
    if not found then raise exception 'الكوبون غير موجود'; end if;
    if p_max_uses<v_used then
      raise exception 'عدد الاستخدامات لا يمكن أن يقل عن الاستخدامات المسجلة';
    end if;
    update public.coupons
      set code=v_code,type=p_type,value=p_value,max_uses=p_max_uses,
          expires_at=p_expires_at,active=coalesce(p_active,true),
          min_amount=p_min_amount,updated_at=now()
      where id=p_id
      returning id into v_id;
    perform public.log_admin_action('update_coupon','coupon',p_id::text,jsonb_build_object('code',v_code));
  end if;
  return v_id;
end;
$function$;

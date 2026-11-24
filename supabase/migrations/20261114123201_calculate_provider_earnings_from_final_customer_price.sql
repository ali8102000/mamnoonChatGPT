create or replace function public.on_request_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_commission numeric := 0;
  v_earning numeric := 0;
  v_pct numeric := 0;
  v_gross numeric := 0;
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and new.provider_id is not null then

    if new.type = 'taxi' then
      update public.driver_profiles
      set completed_rides = completed_rides + 1
      where user_id = new.provider_id;
    else
      update public.worker_profiles
      set completed_jobs = completed_jobs + 1
      where user_id = new.provider_id;
    end if;

    -- customer_price is the final agreed price for large taxis and services.
    -- price_estimate remains the fallback for metered/estimated taxi requests.
    v_gross := coalesce(new.customer_price::numeric, new.price_estimate, 0);

    if v_gross > 0 then
      if new.type = 'taxi' and new.vehicle_category is not null then
        select coalesce(pr.commission_pct, 0)
          into v_pct
        from public.pricing_rules pr
        where pr.vehicle_category = new.vehicle_category::text
          and pr.active = true
        order by pr.updated_at desc
        limit 1;
        v_pct := coalesce(v_pct, 0);
      else
        -- No service commission rate is configured in the current schema.
        -- Preserve the existing zero-commission behavior; never invent a fee.
        v_pct := 0;
      end if;

      v_commission := round(v_gross * v_pct / 100);
      v_earning := v_gross - v_commission;

      insert into public.driver_wallets
        (user_id, balance, total_earned, total_commission)
      values
        (new.provider_id, v_earning, v_earning, v_commission)
      on conflict (user_id) do update
        set balance = public.driver_wallets.balance + excluded.balance,
            total_earned = public.driver_wallets.total_earned + excluded.total_earned,
            total_commission = public.driver_wallets.total_commission + excluded.total_commission,
            updated_at = now();

      insert into public.transactions
        (user_id, request_id, type, amount, note)
      values
        (new.provider_id, new.id, 'earning', v_earning,
         case when new.type = 'taxi' then 'كسب من طلب سيارة' else 'كسب من طلب خدمة' end);

      if v_commission > 0 then
        insert into public.transactions
          (user_id, request_id, type, amount, note)
        values
          (new.provider_id, new.id, 'commission', -v_commission, 'عمولة المنصة');
      end if;

      update public.service_requests
      set commission = v_commission
      where id = new.id;

      insert into public.notifications (user_id, type, title, body, link)
      values (
        new.provider_id,
        'earning',
        'أرباح جديدة',
        'تمت إضافة ' || v_earning::text || ' د.ع إلى محفظتك',
        '/profile'
      );
    end if;

    insert into public.notifications (user_id, type, title, body, link)
    values (
      new.customer_id,
      'request_completed',
      'اكتمل الطلب',
      'يرجى تقييم مقدّم الخدمة',
      '/request/' || new.id
    );
  end if;

  return new;
end;
$function$;

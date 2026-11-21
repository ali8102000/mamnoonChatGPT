-- Harden the admin wallet adjustment RPC used by the finance controls.
create or replace function public.admin_adjust_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_note text,
  p_type text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_delta numeric;
  v_balance numeric;
  v_target_governorate text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_user_id is null then raise exception 'invalid_user'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 then
    raise exception 'invalid_amount';
  end if;
  if p_type not in ('credit','debit') then
    raise exception 'invalid_adjustment_type';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'note_too_long';
  end if;

  select governorate_key into v_target_governorate
  from public.profiles
  where id = p_user_id;
  if not found then raise exception 'wallet_user_not_found'; end if;

  if not (
    public.has_admin_access(auth.uid())
    or public.admin_has_permission(
      'finance.wallet.adjust',
      case when v_target_governorate is null then 'global' else 'governorate' end,
      v_target_governorate
    )
  ) then
    raise exception 'missing_finance_wallet_permission';
  end if;

  v_delta := case when p_type = 'debit' then -p_amount else p_amount end;

  insert into public.driver_wallets(user_id,balance)
  values(p_user_id,v_delta)
  on conflict(user_id) do update
    set balance = public.driver_wallets.balance + v_delta,
        updated_at = now()
  returning balance into v_balance;

  insert into public.transactions(user_id,type,amount,balance_after,note)
  values(p_user_id,'adjustment',v_delta,v_balance,nullif(trim(coalesce(p_note,'')), ''));

  perform public.log_admin_action(
    'adjust_wallet','user',p_user_id::text,
    jsonb_build_object('amount',v_delta,'note',p_note,'adjustment_type',p_type,'balance_after',v_balance)
  );
end;
$function$;
revoke all on function public.admin_adjust_wallet(uuid,numeric,text,text) from public, anon;
grant execute on function public.admin_adjust_wallet(uuid,numeric,text,text) to authenticated;

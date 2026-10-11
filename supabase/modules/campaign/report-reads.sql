-- Additive read receipts belong to the ruler, including recovered name-only sessions.
alter table public.peris_reports add column if not exists read_at timestamptz;
create or replace function public.peris_read_reports(p_report_ids bigint[])returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if auth.uid() is null or u is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_report_ids is null or cardinality(p_report_ids)<1 or cardinality(p_report_ids)>50 or array_position(p_report_ids,null)is not null then
  raise exception 'Choose valid reports' using errcode='22023';end if;
 if exists(select 1 from unnest(p_report_ids)as requested(report_id) where requested.report_id<=0 or not exists(select 1 from public.peris_reports r where r.id=requested.report_id and r.owner_id=u))then
  raise exception 'These reports are not available to this ruler' using errcode='42501';end if;
 update public.peris_reports set read_at=now() where owner_id=u and id=any(p_report_ids) and read_at is null;
end $$;
revoke all on function public.peris_read_reports(bigint[]) from public,anon;
grant execute on function public.peris_read_reports(bigint[]) to authenticated;

-- Bulk reads include historical receipts beyond the bounded snapshot page.
create or replace function public.peris_read_all_reports()returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if auth.uid() is null or u is null then raise exception 'Authentication required' using errcode='42501';end if;
 update public.peris_reports set read_at=now() where owner_id=u and read_at is null;
end $$;
revoke all on function public.peris_read_all_reports() from public,anon;
grant execute on function public.peris_read_all_reports() to authenticated;

create or replace function public.peris_report_page(p_before_id bigint default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if auth.uid() is null or u is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_before_id is not null and p_before_id<=0 then raise exception 'Choose a valid report page' using errcode='22023';end if;
 return coalesce((select jsonb_agg(r order by r.id desc)from(
  select * from public.peris_reports r where r.owner_id=u and (p_before_id is null or r.id<p_before_id)
   and (coalesce((r.result->>'attacker_losses')::integer,0)>0 or not exists(select 1 from public.peris_campaign_farm_lists l where l.id=r.farm_list_id and l.owner_id=u and l.casualties_only))
  order by r.id desc limit 50
 )r),'[]'::jsonb);
end $$;
revoke all on function public.peris_report_page(bigint) from public,anon;
grant execute on function public.peris_report_page(bigint) to authenticated;

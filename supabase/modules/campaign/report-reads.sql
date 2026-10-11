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

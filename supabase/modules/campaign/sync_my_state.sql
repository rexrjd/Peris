create or replace function public.sync_my_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where owner_id=u for update;
 if a.raid_target_id is not null and a.status='idle' then
 if not exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then perform public.peris_start_raid(u,a.raid_target_id);end if;
 end if;
 return jsonb_build_object('ok',true);
end $$;


create or replace function public.sync_my_state()returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if not exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then
 for a in select * from public.armies where owner_id=u and raid_target_id is not null and status='idle'order by arrival_at,id for update loop
  if exists(select 1 from public.peris_progress where owner_id=u and camp_id=a.raid_target_id and available_at>now())or a.infantry+a.archers+a.cavalry=0 then update public.armies set raid_target_id=null where id=a.id;continue;end if;
  perform set_config('peris.army_id',a.id::text,true);perform public.peris_start_raid(u,a.raid_target_id);exit;
 end loop;
 end if;
 return jsonb_build_object('ok',true);
end $$;

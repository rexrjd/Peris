create or replace function public.peris_sync_owner(p_owner uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if not exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then
 for a in select * from public.armies where owner_id=u and raid_city_id is not null and status='idle'order by arrival_at,id for update loop
  if a.infantry+a.archers+a.cavalry=0 or not exists(select 1 from public.settlements where id=a.raid_city_id and owner_id<>u)then perform public.peris_return_raid(a.id);continue;end if;
  if public.peris_start_city_raid(u,a.id)is not null then exit;end if;
 end loop;
 end if;
 if not exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then
 for a in select * from public.armies where owner_id=u and raid_target_id is not null and status='idle'order by arrival_at,id for update loop
  if (not exists(select 1 from public.peris_camps where id=a.raid_target_id and bandit) and exists(select 1 from public.peris_progress where owner_id=u and camp_id=a.raid_target_id and available_at>now()))or a.infantry+a.archers+a.cavalry=0 then
   perform public.peris_restore_raid_reserve(a.id);perform public.peris_return_raid(a.id);update public.armies set raid_target_id=null where id=a.id;continue;
  end if;
  perform set_config('peris.army_id',a.id::text,true);perform public.peris_start_raid(u,a.raid_target_id);exit;
 end loop;
 end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.sync_my_state()returns jsonb language plpgsql security definer set search_path='' as $$
begin return public.peris_sync_owner(public.peris_player_id());end $$;

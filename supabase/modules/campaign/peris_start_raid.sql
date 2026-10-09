create or replace function public.peris_start_raid(p_owner uuid,p_camp integer) returns bigint
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.peris_camps%rowtype;bid bigint;mor numeric;
begin
 select * into a from public.armies where id=public.peris_army_id(p_owner) for update;
 select * into c from public.peris_camps where id=p_camp;
 if c.id is null or a.id is null then raise exception 'Army or camp not found';end if;
 if a.infantry+a.archers+a.cavalry=0 then raise exception 'Your army has no soldiers';end if;
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=p_owner or defender_owner_id=p_owner)) then raise exception 'Finish the current battle first';end if;
 if exists(select 1 from public.peris_progress where owner_id=p_owner and camp_id=p_camp and available_at>now()) then raise exception 'The camp is still regrouping';end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,camp_id,terrain,difficulty,enemy_name,defender_ready)
 values(p_owner,null,a.id,null,'pve','deployment',c.id,c.terrain,case when c.tier>=4 then 'hard' when c.tier=1 then 'easy' else 'normal' end,c.name,true) returning id into bid;
 select 90+2*level into mor from public.buildings where settlement_id=a.home_settlement_id and building_type='wall';
 perform public.peris_add_formations(bid,p_owner,'attacker',a.infantry,a.archers,a.cavalry,coalesce(mor,92));
 perform public.peris_add_formations(bid,null,'defender',c.infantry,c.archers,c.cavalry,case when c.tier>=4 then 100 when c.tier=1 then 78 else 90 end);
 update public.armies set raid_target_id=null where id=a.id;
 return bid;
end $$;


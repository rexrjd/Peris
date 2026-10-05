create or replace function public.peris_respond(p_id bigint,p_accept boolean)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();c public.peris_challenges%rowtype;a public.armies%rowtype;d public.armies%rowtype;bid bigint;
begin
 select * into c from public.peris_challenges where id=p_id for update;
 if u is null or c.id is null or c.defender_owner_id<>u then raise exception 'Not your invitation';end if;
 if c.status<>'pending' or c.expires_at<=now()then raise exception 'Challenge has expired';end if;
 if not p_accept then update public.peris_challenges set status='declined'where id=c.id;return jsonb_build_object('ok',true);end if;
 perform 1 from public.players where id in(c.attacker_owner_id,c.defender_owner_id)order by id for update;
 perform public.peris_settle(c.attacker_owner_id);perform public.peris_settle(c.defender_owner_id);
 perform 1 from public.armies where owner_id in(c.attacker_owner_id,c.defender_owner_id)order by owner_id for update;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id in(c.attacker_owner_id,c.defender_owner_id)or defender_owner_id in(c.attacker_owner_id,c.defender_owner_id)))then raise exception 'One army is already fighting';end if;
 if exists(select 1 from public.peris_orders where owner_id in(c.attacker_owner_id,c.defender_owner_id)and kind='recruit')then raise exception 'Finish training before a duel';end if;
 select * into a from public.armies where owner_id=c.attacker_owner_id;select * into d from public.armies where owner_id=c.defender_owner_id;
 if a.id is null or d.id is null or a.infantry+a.archers+a.cavalry=0 or d.infantry+d.archers+d.cavalry=0 then raise exception 'Both armies need soldiers';end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,terrain,enemy_name)
 values(a.owner_id,d.owner_id,a.id,d.id,'pvp','deployment','plains',(select display_name from public.players where id=d.owner_id))returning id into bid;
 perform public.peris_add_formations(bid,a.owner_id,'attacker',a.infantry,a.archers,a.cavalry,coalesce((select 90+2*level from public.buildings where settlement_id=a.home_settlement_id and building_type='wall'),92));
 perform public.peris_add_formations(bid,d.owner_id,'defender',d.infantry,d.archers,d.cavalry,coalesce((select 90+2*level from public.buildings where settlement_id=d.home_settlement_id and building_type='wall'),92));
 update public.armies set status='idle',raid_target_id=null where id in(a.id,d.id);
 update public.peris_challenges set status='accepted'where id=c.id;
 return jsonb_build_object('ok',true,'battle_id',bid);
end $$;


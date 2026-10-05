create or replace function public.peris_rally(p_battle_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;side_name text;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id)then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'combat' then raise exception 'Rally is available during combat';end if;
 side_name:=case when u=b.attacker_owner_id then 'attacker' else 'defender' end;
 if (side_name='attacker' and b.rally_attacker)or(side_name='defender' and b.rally_defender)then raise exception 'Your general has already rallied the army';end if;
 update public.battles set rally_attacker=rally_attacker or side_name='attacker',rally_defender=rally_defender or side_name='defender'where id=b.id;
 update public.battle_formations set morale=least(100,morale+25),status=case when status='routed' then 'idle' else status end,
 target_x=case when status='routed' then x else target_x end,target_y=case when status='routed' then y else target_y end where battle_id=b.id and owner_id=u and soldiers>0;
 return jsonb_build_object('ok',true);
end $$;


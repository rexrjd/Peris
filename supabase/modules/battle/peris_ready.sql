create or replace function public.peris_ready(p_battle_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'deployment' then raise exception 'Battle has already started';end if;
 update public.battles set attacker_ready=attacker_ready or u=attacker_owner_id,defender_ready=defender_ready or u=defender_owner_id where id=b.id returning * into b;
 if b.attacker_ready and b.defender_ready then update public.battles set phase='combat',started_at=now(),last_tick_at=now() where id=b.id;end if;
 return jsonb_build_object('ok',true);
end $$;


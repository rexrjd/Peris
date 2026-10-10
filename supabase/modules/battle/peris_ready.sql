create or replace function public.peris_ready(p_battle_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status='active'and b.phase='deployment'then update public.battles set phase='combat',attacker_ready=true,defender_ready=true,last_tick_at=now()where id=b.id;end if;
 return jsonb_build_object('ok',true);
end $$;

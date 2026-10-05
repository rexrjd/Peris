create or replace function public.retreat_from_battle(p_battle_id bigint)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id)then raise exception 'Not your battle';end if;
 perform public.peris_finish(b.id,case when u=b.attacker_owner_id then 'defender' else 'attacker' end,'Withdrawal');
 return jsonb_build_object('ok',true);
end $$;


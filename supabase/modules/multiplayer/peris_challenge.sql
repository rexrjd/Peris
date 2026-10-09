create or replace function public.peris_challenge(p_defender uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null or p_defender is null or u=p_defender then raise exception 'Choose another ruler';end if;
 perform 1 from public.players where id in(u,p_defender) order by id for update;
 if not exists(select 1 from public.players where id=p_defender)then raise exception 'Ruler not found';end if;
 if exists(select 1 from public.battles where status='active'and (attacker_owner_id in(u,p_defender)or defender_owner_id in(u,p_defender)))then raise exception 'One army is already fighting';end if;
 if exists(select 1 from public.peris_challenges where status='pending'and expires_at>now()and(attacker_owner_id=u or defender_owner_id=u))then raise exception 'You already have a pending challenge';end if;
 insert into public.peris_challenges(attacker_owner_id,defender_owner_id,attacker_army_id)values(u,p_defender,public.peris_army_id(u));
 return jsonb_build_object('ok',true);
end $$;


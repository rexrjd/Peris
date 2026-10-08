create or replace function public.peris_claim(p_quest_id text)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();p public.players%rowtype;cw integer;cs integer;cf integer;cg integer;
begin
 if u is null then raise exception 'Authentication required';end if;perform public.peris_settle(u);select * into p from public.players where id=u for update;
 if exists(select 1 from public.peris_claims where owner_id=u and quest_id=p_quest_id)then raise exception 'Reward already claimed';end if;
 if p_quest_id='builder' and p.upgrades>=1 then cw:=250;cs:=200;cf:=200;cg:=50;
 elsif p_quest_id='recruiter' and p.recruits>=20 then cw:=200;cs:=150;cf:=300;cg:=75;
 elsif p_quest_id='victor' and p.victories>=1 then cw:=300;cs:=300;cf:=400;cg:=150;
 elsif p_quest_id='conqueror' and p.victories>=5 then cw:=1000;cs:=800;cf:=1000;cg:=500;
 else raise exception 'Complete the objective first';end if;
 insert into public.peris_claims(owner_id,quest_id)values(u,p_quest_id);
 update public.settlements set wood=least(capacity,wood+cw),stone=least(capacity,stone+cs),food=least(food_capacity,food+cf),gold=least(capacity,gold+cg)where owner_id=u;
 return jsonb_build_object('ok',true);
end $$;

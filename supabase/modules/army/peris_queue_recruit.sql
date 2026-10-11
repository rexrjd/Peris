create or replace function public.peris_queue_recruit(p_type text,p_quantity integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;a public.armies%rowtype;l integer;at_time timestamptz;duration numeric;queued integer;home jsonb;r public.peris_unit_catalog%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 select * into r from public.peris_unit_catalog where unit=p_type;
 if r.unit is null or p_quantity is null or p_quantity<1 or p_quantity>200 then raise exception 'Choose between 1 and 200 soldiers';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) and owner_id=u for update;
 select * into a from public.armies where id=public.peris_army_id(u) and owner_id=u for update;
 if s.id is null or a.id is null then raise exception 'Realm not found';end if;
 home:=public.peris_home_army_position(s.x,s.y);
 if a.status='moving' or a.raid_target_id is not null or a.raid_reserve is not null or sqrt(power(a.target_x-(home->>'x')::integer,2)+power(a.target_y-(home->>'y')::integer,2))>90 then raise exception 'Bring your army home to recruit';end if;
 if (select count(*)from public.peris_orders where owner_id=u and army_id=a.id and kind='recruit')>=3 then raise exception 'Training queue is full';end if;
 select coalesce(sum(quantity),0)into queued from public.peris_orders where owner_id=u and army_id=a.id and kind='recruit';
 if a.infantry+a.archers+a.cavalry+queued+p_quantity>1000 then raise exception 'Army capacity is 1,000 soldiers';end if;
 select coalesce(sum(level),0) into l from public.peris_city_slots where settlement_id=s.id and building_type=r.building;
 if l=0 then raise exception 'Build % first',r.building;end if;
 if r.research_seconds>0 and not exists(select 1 from public.peris_unit_research where settlement_id=s.id and unit=p_type and completes_at<=now())then raise exception 'Research this unit in this village first';end if;
 if s.wood<(r.cost->>'wood')::integer*p_quantity or s.stone<(r.cost->>'stone')::integer*p_quantity or s.food<(r.cost->>'food')::integer*p_quantity or s.gold<(r.cost->>'gold')::integer*p_quantity then raise exception 'Your stores cannot cover this cost';end if;
 select greatest(now(),coalesce(max(o.finish_at),now()))into at_time from public.peris_orders o join public.peris_unit_catalog c on c.unit=o.item where o.settlement_id=s.id and o.kind='recruit' and c.building=r.building;
 duration:=greatest(5,ceil(p_quantity*r.train_seconds/(1+(l-1)*.18)));
 update public.settlements set wood=wood-(r.cost->>'wood')::integer*p_quantity,stone=stone-(r.cost->>'stone')::integer*p_quantity,food=food-(r.cost->>'food')::integer*p_quantity,gold=gold-(r.cost->>'gold')::integer*p_quantity where id=s.id;
 insert into public.peris_orders(owner_id,settlement_id,army_id,kind,item,quantity,started_at,finish_at)values(u,s.id,a.id,'recruit',p_type,p_quantity,at_time,at_time+make_interval(secs=>duration::double precision));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_research_unit(p_city bigint,p_unit text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;r public.peris_unit_catalog%rowtype;at_time timestamptz;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=coalesce(p_city,public.peris_city_id(u)) and owner_id=u for update;
 select * into r from public.peris_unit_catalog where unit=p_unit;
 if s.id is null or r.unit is null then raise exception 'Choose your own village and a known unit';end if;
 if r.research_seconds=0 or exists(select 1 from public.peris_unit_research where settlement_id=s.id and unit=r.unit)then raise exception 'This unit is already researched or queued';end if;
 if not exists(select 1 from public.peris_city_slots where settlement_id=s.id and building_type=r.building and level>0)then raise exception 'Build % first',r.building;end if;
 if s.wood<(r.research_cost->>'wood')::integer or s.stone<(r.research_cost->>'stone')::integer or s.food<(r.research_cost->>'food')::integer or s.gold<(r.research_cost->>'gold')::integer then raise exception 'Your stores cannot cover this research';end if;
 select greatest(now(),coalesce(max(research.completes_at),now()))into at_time from public.peris_unit_research research join public.peris_unit_catalog c on c.unit=research.unit where research.settlement_id=s.id and c.building=r.building;
 update public.settlements set wood=wood-(r.research_cost->>'wood')::integer,stone=stone-(r.research_cost->>'stone')::integer,food=food-(r.research_cost->>'food')::integer,gold=gold-(r.research_cost->>'gold')::integer where id=s.id;
 insert into public.peris_unit_research values(s.id,r.unit,at_time+make_interval(secs=>r.research_seconds));
 return jsonb_build_object('ok',true);
end $$;

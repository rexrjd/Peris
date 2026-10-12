create or replace function public.peris_science_ensure(p_owner uuid)returns void language sql security definer set search_path='' as $$
 insert into public.peris_account_science(owner_id)select id from public.players where id=p_owner on conflict do nothing
$$;
create or replace function public.peris_science_rate(p_owner uuid)returns numeric language sql stable security definer set search_path='' as $$
 select (6+coalesce(sum(case c.level when 1 then 12 when 2 then 28 when 3 then 48 when 4 then 72 when 5 then 100 else 0 end),0))*public.peris_research_factor(p_owner,'science')
 from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=p_owner and c.building_type='academy'
$$;
create or replace function public.peris_science_deadline(p_owner uuid)returns timestamptz language sql stable security definer set search_path='' as $$
 select s.active_since+make_interval(secs=>ceil((c.seconds-p.seconds)/s.active_rate*1000-1e-7)::double precision/1000)
 from public.peris_account_science s join public.peris_technology_catalog c on c.id=s.active_id join public.peris_research_progress p on p.owner_id=s.owner_id and p.technology_id=s.active_id where s.owner_id=p_owner
$$;
create or replace function public.peris_science_accrue(p_owner uuid,p_until timestamptz)returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.peris_science_ensure(p_owner);
 update public.peris_account_science set points=least(1000000000,points+greatest(0,extract(epoch from(p_until-updated_at)))/60*public.peris_science_rate(p_owner)),updated_at=greatest(updated_at,p_until)where owner_id=p_owner;
end $$;
create or replace function public.peris_science_advance(p_owner uuid,p_until timestamptz)returns void language plpgsql security definer set search_path='' as $$
declare s public.peris_account_science%rowtype;due timestamptz;c public.peris_technology_catalog%rowtype;city record;
begin
 perform public.peris_science_ensure(p_owner);select * into s from public.peris_account_science where owner_id=p_owner for update;
 due:=public.peris_science_deadline(p_owner);
 if due is not null and due<=p_until then
  perform public.peris_science_accrue(p_owner,due);perform public.peris_culture_accrue(p_owner,due);
  for city in select id from public.settlements where owner_id=p_owner order by id loop perform public.peris_population_accrue(city.id,due);end loop;
  select * into c from public.peris_technology_catalog where id=s.active_id;
  update public.peris_research_progress set seconds=c.seconds,completed_at=due where owner_id=p_owner and technology_id=c.id and completed_at is null;
  update public.peris_account_science set active_id=null,active_since=null where owner_id=p_owner;
  for city in select id from public.settlements where owner_id=p_owner order by id loop perform public.peris_city_economy(city.id);end loop;
 end if;
 perform public.peris_science_accrue(p_owner,p_until);
end $$;
create or replace function public.peris_research_pause(p_owner uuid,p_until timestamptz)returns void language plpgsql security definer set search_path='' as $$
declare s public.peris_account_science%rowtype;
begin
 perform public.peris_science_advance(p_owner,p_until);select * into s from public.peris_account_science where owner_id=p_owner for update;
 if s.active_id is not null then
  update public.peris_research_progress p set seconds=least(c.seconds,p.seconds+greatest(0,extract(epoch from(p_until-s.active_since)))*s.active_rate)from public.peris_technology_catalog c where c.id=s.active_id and p.owner_id=p_owner and p.technology_id=c.id;
 end if;
 update public.peris_account_science set active_id=null,active_since=null where owner_id=p_owner;
end $$;
create or replace function public.peris_research_command(p_command jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.peris_account_science%rowtype;c public.peris_technology_catalog%rowtype;p public.peris_research_progress%rowtype;kind text:=p_command->>'type';
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_science_advance(u,now());select * into s from public.peris_account_science where owner_id=u for update;
 if kind='pauseResearch'then perform public.peris_research_pause(u,now());
 elsif kind='debugResearch'then
  if not coalesce((select enabled from public.peris_debug_config where id),false)then raise exception 'Debug controls are disabled';end if;
  if p_command->>'action'='points'then update public.peris_account_science set points=least(1000000000,points+10000)where owner_id=u;
  elsif p_command->>'action'='complete'then
   if s.active_id is null then raise exception 'Start a technology first';end if;
   update public.peris_research_progress p set seconds=c.seconds from public.peris_technology_catalog c where c.id=s.active_id and p.owner_id=u and p.technology_id=c.id;
   update public.peris_account_science set active_since=now()where owner_id=u;perform public.peris_science_advance(u,now());
  else raise exception 'Unknown research debug action';end if;
 elsif kind='startResearch'then
  select * into c from public.peris_technology_catalog where id=p_command->>'technologyId';
  if c.id is null then raise exception 'Unknown technology';end if;
  if c.faction is not null and c.faction is distinct from coalesce((select faction from public.settlements where owner_id=u order by id limit 1),'roman')then raise exception 'This technology belongs to another faction';end if;
  select * into p from public.peris_research_progress where owner_id=u and technology_id=c.id;
  if p.completed_at is not null then raise exception 'Already researched';end if;
  if exists(select 1 from jsonb_array_elements_text(c.prerequisites)r(id)where not exists(select 1 from public.peris_research_progress where owner_id=u and technology_id=r.id and completed_at is not null))then raise exception 'Research the prerequisites first';end if;
  if s.active_id=c.id then return jsonb_build_object('ok',true);end if;
  if p.technology_id is null and s.points<c.cost then raise exception 'You need % science points',c.cost;end if;
  perform public.peris_research_pause(u,now());
  if p.technology_id is null then update public.peris_account_science set points=points-c.cost where owner_id=u;insert into public.peris_research_progress(owner_id,technology_id)values(u,c.id);end if;
  update public.peris_account_science set active_id=c.id,active_since=now(),active_rate=public.peris_research_factor(u,'research_speed')where owner_id=u;
 else raise exception 'Unknown research command';end if;
 return jsonb_build_object('ok',true);
end $$;
-- Private worker deadlines and owner-filtered realtime invalidation.
create index if not exists peris_science_active on public.peris_account_science(active_since)where active_id is not null;

alter table public.battle_formations drop constraint if exists battle_formations_unit_attack_check;
alter table public.battle_formations add constraint battle_formations_unit_attack_check check(unit_attack between .4 and 20);
alter table public.battle_formations drop constraint if exists battle_formations_unit_defence_check;
alter table public.battle_formations add constraint battle_formations_unit_defence_check check(unit_defence between .5 and 20);

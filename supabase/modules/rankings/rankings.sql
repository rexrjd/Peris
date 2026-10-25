-- Weekly activity is measured at authoritative processing time, never game time.
create table if not exists public.peris_rankings_activation(
 id boolean primary key default true check(id),tracking_since timestamptz not null default clock_timestamp()
);
insert into public.peris_rankings_activation(id)values(true)on conflict do nothing;
create table if not exists public.peris_rankings_scores(
 week_start timestamptz not null,player_id uuid not null references public.players(id)on delete cascade,
 category text not null check(category in('attack','defense','robbers','camps','growth')),
 score numeric not null default 0,primary key(week_start,player_id,category)
);
-- Deliberately no battle FK: pruning battles/reports must not discard receipts.
create table if not exists public.peris_rankings_receipts(battle_id bigint primary key);
create table if not exists public.peris_rankings_defenders(
 battle_id bigint not null,player_id uuid not null references public.players(id)on delete cascade,
 weight numeric not null check(weight>0),primary key(battle_id,player_id)
);
create or replace function public.peris_rankings_now()returns timestamptz
language sql stable security definer set search_path='' as $$select statement_timestamp()$$;
create or replace function public.peris_rankings_week(p_at timestamptz)returns timestamptz
language sql immutable set search_path='' as $$select date_trunc('week',p_at at time zone 'UTC')at time zone 'UTC'$$;
create or replace function public.peris_rankings_weight(p_unit text)returns integer
language sql immutable set search_path='' as $$select case p_unit when 'cavalry'then 2 when 'heavyCavalry'then 2 when 'scout'then 2 when 'ram'then 3 when 'catapult'then 4 else 1 end$$;
create or replace function public.peris_rankings_add(p_player uuid,p_category text,p_score numeric)returns void
language plpgsql security definer set search_path='' as $$begin
 if p_player is null or p_score=0 or not exists(select 1 from public.players where id=p_player)then return;end if;
 insert into public.peris_rankings_scores(week_start,player_id,category,score)
 values(public.peris_rankings_week(public.peris_rankings_now()),p_player,p_category,p_score)
 on conflict(week_start,player_id,category)do update set score=peris_rankings_scores.score+excluded.score;
end $$;
create or replace function public.peris_rankings_capture(p_bid bigint)returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;party jsonb;owner uuid;weight numeric;
begin
 if exists(select 1 from public.peris_rankings_defenders where battle_id=p_bid)then return;end if;
 select * into b from public.battles where id=p_bid;
 if b.mode<>'pvp'or b.defender_owner_id is null then return;end if;
 if b.raid_city_id is null then
  insert into public.peris_rankings_defenders values(b.id,b.defender_owner_id,1)on conflict do nothing;return;
 end if;
 for party in select value from jsonb_array_elements(b.city_defenders)loop
  owner:=b.defender_owner_id;
  if party?'guild_reinforcement_id'then
   select r.owner_id into owner from public.peris_guild_reinforcements r where r.id=(party->>'guild_reinforcement_id')::bigint;
  end if;
  select coalesce(sum(greatest(0,value::numeric)*public.peris_rankings_weight(key)),0)into weight from jsonb_each_text(party->'troops');
  if owner is not null and weight>0 then
   insert into public.peris_rankings_defenders values(b.id,owner,weight)
   on conflict(battle_id,player_id)do update set weight=peris_rankings_defenders.weight+excluded.weight;
  end if;
 end loop;
 -- City magic can kill attackers without a troop garrison. Preserve the
 -- defending ruler as recipient when no proportional troop weights exist.
 if not exists(select 1 from public.peris_rankings_defenders where battle_id=b.id)then
  insert into public.peris_rankings_defenders values(b.id,b.defender_owner_id,1)on conflict do nothing;
 end if;
end $$;
create or replace function public.peris_rankings_battle()returns trigger
language plpgsql security definer set search_path='' as $$
declare attack_points numeric;defense_points numeric;loot numeric;participant record;
begin
 if tg_op='INSERT'then
  if new.status='active'then perform public.peris_rankings_capture(new.id);
  else insert into public.peris_rankings_receipts values(new.id)on conflict do nothing;end if;
  return new;
 end if;
 if old.status<>'active'or new.status<>'resolved'then return new;end if;
 insert into public.peris_rankings_receipts values(new.id)on conflict do nothing;
 if not found then return new;end if;
 if new.mode not in('pvp','pve')then return new;end if;
 select coalesce(sum(greatest(0,f.initial_soldiers-f.soldiers-f.starvation_losses)*public.peris_rankings_weight(coalesce(f.recruit_unit,f.unit_type)))filter(where f.side='defender'),0),
 coalesce(sum(greatest(0,f.initial_soldiers-f.soldiers-f.starvation_losses)*public.peris_rankings_weight(coalesce(f.recruit_unit,f.unit_type)))filter(where f.side='attacker'),0)
 into attack_points,defense_points from public.battle_formations f where f.battle_id=new.id;
 if new.mode='pve'and new.camp_id is not null then perform public.peris_rankings_add(new.attacker_owner_id,'camps',attack_points);
 elsif new.mode='pvp'and new.defender_owner_id is not null and new.attacker_owner_id<>new.defender_owner_id then
  perform public.peris_rankings_add(new.attacker_owner_id,'attack',attack_points);
  -- Largest remainders, deterministic player-ID ties; integer total conserved.
  for participant in
   with shares as(select player_id,defense_points*weight/sum(weight)over()as exact from public.peris_rankings_defenders where battle_id=new.id),
   rounded as(select player_id,floor(exact)as base,row_number()over(order by exact-floor(exact)desc,player_id)as priority,defense_points-sum(floor(exact))over()as extra from shares)
   select player_id,base+case when priority<=extra then 1 else 0 end as points from rounded
  loop perform public.peris_rankings_add(participant.player_id,'defense',participant.points);end loop;
 end if;
 if new.raid_city_id is not null or(new.mode='pve'and new.camp_id is not null)then
  select coalesce(sum(greatest(0,coalesce((new.result->'loot'->>k)::numeric,0))),0)into loot from unnest(array['wood','stone','food','gold'])k;
  perform public.peris_rankings_add(new.attacker_owner_id,'robbers',loot);
 end if;
 return new;
end $$;
create or replace function public.peris_rankings_population()returns trigger
language plpgsql security definer set search_path='' as $$begin
 if tg_op='INSERT'then
  -- Signup capitals are starting stock. Founded cities are earned population.
  if new.spawn_point_id is null and new.ruined_at is null then perform public.peris_rankings_add(new.owner_id,'growth',new.population);end if;
 elsif tg_op='DELETE'then
  if old.ruined_at is null then perform public.peris_rankings_add(old.owner_id,'growth',-old.population);end if;
 elsif old.owner_id is distinct from new.owner_id then
  if old.ruined_at is null then perform public.peris_rankings_add(old.owner_id,'growth',-old.population);end if;
  if new.ruined_at is null then perform public.peris_rankings_add(new.owner_id,'growth',new.population);end if;
 elsif old.ruined_at is distinct from new.ruined_at then
  perform public.peris_rankings_add(new.owner_id,'growth',case when new.ruined_at is null then new.population else -old.population end);
 elsif old.population_ready and new.population_ready and new.ruined_at is null then
  -- Legacy population initialization establishes a baseline, never a windfall.
  perform public.peris_rankings_add(new.owner_id,'growth',new.population-old.population);
 end if;
 return coalesce(new,old);
end $$;
-- Only active battles need attribution. Historical outcomes never become activity.
insert into public.peris_rankings_receipts select id from public.battles where status<>'active'on conflict do nothing;
do $$declare b record;begin for b in select id from public.battles where status='active'loop perform public.peris_rankings_capture(b.id);end loop;end $$;
drop trigger if exists peris_rankings_battle on public.battles;
create trigger peris_rankings_battle after insert or update of status on public.battles for each row execute function public.peris_rankings_battle();
drop trigger if exists peris_rankings_population on public.settlements;
create trigger peris_rankings_population after insert or delete or update of population,owner_id,ruined_at,population_ready on public.settlements for each row execute function public.peris_rankings_population();

create or replace function public.peris_rankings(p_period text default 'current')returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare owner uuid:=public.peris_player_id();at_time timestamptz:=public.peris_rankings_now();week timestamptz;category_name text;boards jsonb:='[]';entries jsonb;self_entry jsonb;players_count integer;
begin
 if auth.uid()is null or owner is null or not exists(select 1 from public.players where id=owner)then raise exception 'Authentication and player required';end if;
 if p_period is null or p_period not in('current','previous')then raise exception 'Invalid rankings period';end if;
 week:=public.peris_rankings_week(at_time)-case when p_period='previous'then interval '7 days'else interval '0 days'end;
 foreach category_name in array array['attack','defense','robbers','camps','growth']loop
  with positive as(select s.player_id,trunc(s.score)score from public.peris_rankings_scores s where s.week_start=week and s.category=category_name and trunc(s.score)>0),
  ranked as(select *,rank()over(order by score desc)as position from positive),
  top as(select * from ranked order by score desc,player_id limit 10)
  select coalesce(jsonb_agg(jsonb_build_object('rank',t.position,'player_id',t.player_id,'display_name',p.display_name,'guild_tag',g.tag,'score',t.score,'is_you',t.player_id=owner)order by t.score desc,t.player_id),'[]')into entries
  from top t join public.players p on p.id=t.player_id left join public.peris_guild_members m on m.player_id=p.id left join public.peris_guilds g on g.id=m.guild_id;
  select count(*)::integer into players_count from public.peris_rankings_scores s where s.week_start=week and s.category=category_name and trunc(s.score)>0;
  select jsonb_build_object('rank',case when coalesce(trunc(s.score),0)>0 then 1+(select count(*)from public.peris_rankings_scores other where other.week_start=week and other.category=category_name and trunc(other.score)>trunc(s.score))else null end,
   'player_id',p.id,'display_name',p.display_name,'guild_tag',g.tag,'score',coalesce(trunc(s.score),0),'is_you',true)into self_entry
  from public.players p left join public.peris_rankings_scores s on s.player_id=p.id and s.week_start=week and s.category=category_name
  left join public.peris_guild_members m on m.player_id=p.id left join public.peris_guilds g on g.id=m.guild_id where p.id=owner;
  boards:=boards||jsonb_build_array(jsonb_build_object('category',category_name,'entries',entries,'self',self_entry,'total_players',players_count));
 end loop;
 return jsonb_build_object('version',1,'period',p_period,'week_start',week,'week_end',week+interval '7 days','server_now',at_time,
 'tracking_since',(select tracking_since from public.peris_rankings_activation where id),'boards',boards);
end $$;
do $$declare t text;r record;begin
 foreach t in array array['peris_rankings_activation','peris_rankings_scores','peris_rankings_receipts','peris_rankings_defenders']loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
 for r in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'peris_rankings%'loop execute 'revoke all on function '||r.signature||' from public,anon,authenticated';end loop;
end $$;
grant execute on function public.peris_rankings(text)to authenticated;

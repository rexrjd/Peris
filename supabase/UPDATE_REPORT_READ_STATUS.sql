-- Existing name-only-account worlds; additive report read tracking only.
-- Apply with the report inbox frontend on a V17 world. No gameplay rules change.
begin;
-- One backend is one world. Operational/security/audit clocks remain real UTC.
create table if not exists public.peris_world_clock(
 id boolean primary key default true check(id),
 version integer not null default 1 check(version=1),
 rate integer not null default 1 check(rate in(1,10,100)),
 profile_id text not null default 'normal-v1' check(profile_id in('normal-v1','accelerated-test-v1')),
 real_anchor timestamptz not null,game_anchor timestamptz not null,
 check(profile_id<>'normal-v1'or rate=1)
);
insert into public.peris_world_clock(id,real_anchor,game_anchor)values(true,now(),now())on conflict(id)do nothing;
alter table public.peris_world_clock enable row level security;
revoke all on public.peris_world_clock from public,anon,authenticated;

create or replace function public.peris_game_now()returns timestamptz
language sql stable security definer set search_path='' as $$
 select game_anchor+(now()-real_anchor)*rate from public.peris_world_clock where id
$$;
create or replace function public.peris_clock_snapshot()returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',version,'rate',rate,'profile_id',profile_id,'real_now',now(),'game_now',public.peris_game_now())from public.peris_world_clock where id
$$;
-- Private operator setup, only before the first account in a disposable backend.
create or replace function public.peris_configure_test_clock(p_rate integer)returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_rate is null or p_rate not in(1,10,100)then raise exception 'Invalid test clock rate';end if;
 perform pg_advisory_xact_lock(204200);
 if exists(select 1 from public.players)then raise exception 'Test clock configuration requires an empty world';end if;
 update public.peris_world_clock set rate=p_rate,profile_id='accelerated-test-v1',real_anchor=now(),game_anchor=now()where id;
end $$;
revoke all on function public.peris_game_now(),public.peris_clock_snapshot(),public.peris_configure_test_clock(integer)from public,anon,authenticated;
-- Core tables exist before this module, including on legacy upgrades.
-- Defaults affect new rows only; accepted dates and balances are untouched.
alter table public.armies alter column departure_at set default public.peris_game_now();
alter table public.armies alter column arrival_at set default public.peris_game_now();
alter table public.battles alter column started_at set default public.peris_game_now();
alter table public.battles alter column last_tick_at set default public.peris_game_now();
alter table public.settlements alter column resources_updated_at set default public.peris_game_now();
alter table public.peris_challenges alter column expires_at set default public.peris_game_now()+interval '90 seconds';

-- Additive read receipts belong to the ruler, including recovered name-only sessions.
alter table public.peris_reports add column if not exists read_at timestamptz;
create or replace function public.peris_read_reports(p_report_ids bigint[])returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if auth.uid() is null or u is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_report_ids is null or cardinality(p_report_ids)<1 or cardinality(p_report_ids)>50 or array_position(p_report_ids,null)is not null then
  raise exception 'Choose valid reports' using errcode='22023';end if;
 if exists(select 1 from unnest(p_report_ids)as requested(report_id) where requested.report_id<=0 or not exists(select 1 from public.peris_reports r where r.id=requested.report_id and r.owner_id=u))then
  raise exception 'These reports are not available to this ruler' using errcode='42501';end if;
 update public.peris_reports set read_at=now() where owner_id=u and id=any(p_report_ids) and read_at is null;
end $$;
revoke all on function public.peris_read_reports(bigint[]) from public,anon;
grant execute on function public.peris_read_reports(bigint[]) to authenticated;

-- Bulk reads include historical receipts beyond the bounded snapshot page.
create or replace function public.peris_read_all_reports()returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if auth.uid() is null or u is null then raise exception 'Authentication required' using errcode='42501';end if;
 update public.peris_reports set read_at=now() where owner_id=u and read_at is null;
end $$;
revoke all on function public.peris_read_all_reports() from public,anon;
grant execute on function public.peris_read_all_reports() to authenticated;

create or replace function public.peris_report_page(p_before_id bigint default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if auth.uid() is null or u is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_before_id is not null and p_before_id<=0 then raise exception 'Choose a valid report page' using errcode='22023';end if;
 return coalesce((select jsonb_agg(r order by r.id desc)from(
  select * from public.peris_reports r where r.owner_id=u and (p_before_id is null or r.id<p_before_id)
   and (coalesce((r.result->>'attacker_losses')::integer,0)>0 or not exists(select 1 from public.peris_campaign_farm_lists l where l.id=r.farm_list_id and l.owner_id=u and l.casualties_only))
  order by r.id desc limit 50
 )r),'[]'::jsonb);
end $$;
revoke all on function public.peris_report_page(bigint) from public,anon;
grant execute on function public.peris_report_page(bigint) to authenticated;

create or replace function public.peris_snapshot()returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_note_account_activity();
 perform public.peris_science_ensure(u);
 perform public.peris_city_migrate(s.id) from public.settlements s where s.owner_id=u;
 select jsonb_build_object('version',6,'server_now',public.peris_game_now(),'game_clock',public.peris_clock_snapshot(),
 'debug_enabled',coalesce((select enabled from public.peris_debug_config where id),false),
 'map',jsonb_build_object('version',4,'cols',200,'rows',200,'cell_size',128,'seed',1346720329,
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements)),
 'gameplay_version',1,'unit_balance_version',2,
 'account_science',coalesce((select jsonb_agg(s)from public.peris_account_science s where s.owner_id=u),'[]'::jsonb),
 'research_progress',coalesce((select jsonb_agg(p order by technology_id)from public.peris_research_progress p where p.owner_id=u),'[]'::jsonb),
 'heroes',coalesce((select jsonb_agg(h order by id)from public.peris_heroes h where owner_id=u),'[]'::jsonb),
 'hero_artifacts',coalesce((select jsonb_agg(i order by id)from public.peris_hero_artifacts i where owner_id=u),'[]'::jsonb),
 'settler_expeditions',coalesce((select jsonb_agg(e order by id)from public.peris_settler_expeditions e where owner_id=u),'[]'::jsonb),
 'campaign_farm_lists',coalesce((select jsonb_agg(l order by id)from public.peris_campaign_farm_lists l where owner_id=u),'[]'::jsonb),
 'campaign_farms',coalesce((select jsonb_agg(f order by id)from public.peris_campaign_farms f where owner_id=u),'[]'::jsonb),
 'campaign_farm_stats',coalesce((select jsonb_agg(jsonb_build_object('owner_id',u,'camp_id',s.camp_id,'raids',s.raids,'last_raid_at',coalesce(s.result->>'delivered_at',s.created_at::text),'last_loot',s.delivered,'total_loot',s.total_loot,'last_result',coalesce(s.winner_side,case when s.won then 'attacker'else 'defender'end),'last_losses',coalesce((s.result->>'attacker_losses')::integer,0))order by s.camp_id)from(
   select r.*,b.winner_side,coalesce((r.result#>>'{delivered,wood}')::numeric,0)+coalesce((r.result#>>'{delivered,stone}')::numeric,0)+coalesce((r.result#>>'{delivered,food}')::numeric,0)+coalesce((r.result#>>'{delivered,gold}')::numeric,0)as delivered,
    count(*)over(partition by r.camp_id)as raids,
    sum(coalesce((r.result#>>'{delivered,wood}')::numeric,0)+coalesce((r.result#>>'{delivered,stone}')::numeric,0)+coalesce((r.result#>>'{delivered,food}')::numeric,0)+coalesce((r.result#>>'{delivered,gold}')::numeric,0))over(partition by r.camp_id)as total_loot,
    row_number()over(partition by r.camp_id order by coalesce((r.result->>'delivered_at')::timestamptz,r.created_at)desc,r.id desc)as rank
   from public.peris_reports r join public.peris_camps c on c.id=r.camp_id and c.bandit left join public.battles b on b.id=r.battle_id where r.owner_id=u and r.result?'delivered'
  )s where s.rank=1),'[]'::jsonb),
 'garrisons',coalesce((select jsonb_agg(g order by row,col)from public.peris_garrisons g where owner_id=u),'[]'::jsonb),
 'city_garrisons',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('infantry',public.peris_roster_class(g.unit_roster,'infantry'),'archers',public.peris_roster_class(g.unit_roster,'archers'),'cavalry',public.peris_roster_class(g.unit_roster,'cavalry'))order by g.settlement_id)from public.peris_city_garrisons g where g.owner_id=u),'[]'::jsonb),
 'ruin_evacuations',coalesce((select jsonb_agg(e order by e.arrival_at)from public.peris_ruin_evacuations e where e.owner_id=u),'[]'::jsonb),
 'players',coalesce((select jsonb_agg(p order by created_at)from public.players p where p.id=u
   or exists(select 1 from public.battles b where (b.attacker_owner_id=u or b.defender_owner_id=u) and (b.attacker_owner_id=p.id or b.defender_owner_id=p.id))
   or exists(select 1 from public.peris_challenges c where c.status='pending' and c.expires_at>public.peris_game_now() and (c.attacker_owner_id=u or c.defender_owner_id=u) and (c.attacker_owner_id=p.id or c.defender_owner_id=p.id))),'[]'::jsonb),
 'settlements',coalesce((select jsonb_agg(s order by id)from public.settlements s where s.owner_id=u),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(b order by b.id)from public.buildings b join public.settlements s on s.id=b.settlement_id where s.owner_id=u),'[]'::jsonb),
 'unit_research',coalesce((select jsonb_agg(r order by r.unit)from public.peris_unit_research r join public.settlements s on s.id=r.settlement_id where s.owner_id=u),'[]'::jsonb),
 'spell_research',coalesce((select jsonb_agg(r order by r.spell_id)from public.peris_spell_research r join public.settlements s on s.id=r.settlement_id where s.owner_id=u),'[]'::jsonb),
 'city_slots',coalesce((select jsonb_agg(c order by c.slot_index)from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=u),'[]'::jsonb),
 'map_plots',coalesce((select jsonb_agg(p order by p.row,p.col)from public.peris_map_plots p where p.owner_id=u),'[]'::jsonb),
 'armies',coalesce((select jsonb_agg(a order by id)from public.armies a where a.owner_id=u),'[]'::jsonb),
 'camps',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('resources',stock.resources,'stock_updated_at',stock.stock_updated_at)order by c.id)from public.peris_camps c left join public.peris_camp_stock stock on stock.camp_id=c.id),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(o order by finish_at)from public.peris_orders o where owner_id=u),'[]'::jsonb),
 'battles',coalesce((select jsonb_agg(b order by id)from public.battles b where attacker_owner_id=u or defender_owner_id=u),'[]'::jsonb),
 'formations',coalesce((select jsonb_agg(f order by f.id)from public.battle_formations f join public.battles b on b.id=f.battle_id where b.status='active'and (b.attacker_owner_id=u or b.defender_owner_id=u)),'[]'::jsonb),
 'reports',coalesce((select jsonb_agg(r order by id desc)from (select * from public.peris_reports where owner_id=u and (coalesce((peris_reports.result->>'attacker_losses')::integer,0)>0 or not exists(select 1 from public.peris_campaign_farm_lists l where l.id=peris_reports.farm_list_id and l.owner_id=u and l.casualties_only)) order by id desc limit 50)r),'[]'::jsonb),
 'report_count',(select count(*)from public.peris_reports r where owner_id=u and (coalesce((r.result->>'attacker_losses')::integer,0)>0 or not exists(select 1 from public.peris_campaign_farm_lists l where l.id=r.farm_list_id and l.owner_id=u and l.casualties_only))),
 'hidden_report_count',(select count(*)from public.peris_reports r where owner_id=u and coalesce((r.result->>'attacker_losses')::integer,0)=0 and exists(select 1 from public.peris_campaign_farm_lists l where l.id=r.farm_list_id and l.owner_id=u and l.casualties_only)),
 'unread_report_count',(select count(*)from public.peris_reports r where owner_id=u and r.read_at is null and (coalesce((r.result->>'attacker_losses')::integer,0)>0 or not exists(select 1 from public.peris_campaign_farm_lists l where l.id=r.farm_list_id and l.owner_id=u and l.casualties_only))),
 'progress',coalesce((select jsonb_agg(p)from public.peris_progress p where owner_id=u),'[]'::jsonb),
 'claims',coalesce((select jsonb_agg(c)from public.peris_claims c where owner_id=u),'[]'::jsonb),
 'challenges',coalesce((select jsonb_agg(c)from public.peris_challenges c where (attacker_owner_id=u or defender_owner_id=u)and status='pending'and expires_at>public.peris_game_now()),'[]'::jsonb))into result;
 return result;
end $$;


notify pgrst,'reload schema';
commit;

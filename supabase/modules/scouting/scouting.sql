-- Separate private scout detachments. Resolved battle rows are report receipts only.
create table if not exists public.peris_scout_missions(
 id bigint generated always as identity primary key,
 owner_id uuid not null references public.players(id)on delete cascade,
 source_settlement_id bigint not null references public.settlements(id),source_army_id bigint not null references public.armies(id),
 target_city_id bigint references public.settlements(id),target_camp_id integer references public.peris_camps(id),target_owner_id uuid references public.players(id),
 target_name text not null,faction text not null,mode text not null check(mode in('resources','defences')),
 initial_scouts integer not null check(initial_scouts between 1 and 1000),scouts integer not null check(scouts between 0 and 1000),
 status text not null default 'outbound'check(status in('outbound','returning','completed','cancelled')),
 origin_x integer not null,origin_y integer not null,target_x integer not null,target_y integer not null,
 sent_at timestamptz not null,departure_at timestamptz not null,arrival_at timestamptz not null,cancel_until timestamptz not null,
 march_path jsonb not null,march_distance numeric not null,report_battle_id bigint references public.battles(id),
 check((target_city_id is null)<>(target_camp_id is null)),check(scouts<=initial_scouts),check(arrival_at>=departure_at)
);
alter table public.battles drop constraint if exists peris_scout_receipt_only;
alter table public.battles add constraint peris_scout_receipt_only check(mode<>'scouting'or(status='resolved'and defender_owner_id is null and defender_army_id is null));
create index if not exists peris_scout_due on public.peris_scout_missions(owner_id,arrival_at)where status in('outbound','returning');
create index if not exists peris_scout_inbound on public.peris_scout_missions(target_owner_id,arrival_at)where status='outbound';
alter table public.peris_scout_missions enable row level security;
revoke all on public.peris_scout_missions from public,anon,authenticated;
grant select on public.peris_scout_missions to authenticated;
drop policy if exists "own scout missions"on public.peris_scout_missions;
create policy "own scout missions"on public.peris_scout_missions for select to authenticated using(owner_id=public.peris_player_id());

create or replace function public.peris_scout_speed(p_owner uuid)returns numeric
language sql stable security definer set search_path='' as $$select 22.0*speed/40*public.peris_research_factor(p_owner,'march')from public.peris_unit_catalog where unit='scout'$$;
create or replace function public.peris_scout_smithy(p_city bigint,p_owner uuid)returns numeric
language sql stable security definer set search_path='' as $$select 1+.04*coalesce(sum(c.level),0)from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.id=p_city and s.owner_id=p_owner and s.ruined_at is null and c.building_type='smithy'$$;

-- Return credits use the same authoritative city ownership and legion capacity checks.
create or replace function public.peris_scout_deliver(p_id bigint,p_city bigint)returns void
language plpgsql security definer set search_path='' as $$
declare m public.peris_scout_missions%rowtype;a public.armies%rowtype;s public.settlements%rowtype;room integer;merged integer:=0;pos jsonb;home jsonb;
begin
 select * into m from public.peris_scout_missions where id=p_id for update;
 select * into s from public.settlements where id=p_city and owner_id=m.owner_id and ruined_at is null for update;
 if s.id is null or m.scouts=0 then return;end if;
 select * into a from public.armies where id=m.source_army_id and owner_id=m.owner_id for update;
 pos:=public.peris_army_position(a);home:=public.peris_home_army_position(s.x,s.y);
 if floor((pos->>'x')::numeric/128)=floor(s.x/128.0)and floor((pos->>'y')::numeric/128)=floor(s.y/128.0)and a.status='idle'and a.raid_city_id is null and a.raid_target_id is null and a.raid_reserve is null and sqrt(power(public.peris_wrapped_delta((pos->>'x')::numeric,(home->>'x')::numeric),2)+power(public.peris_wrapped_delta((pos->>'y')::numeric,(home->>'y')::numeric),2))<=90 then
  room:=greatest(0,1000-public.peris_roster_total(public.peris_roster(to_jsonb(a)))-coalesce((select sum(quantity)::integer from public.peris_orders where army_id=a.id and kind='recruit'and recruit_destination='legion'),0));
  merged:=least(room,m.scouts);
  if merged>0 then perform public.peris_write_roster(a.id,public.peris_roster_add(public.peris_roster(to_jsonb(a)),jsonb_build_object('scout',merged)));end if;
 end if;
 if m.scouts>merged then perform public.peris_city_garrison_receive(m.owner_id,s.id,jsonb_build_object('scout',m.scouts-merged));end if;
 update public.peris_scout_missions set scouts=0 where id=m.id;
end $$;

-- Count only pools physically present at the observation deadline. Guild pools keep their own upgrades.
create or replace function public.peris_scout_defenders(p_city bigint,p_at timestamptz)returns table(owner_id uuid,smithy_city bigint,troops jsonb)
language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare s public.settlements%rowtype;r record;position jsonb;
begin
 select * into s from public.settlements where id=p_city and ruined_at is null;if s.id is null then return;end if;
 for r in select * from public.armies a where a.owner_id=s.owner_id and(a.status='idle'or a.status='moving'and a.departure_at>p_at)loop
  position:=case when r.status='moving'then jsonb_build_object('x',r.start_x,'y',r.start_y)else jsonb_build_object('x',r.target_x,'y',r.target_y)end;
  if floor((position->>'x')::numeric/128)=floor(s.x/128.0)and floor((position->>'y')::numeric/128)=floor(s.y/128.0)then owner_id:=s.owner_id;smithy_city:=s.id;troops:=public.peris_roster(to_jsonb(r));return next;end if;
 end loop;
 for r in select * from public.peris_optional_scout_missions()m where m.owner_id=s.owner_id and m.source_settlement_id=s.id and m.status='outbound'and m.departure_at>p_at loop owner_id:=s.owner_id;smithy_city:=s.id;troops:=public.peris_roster(jsonb_build_object('scout',r.scouts));return next;end loop;
 for r in select * from public.peris_city_garrisons g where g.settlement_id=s.id and g.owner_id=s.owner_id loop owner_id:=s.owner_id;smithy_city:=s.id;troops:=public.peris_roster(r.unit_roster);return next;end loop;
 for r in select * from public.peris_garrisons g where g.owner_id=s.owner_id and g.col=floor(s.x/128.0)and g.row=floor(s.y/128.0)loop owner_id:=s.owner_id;smithy_city:=s.id;troops:=public.peris_roster(to_jsonb(r));return next;end loop;
 for r in select * from public.peris_guild_reinforcements g where g.status='stationed'and g.target_settlement_id=s.id and g.recipient_id=s.owner_id and exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=g.owner_id and b.player_id=g.recipient_id)loop owner_id:=r.owner_id;smithy_city:=r.source_settlement_id;troops:=public.peris_roster(r.troops);return next;end loop;
end $$;

create or replace function public.peris_scout_event(p_id bigint,p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare m public.peris_scout_missions%rowtype;s public.settlements%rowtype;c public.peris_camps%rowtype;r record;bag jsonb;troops jsonb:=public.peris_roster('{}');
 info jsonb;receipt jsonb;notice jsonb;target jsonb;bid bigint;route jsonb;path jsonb;city bigint;wall integer:=0;main integer:=0;attack numeric;defence numeric:=0;killed integer:=0;survivors integer;reason text;success boolean:=false;pace numeric;distance numeric;tx integer;ty integer;
begin
 select * into m from public.peris_scout_missions where id=p_id for update;
 if m.id is null or m.status not in('outbound','returning')or m.arrival_at>p_at then return;end if;
 if exists(select 1 from public.players where id=m.owner_id and defeated_at is not null)or not exists(select 1 from public.settlements where owner_id=m.owner_id and ruined_at is null)then update public.peris_scout_missions set scouts=0,status='completed'where id=m.id;return;end if;
 if m.status='returning'then
  select id into city from public.settlements where owner_id=m.owner_id and ruined_at is null and floor(x/128.0)=floor(m.target_x/128.0)and floor(y/128.0)=floor(m.target_y/128.0)order by id limit 1;
  if city is not null then perform public.peris_scout_deliver(m.id,city);update public.peris_scout_missions set status='completed'where id=m.id;return;end if;
 else
  target:=jsonb_build_object('kind',case when m.target_city_id is null then 'camp'else 'city'end,'id',coalesce(m.target_city_id,m.target_camp_id),'name',m.target_name,'owner_id',m.target_owner_id,'faction',coalesce((select faction from public.settlements where id=m.target_city_id),(select faction from public.peris_camps where id=m.target_camp_id),'orc'),'x',m.target_x,'y',m.target_y);
  if m.scouts=0 then reason:='no_surviving_scouts';
  elsif m.target_city_id is not null then
   select * into s from public.settlements where id=m.target_city_id;
   if s.id is null or s.ruined_at is not null then reason:='invalid_target';elsif s.owner_id is distinct from m.target_owner_id then reason:='ownership_changed';
   else
    select coalesce(level,0)into wall from public.buildings where settlement_id=s.id and building_type='wall';wall:=coalesce(wall,0);
    select coalesce(level,0)into main from public.buildings where settlement_id=s.id and building_type='market';main:=coalesce(main,0);
    for r in select * from public.peris_scout_defenders(s.id,m.arrival_at)loop
     troops:=public.peris_roster_add(troops,r.troops);
     defence:=defence+coalesce((r.troops->>'scout')::integer,0)*20*public.peris_scout_smithy(r.smithy_city,r.owner_id)*public.peris_research_factor(r.owner_id,'defence');
    end loop;
    defence:=defence*(1+public.peris_wall_defence_bonus(wall));bag:=jsonb_build_object('wood',s.wood,'stone',s.stone,'food',s.food,'gold',s.gold);
   end if;
  else
   perform public.peris_camp_accrue(m.target_camp_id,m.arrival_at);select * into c from public.peris_camps where id=m.target_camp_id;
   if c.id is null then reason:='invalid_target';else troops:=public.peris_roster(jsonb_build_object('infantry',c.infantry,'archers',c.archers,'cavalry',c.cavalry));select resources into bag from public.peris_camp_stock where camp_id=c.id;bag:=coalesce(bag,jsonb_build_object('wood',0,'stone',0,'food',0,'gold',0));end if;
  end if;
  if reason is null then
   city:=coalesce((select id from public.settlements where id=m.source_settlement_id and owner_id=m.owner_id and ruined_at is null),(select min(id)from public.settlements where owner_id=m.owner_id and ruined_at is null));
   attack:=m.scouts*35*public.peris_scout_smithy(city,m.owner_id)*public.peris_research_factor(m.owner_id,'attack');
   killed:=case when defence=0 then 0 else least(m.scouts,round(m.scouts*power(defence/greatest(attack,.000001),1.5))::integer)end;
  end if;
  if killed>0 then update public.settlements set food=least(food_capacity,food+killed*coalesce((select(rule#>>'{cost,food}')::numeric from public.peris_unit_balance where version=2 and unit='scout'),0))where id=city and owner_id=m.owner_id and ruined_at is null;end if;
  survivors:=m.scouts-killed;success:=reason is null and survivors>0;if reason is null and not success then reason:='all_scouts_lost';end if;
  info:=jsonb_build_object('mission_id',m.id,'mode',m.mode,'target',target,'observed_at',m.arrival_at,'scouts_sent',m.initial_scouts,'scouts_lost',m.initial_scouts-survivors,'scouts_survived',survivors,'detected',killed>0,'success',success);
  if reason is not null then info:=info||jsonb_build_object('reason',reason);end if;
  if success then info:=info||jsonb_build_object('troops',troops);if m.mode='resources'then info:=info||jsonb_build_object('resources',bag);else info:=info||jsonb_build_object('defences',jsonb_build_object('wall',wall,'main',main));end if;end if;
  receipt:=jsonb_build_object('report_side','attacker','balance_version',2,'attacker_initial',m.initial_scouts,'attacker_survivors',survivors,'attacker_losses',m.initial_scouts-survivors,'defender_initial',0,'defender_survivors',0,'defender_losses',0,'loot',jsonb_build_object('wood',0,'stone',0,'food',0,'gold',0),'duration',0,'reason','Scouting','scouting',info);
  insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,status,mode,phase,enemy_name,started_at,ended_at,winner_side,result,food_settled)
   values(m.owner_id,null,m.source_army_id,null,'resolved','scouting','combat',m.target_name,m.arrival_at,m.arrival_at,case when success then 'attacker'else 'defender'end,receipt,true)returning id into bid;
  insert into public.peris_reports(owner_id,battle_id,title,won,result,created_at)values(m.owner_id,bid,'Scouting: '||m.target_name,success,receipt,m.arrival_at)on conflict do nothing;
  if killed>0 and m.target_owner_id is not null then
   notice:=receipt||jsonb_build_object('report_side','defender','attacker_initial',killed,'attacker_survivors',0,'attacker_losses',killed,'scouting',(info-'troops'-'resources'-'defences'-'reason')||jsonb_build_object('scouts_sent',killed,'scouts_lost',killed,'scouts_survived',0,'success',false,'reason','Enemy scouts intercepted.','sender_name',(select display_name from public.players where id=m.owner_id)));
   insert into public.peris_reports(owner_id,battle_id,title,won,result,created_at)values(m.target_owner_id,bid,'Scouts detected: '||m.target_name,true,notice,m.arrival_at)on conflict do nothing;
  end if;
  update public.peris_scout_missions set scouts=survivors,report_battle_id=bid where id=m.id;
  if survivors=0 then update public.peris_scout_missions set status='completed'where id=m.id;return;end if;
  if exists(select 1 from public.settlements where id=m.source_settlement_id and owner_id=m.owner_id and ruined_at is null)then
   select jsonb_agg(value order by ord desc)into path from jsonb_array_elements(m.march_path)with ordinality p(value,ord);
   tx:=m.origin_x;ty:=m.origin_y;distance:=m.march_distance;
  end if;
 end if;
 if path is null then
  route:=public.peris_ruin_route(m.owner_id,m.target_x,m.target_y);
  if route is null then update public.peris_scout_missions set scouts=0,status='completed'where id=m.id;return;end if;
  path:=route->'path';tx:=(route->>'x')::integer;ty:=(route->>'y')::integer;distance:=(route->>'distance')::numeric;
 end if;
 update public.peris_scout_missions set status='returning',march_path=path,march_distance=distance,target_x=tx,target_y=ty,departure_at=m.arrival_at,arrival_at=m.arrival_at+make_interval(secs=>greatest(2,distance/public.peris_scout_speed(m.owner_id))::double precision)where id=m.id;
end $$;

create or replace function public.peris_scout_advance(p_owners uuid[],p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare m record;
begin
 for m in select id from public.peris_scout_missions where owner_id=any(p_owners)and status in('outbound','returning')and arrival_at<=p_at order by arrival_at,case when status='returning'then 0 else 1 end,id for update loop perform public.peris_scout_event(m.id,p_at);end loop;
end $$;

create or replace function public.peris_scout_command_for(p_owner uuid,p_command jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;a public.armies%rowtype;s public.settlements%rowtype;t public.settlements%rowtype;c public.peris_camps%rowtype;m public.peris_scout_missions%rowtype;
 position jsonb;home jsonb;path jsonb;distance numeric;new_id bigint;quantity integer;target_x integer;target_y integer;target_name text;faction text;target_owner uuid;sent timestamptz;staging numeric;participants uuid[];steps integer;i integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if to_regclass('public.peris_crop_version')is null or to_regclass('public.peris_conquest_version')is null then raise exception 'Scouting is unavailable until the current crop and capture updates are installed';end if;
 if exists(select 1 from public.players where id=u and defeated_at is not null)then raise exception 'This ruler has been permanently defeated';end if;
 if p_command is null or jsonb_typeof(p_command)<>'object'then raise exception 'Choose a scouting order';end if;
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available;end if;
 if p_command->>'type'='cancelScouting'then
  perform public.peris_settle(u);
  select * into m from public.peris_scout_missions where id=(p_command->>'missionId')::bigint and owner_id=u for update;
  if m.id is null or m.sent_at is distinct from(p_command->>'sentAt')::timestamptz then raise exception 'This scouting mission is no longer the same order';end if;
  if m.status='cancelled'then return jsonb_build_object('ok',true);end if;
  if m.status<>'outbound'or public.peris_game_now()>=m.cancel_until or public.peris_game_now()<m.sent_at then raise exception 'Scouting can only be cancelled during the first 30 seconds';end if;
  if not exists(select 1 from public.settlements where id=m.source_settlement_id and owner_id=u and ruined_at is null)then raise exception 'The source city is no longer yours';end if;
  perform public.peris_scout_deliver(m.id,m.source_settlement_id);update public.peris_scout_missions set status='cancelled'where id=m.id;
  return jsonb_build_object('ok',true);
 elsif p_command->>'type'<>'scout'then raise exception 'Choose a scouting order';end if;
 if jsonb_typeof(p_command->'quantity')<>'number'or(p_command->>'quantity')::numeric<>trunc((p_command->>'quantity')::numeric)or(p_command->>'quantity')::numeric not between 1 and 1000 or p_command->>'mode'not in('resources','defences')then raise exception 'Choose 1-1000 scouts and an intelligence mode';end if;
 quantity:=(p_command->>'quantity')::integer;
 if(select count(*)from public.peris_scout_missions where owner_id=u and status in('outbound','returning'))>=100 then raise exception 'At most 100 active scouting missions are allowed';end if;
 if(p_command->>'targetCityId'is null)=(p_command->>'campId'is null)then raise exception 'Choose one scouting target';end if;
 if p_command->>'targetCityId'is not null then
  select * into t from public.settlements where id=(p_command->>'targetCityId')::bigint and ruined_at is null and owner_id<>u;
  if t.id is null then raise exception 'Choose a foreign living city';end if;
  target_x:=t.x;target_y:=t.y;target_name:=t.name;target_owner:=t.owner_id;faction:=t.faction;
 else
  select * into c from public.peris_camps where id=(p_command->>'campId')::integer;
  if c.id is null then raise exception 'Choose a camp';end if;
  target_x:=c.x;target_y:=c.y;target_name:=c.name;faction:='orc';
 end if;
 -- Lock both existing connected components before adding their new private edge.
 select array_agg(distinct id order by id)into participants from unnest(public.peris_trade_participants(u)||coalesce(public.peris_trade_participants(target_owner),array[]::uuid[]))id where id is not null;
 perform 1 from public.players where id=any(participants)order by id for update nowait;
 perform public.peris_settle(u);if target_owner is not null then perform public.peris_settle(target_owner);end if;
 select * into a from public.armies where id=(p_command->>'armyId')::bigint and owner_id=u for update;
 if a.id is null or a.status<>'idle'or a.raid_target_id is not null or a.raid_city_id is not null or a.raid_reserve is not null or exists(select 1 from public.battles where status='active'and(attacker_army_id=a.id or defender_army_id=a.id))then raise exception 'Choose an idle legion';end if;
 if exists(select 1 from public.peris_orders where army_id=a.id and kind='recruit'and recruit_destination='legion')then raise exception 'Finish training before sending scouts';end if;
 position:=public.peris_army_position(a);
 select city.* into s from public.settlements city cross join lateral(select public.peris_home_army_position(city.x,city.y)pos)q where city.owner_id=u and city.ruined_at is null and floor((position->>'x')::numeric/128)=floor(city.x/128.0)and floor((position->>'y')::numeric/128)=floor(city.y/128.0)and sqrt(power(public.peris_wrapped_delta((position->>'x')::numeric,(q.pos->>'x')::numeric),2)+power(public.peris_wrapped_delta((position->>'y')::numeric,(q.pos->>'y')::numeric),2))<=90 order by city.id limit 1 for update of city;
 if s.id is null then raise exception 'Depart from one of your living cities';end if;
 if coalesce((public.peris_roster(to_jsonb(a))->>'scout')::integer,0)<quantity then raise exception 'Choose available scouts from this legion';end if;
 if t.id is not null and not exists(select 1 from public.settlements where id=t.id and owner_id=target_owner and ruined_at is null)then raise exception 'Target ownership changed';end if;
 path:=nullif(p_command->'route','null'::jsonb);
 if path is null then
  steps:=greatest(1,ceil(greatest(abs(public.peris_wrapped_delta((position->>'x')::numeric,target_x)),abs(public.peris_wrapped_delta((position->>'y')::numeric,target_y)))/64)::integer);
  path:=jsonb_build_array(jsonb_build_array((position->>'x')::numeric,(position->>'y')::numeric));
  for i in 1..steps loop path:=path||jsonb_build_array(jsonb_build_array(public.peris_wrap_world(round((position->>'x')::numeric+public.peris_wrapped_delta((position->>'x')::numeric,target_x)*i/steps)::integer),public.peris_wrap_world(round((position->>'y')::numeric+public.peris_wrapped_delta((position->>'y')::numeric,target_y)*i/steps)::integer)));end loop;
 end if;
 distance:=public.peris_route_distance((position->>'x')::numeric,(position->>'y')::numeric,target_x,target_y,path);
 sent:=public.peris_game_now();select 30*rate into staging from public.peris_world_clock where id;
 perform public.peris_write_roster(a.id,public.peris_roster_add(public.peris_roster(to_jsonb(a)),jsonb_build_object('scout',quantity),-1));
 insert into public.peris_scout_missions(owner_id,source_settlement_id,source_army_id,target_city_id,target_camp_id,target_owner_id,target_name,faction,mode,initial_scouts,scouts,origin_x,origin_y,target_x,target_y,sent_at,departure_at,arrival_at,cancel_until,march_path,march_distance)
 values(u,s.id,a.id,t.id,c.id,target_owner,target_name,s.faction,p_command->>'mode',quantity,quantity,(position->>'x')::integer,(position->>'y')::integer,target_x,target_y,sent,sent+make_interval(secs=>staging::double precision),sent+make_interval(secs=>(staging+greatest(2,distance/public.peris_scout_speed(u)))::double precision),sent+make_interval(secs=>staging::double precision),path,distance)returning id into new_id;
 delete from public.peris_scout_missions old where old.owner_id=u and old.status in('completed','cancelled')and old.id not in(select id from public.peris_scout_missions where owner_id=u and status in('completed','cancelled')order by id desc limit 200);
 perform public.peris_supply_refresh(s.id,sent);
 return jsonb_build_object('ok',true,'mission_id',new_id);
end $$;

create or replace function public.peris_scout_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
begin return public.peris_scout_command_for(public.peris_player_id(),p_command);end $$;
revoke all on function public.peris_scout_command_for(uuid,jsonb)from public,anon,authenticated;

create or replace function public.peris_scout_defeat()returns trigger language plpgsql security definer set search_path='' as $$
begin if new.defeated_at is not null then update public.peris_scout_missions set scouts=0,status='completed'where owner_id=new.id and status in('outbound','returning');end if;return new;end $$;
drop trigger if exists peris_scout_defeat on public.players;
create trigger peris_scout_defeat after update of defeated_at on public.players for each row execute function public.peris_scout_defeat();
revoke all on function public.peris_scout_speed(uuid),public.peris_scout_smithy(bigint,uuid),public.peris_scout_deliver(bigint,bigint),public.peris_scout_defenders(bigint,timestamptz),public.peris_scout_event(bigint,timestamptz),public.peris_scout_advance(uuid[],timestamptz),public.peris_scout_command(jsonb),public.peris_scout_defeat()from public,anon,authenticated;
grant execute on function public.peris_scout_command(jsonb)to authenticated;

create or replace function public.peris_scout_no_formations()returns trigger language plpgsql security definer set search_path='' as $$
begin if exists(select 1 from public.battles where id=new.battle_id and mode='scouting')then raise exception 'Scouting receipts cannot have combat formations';end if;return new;end $$;
drop trigger if exists peris_scout_no_formations on public.battle_formations;
create trigger peris_scout_no_formations before insert or update of battle_id on public.battle_formations for each row execute function public.peris_scout_no_formations();
revoke all on function public.peris_scout_no_formations()from public,anon,authenticated;

-- Camp starts/finalizers also preserve earlier scout deadlines when called without march intent.
create or replace function public.peris_scout_flush_camp(p_camp integer,p_at timestamptz,p_owner uuid)returns void
language plpgsql security definer set search_path='' as $$
declare participants uuid[];participant uuid;
begin
 if not exists(select 1 from public.peris_scout_missions where target_camp_id=p_camp and status='outbound'and arrival_at<=p_at)then return;end if;
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available;end if;
 select array_agg(distinct id order by id)into participants from(
  select p_owner owner_id union select owner_id from public.peris_scout_missions where target_camp_id=p_camp and status='outbound'
 )owners cross join lateral unnest(public.peris_trade_participants(owners.owner_id))id;
 perform 1 from public.players where id=any(participants)order by id for update nowait;
 foreach participant in array participants loop perform public.peris_settle(participant,p_at);end loop;
end $$;
revoke all on function public.peris_scout_flush_camp(integer,timestamptz,uuid)from public,anon,authenticated;

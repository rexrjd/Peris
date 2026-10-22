-- Camp stock and private random recruitment belong to the existing Peris world.
create table if not exists public.peris_camp_stock (
 camp_id integer primary key references public.peris_camps(id) on delete cascade,
 resources jsonb not null default '{"wood":0,"stone":0,"food":0,"gold":0}',
 stock_updated_at timestamptz not null default public.peris_game_now(),
 next_recruit_at timestamptz not null default public.peris_game_now()+interval '1 minute',
 recruit_sequence bigint not null default 0, engaged_battle_id bigint
);
revoke all on public.peris_camp_stock from public,anon,authenticated;
alter table public.peris_camp_stock alter column stock_updated_at set default public.peris_game_now();
alter table public.peris_camp_stock alter column next_recruit_at set default public.peris_game_now()+interval '1 minute';
alter table public.peris_camp_stock enable row level security;
insert into public.peris_camp_stock(camp_id,next_recruit_at)select id,public.peris_game_now()+make_interval(secs=>60+floor(random()*241)::integer)from public.peris_camps where bandit on conflict do nothing;
alter table public.peris_reports add column if not exists camp_id integer;
alter table public.peris_reports add column if not exists farm_list_id bigint;
alter table public.armies add column if not exists loot_report_id bigint;
alter table public.peris_campaign_farms add column if not exists route jsonb;
alter table public.peris_campaign_farms add column if not exists enabled boolean not null default false;
alter table public.peris_campaign_farms add column if not exists interval_seconds integer not null default 300 check(interval_seconds between 60 and 86400);
alter table public.peris_campaign_farms add column if not exists next_at timestamptz;
alter table public.peris_campaign_farms add column if not exists last_status text;
create index if not exists peris_farms_due on public.peris_campaign_farms(next_at,id)where enabled;

create or replace function public.peris_camp_accrue(p_camp integer,p_until timestamptz default public.peris_game_now())returns void language plpgsql security definer set search_path='' as $$
declare c public.peris_camps%rowtype;s public.peris_camp_stock%rowtype;rates integer[];capacity integer;batch_min integer;batch_max integer;cap integer;minutes numeric;r text;i integer:=1;amount integer;steps integer:=0;stock jsonb;
begin
 select * into c from public.peris_camps where id=p_camp and bandit for update;if c.id is null then return;end if;
 select * into s from public.peris_camp_stock where camp_id=p_camp for update;
 if s.camp_id is null then return;end if;
 rates:=case when c.tier>=6 then array[24,15,15,6]when c.tier<=2 then array[3,2,2,1]else array[9,6,6,3]end;
 cap:=greatest(case when c.tier>=6 then 250 when c.tier<=2 then 30 else 100 end,ceil((array[30,50,80,120,180,260,360,480,610,720])[least(10,greatest(1,c.tier))]*1.08)::integer);
 batch_min:=case when c.tier>=6 then 4 when c.tier<=2 then 1 else 2 end;batch_max:=case when c.tier>=6 then 10 when c.tier<=2 then 3 else 6 end;
 if s.engaged_battle_id is null then
  while s.next_recruit_at<=p_until and steps<1024 loop
   steps:=steps+1;
   amount:=greatest(0,least(cap-c.infantry-c.archers-c.cavalry,batch_min+floor(random()*(batch_max-batch_min+1))::integer));
   case (s.recruit_sequence % case when c.tier<=2 then 2 else 3 end)
    when 0 then c.infantry:=c.infantry+amount;when 1 then c.archers:=c.archers+amount;else c.cavalry:=c.cavalry+amount;end case;
   s.recruit_sequence:=s.recruit_sequence+1;s.next_recruit_at:=s.next_recruit_at+make_interval(secs=>60+floor(random()*241)::integer);
   if c.infantry+c.archers+c.cavalry>=cap then s.next_recruit_at:=greatest(p_until,s.next_recruit_at)+make_interval(secs=>60+floor(random()*241)::integer);exit;end if;
  end loop;
  update public.peris_camps set infantry=c.infantry,archers=c.archers,cavalry=c.cavalry where id=c.id;
 end if;
 minutes:=greatest(0,extract(epoch from(p_until-s.stock_updated_at))/60);stock:=s.resources;
 foreach r in array array['wood','stone','food','gold']loop
  stock:=jsonb_set(stock,array[r],to_jsonb(least(rates[i]*30,coalesce((stock->>r)::numeric,0)+rates[i]*minutes)));i:=i+1;
 end loop;
 update public.peris_camp_stock set resources=stock,stock_updated_at=greatest(p_until,s.stock_updated_at),next_recruit_at=s.next_recruit_at,recruit_sequence=s.recruit_sequence where camp_id=c.id;
end $$;

-- Persist battle-time casualty value; signed profit is calculated only from delivery.
create or replace function public.peris_roster_loss_cost(p_initial jsonb,p_survivors jsonb,p_version integer)returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_object_agg(resource,amount)from(
  select resource,coalesce(sum(greatest(0,coalesce((p_initial->>c.unit)::integer,0)-coalesce((p_survivors->>c.unit)::integer,0))*(public.peris_unit_stats(c.unit,'roman',p_version)->'cost'->>resource)::numeric),0)as amount
  from unnest(array['wood','stone','food','gold'])keys(resource)cross join public.peris_unit_catalog c group by resource
 )costs where jsonb_typeof(p_initial)='object'and jsonb_typeof(p_survivors)='object'
$$;
create or replace function public.peris_roster_loss_cost(p_initial jsonb,p_survivors jsonb)returns jsonb
language sql stable security definer set search_path='' as $$select public.peris_roster_loss_cost(p_initial,p_survivors,2)$$;
create or replace function public.peris_resource_difference(p_received jsonb,p_spent jsonb)returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_object_agg(resource,coalesce((p_received->>resource)::numeric,0)-coalesce((p_spent->>resource)::numeric,0))from unnest(array['wood','stone','food','gold'])keys(resource)
$$;

create or replace function public.peris_deliver_loot(p_army bigint)returns void language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;s public.settlements%rowtype;delivered jsonb:='{}';overflow jsonb:='{}';r text;amount numeric;remaining numeric;
begin
 select * into a from public.armies where id=p_army for update;
 if a.carried_loot is null then return;end if;
 select * into s from public.settlements where id=a.home_settlement_id and owner_id=a.owner_id for update;
 foreach r in array array['wood','stone','food','gold']loop
  amount:=coalesce((a.carried_loot->>r)::numeric,0);remaining:=greatest(0,case when r='food'then s.food_capacity else s.capacity end-(to_jsonb(s)->>r)::numeric);
  delivered:=delivered||jsonb_build_object(r,least(amount,remaining));overflow:=overflow||jsonb_build_object(r,greatest(0,amount-remaining));
 end loop;
 update public.settlements set wood=wood+(delivered->>'wood')::numeric,stone=stone+(delivered->>'stone')::numeric,food=food+(delivered->>'food')::numeric,gold=gold+(delivered->>'gold')::numeric where id=s.id;
 update public.peris_reports set result=result||jsonb_build_object('delivered',delivered,'overflow',overflow,'delivered_at',now())||
  case when coalesce(result->'replacement_cost',public.peris_roster_loss_cost(result->'attacker_roster',result->'attacker_survivor_roster',coalesce((result->>'balance_version')::integer,1)))is not null then jsonb_build_object('estimated_profit',public.peris_resource_difference(delivered,coalesce(result->'replacement_cost',public.peris_roster_loss_cost(result->'attacker_roster',result->'attacker_survivor_roster',coalesce((result->>'balance_version')::integer,1)))))else '{}'::jsonb end where battle_id=a.loot_report_id and owner_id=a.owner_id;
 update public.battles set result=result||jsonb_build_object('delivered',delivered,'overflow',overflow,'delivered_at',now())||
  case when coalesce(result->'replacement_cost',public.peris_roster_loss_cost(result->'attacker_roster',result->'attacker_survivor_roster',coalesce((result->>'balance_version')::integer,1)))is not null then jsonb_build_object('estimated_profit',public.peris_resource_difference(delivered,coalesce(result->'replacement_cost',public.peris_roster_loss_cost(result->'attacker_roster',result->'attacker_survivor_roster',coalesce((result->>'balance_version')::integer,1)))))else '{}'::jsonb end where id=a.loot_report_id and attacker_owner_id=a.owner_id;
 update public.armies set carried_loot=null,loot_report_id=null where id=a.id;
end $$;

create or replace function public.peris_take_camp_loot(p_stock jsonb,p_capacity numeric)returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:='{}';total numeric;target numeric;assigned numeric:=0;entry record;share numeric;
begin
 select sum(floor(greatest(0,(p_stock->>key)::numeric)))into total from unnest(array['wood','stone','food','gold'])keys(key);
 target:=least(floor(greatest(0,p_capacity)),total);
 if total<=0 then return '{"wood":0,"stone":0,"food":0,"gold":0}';end if;
 for entry in select key,ordinal,floor(greatest(0,(p_stock->>key)::numeric))as amount from unnest(array['wood','stone','food','gold'])with ordinality keys(key,ordinal)loop
  share:=floor(entry.amount*target/total);assigned:=assigned+share;result:=jsonb_set(result,array[entry.key],to_jsonb(share));
 end loop;
 for entry in select key,ordinal,floor(greatest(0,(p_stock->>key)::numeric))as amount from unnest(array['wood','stone','food','gold'])with ordinality keys(key,ordinal)order by mod(floor(greatest(0,(p_stock->>key)::numeric))*target,total)desc,ordinal loop
  exit when assigned>=target;
  if (result->>entry.key)::numeric<entry.amount then result:=jsonb_set(result,array[entry.key],to_jsonb((result->>entry.key)::numeric+1));assigned:=assigned+1;end if;
 end loop;
 return result;
end $$;

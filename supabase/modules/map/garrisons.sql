-- Unsent soldiers remain at their ruler's village or owned field.
-- Multiple legions share a location pool; metadata and troops remain private.
alter table public.armies add column if not exists march_origin jsonb;
alter table public.armies add column if not exists march_returning boolean not null default false;
create table if not exists public.peris_garrisons (
 owner_id uuid not null references public.players(id) on delete cascade,
 col integer not null check(col between -100 and 99), row integer not null check(row between -100 and 99),
 infantry integer not null default 0 check(infantry>=0),
 archers integer not null default 0 check(archers>=0),
 cavalry integer not null default 0 check(cavalry>=0),
 primary key(owner_id,col,row)
);
alter table public.peris_garrisons enable row level security;
revoke all on public.peris_garrisons from public,anon,authenticated;
grant select on public.peris_garrisons to authenticated;
drop policy if exists "own garrisons" on public.peris_garrisons;
create policy "own garrisons" on public.peris_garrisons for select to authenticated using(owner_id=public.peris_player_id());

-- New legions keep the familiar offset without crossing their village's field edge.
-- Existing saved coordinates are never relocated by this helper.
create or replace function public.peris_home_army_position(p_x integer,p_y integer)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object(
  'x',least(public.peris_wrap_world(p_x)+40,floor(public.peris_wrap_world(p_x)/128)*128+127)::integer,
  'y',least(public.peris_wrap_world(p_y)+30,floor(public.peris_wrap_world(p_y)/128)*128+127)::integer)
$$;

create or replace function public.peris_station_owned(p_owner uuid,p_col integer,p_row integer)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.settlements s where s.owner_id=p_owner
  and public.peris_wrap_cell(floor(s.x/128.0)::integer)=public.peris_wrap_cell(p_col)
  and public.peris_wrap_cell(floor(s.y/128.0)::integer)=public.peris_wrap_cell(p_row))
 or exists(select 1 from public.peris_map_plots p where p.owner_id=p_owner and p.col=public.peris_wrap_cell(p_col) and p.row=public.peris_wrap_cell(p_row))
$$;

create or replace function public.peris_garrison_troops(p_troops jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare role_name text;amount numeric;total integer:=0;result jsonb:='{}';
begin
 if jsonb_typeof(p_troops) is distinct from 'object' then raise exception 'Choose whole troop counts';end if;
 foreach role_name in array array['infantry','archers','cavalry'] loop
  if jsonb_typeof(p_troops->role_name) is distinct from 'number' then raise exception 'Choose whole troop counts';end if;
  amount:=(p_troops->>role_name)::numeric;
  if amount<>trunc(amount) or amount<0 or amount>1000 then raise exception 'Choose whole troop counts from 0 to 1000';end if;
  total:=total+amount::integer;result:=result||jsonb_build_object(role_name,amount::integer);
 end loop;
 if total>1000 then raise exception 'Stay within the 1000 soldier legion capacity';end if;
 return result;
end $$;

create or replace function public.peris_garrison_add(p_owner uuid,p_col integer,p_row integer,p_troops jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare troops jsonb:=public.peris_garrison_troops(p_troops);v_col integer:=public.peris_wrap_cell(p_col);v_row integer:=public.peris_wrap_cell(p_row);
begin
 if not public.peris_station_owned(p_owner,v_col,v_row) then raise exception 'Troops can only station in your own villages and fields';end if;
 if (troops->>'infantry')::integer+(troops->>'archers')::integer+(troops->>'cavalry')::integer=0 then return;end if;
 insert into public.peris_garrisons(owner_id,col,row,infantry,archers,cavalry)
 values(p_owner,v_col,v_row,(troops->>'infantry')::integer,(troops->>'archers')::integer,(troops->>'cavalry')::integer)
 on conflict(owner_id,col,row) do update set infantry=public.peris_garrisons.infantry+excluded.infantry,
  archers=public.peris_garrisons.archers+excluded.archers,cavalry=public.peris_garrisons.cavalry+excluded.cavalry;
end $$;

-- Internal helper acquires the legion before the pool. Cancellation/return use this same order.
create or replace function public.peris_garrison_collect_for(p_owner uuid,p_army bigint,p_troops jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;g public.peris_garrisons%rowtype;v_col integer;v_row integer;capacity integer;inf integer:=0;arc integer:=0;cav integer:=0;preset jsonb;
begin
 select * into a from public.armies where id=p_army and owner_id=p_owner for update;
 if a.id is null then raise exception 'Choose one of your armies';end if;
 if a.status<>'idle' or a.raid_target_id is not null or exists(select 1 from public.battles b where b.status='active' and (b.attacker_army_id=a.id or b.defender_army_id=a.id))then raise exception 'Bring an idle legion to this station before collecting troops';end if;
 if exists(select 1 from public.peris_orders o where o.owner_id=p_owner and o.kind='recruit' and coalesce(o.army_id,(select min(id)from public.armies where owner_id=p_owner))=a.id)then raise exception 'Finish training before collecting stationed troops';end if;
 v_col:=public.peris_wrap_cell(floor(a.target_x/128.0)::integer);v_row:=public.peris_wrap_cell(floor(a.target_y/128.0)::integer);
 if not public.peris_station_owned(p_owner,v_col,v_row) then raise exception 'Troops can only station in your own villages and fields';end if;
 if p_troops is not null then preset:=public.peris_garrison_troops(p_troops);end if;
 select * into g from public.peris_garrisons where owner_id=p_owner and col=v_col and row=v_row for update;
 if g.owner_id is null then
  if preset is not null and (preset->>'infantry')::integer+(preset->>'archers')::integer+(preset->>'cavalry')::integer>0 then raise exception 'No stationed troops are available here';end if;
  return jsonb_build_object('infantry',0,'archers',0,'cavalry',0);
 end if;
 capacity:=greatest(0,1000-a.infantry-a.archers-a.cavalry);
 if preset is null then
  inf:=least(capacity,g.infantry);capacity:=capacity-inf;
  arc:=least(capacity,g.archers);capacity:=capacity-arc;cav:=least(capacity,g.cavalry);
 else
  inf:=(preset->>'infantry')::integer;arc:=(preset->>'archers')::integer;cav:=(preset->>'cavalry')::integer;
  if inf>g.infantry or arc>g.archers or cav>g.cavalry or inf+arc+cav>capacity then raise exception 'Choose available stationed troops within the legion capacity';end if;
 end if;
 update public.armies set infantry=infantry+inf,archers=archers+arc,cavalry=cavalry+cav,updated_at=now()where id=a.id;
 update public.peris_garrisons set infantry=infantry-inf,archers=archers-arc,cavalry=cavalry-cav where owner_id=p_owner and col=v_col and row=v_row;
 delete from public.peris_garrisons where owner_id=p_owner and col=v_col and row=v_row and infantry=0 and archers=0 and cavalry=0;
 return jsonb_build_object('infantry',inf,'archers',arc,'cavalry',cav);
end $$;

create or replace function public.peris_collect_garrison(p_army bigint,p_troops jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if u is null then raise exception 'Authentication required';end if;
 return public.peris_garrison_collect_for(u,p_army,p_troops);
end $$;

create or replace function public.peris_garrison_merge(p_army bigint)
returns void language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;
begin
 select * into a from public.armies where id=p_army for update;
 if a.id is null or a.status<>'idle' or a.raid_target_id is not null then return;end if;
 if not public.peris_station_owned(a.owner_id,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer)then return;end if;
 if exists(select 1 from public.battles b where b.status='active' and (b.attacker_army_id=a.id or b.defender_army_id=a.id))then return;end if;
 perform public.peris_garrison_collect_for(a.owner_id,a.id);
end $$;

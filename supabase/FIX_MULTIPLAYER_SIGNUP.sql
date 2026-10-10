-- PERIS multiplayer signup hotfix for an existing V10-V13 world.
-- Replaces allocation only; preserves accounts, cities, armies, loot and world data.
-- Run this entire file in Supabase SQL Editor, then retry the same ruler name.
begin;

-- Proximity lookups use bounded wrapped fields rather than every camp/city.
create index if not exists peris_signup_city_cell on public.settlements
 ((public.peris_wrap_cell(floor(x/128::numeric)::integer)),(public.peris_wrap_cell(floor(y/128::numeric)::integer)));
create index if not exists peris_signup_camp_cell on public.peris_camps
 ((public.peris_wrap_cell(floor(x/128::numeric)::integer)),(public.peris_wrap_cell(floor(y/128::numeric)::integer)));

create or replace function public.create_player(p_display_name text)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();n text:=btrim(p_display_name);sp public.spawn_points%rowtype;candidate public.spawn_points%rowtype;sid bigint;land bytea;cx integer;cy integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if exists(select 1 from public.players where id=u)then return jsonb_build_object('ok',true);end if;
 if n is null or n!~'^[A-Za-z0-9 _-]{2,20}$'then raise exception 'Use 2-20 letters, numbers, spaces, _ or -';end if;
 -- Try sites in ID order before running proximity checks. A single sorted
 -- anti-join lets the planner test the entire realm before applying LIMIT 1.
 perform pg_advisory_xact_lock(204200);
 -- Another request for the same account may have finished while we waited.
 if exists(select 1 from public.players where id=u)then return jsonb_build_object('ok',true);end if;
 select walkable into land from public.peris_world_map where id=1;
 for candidate in
  select sp0.* from public.spawn_points sp0
  where not exists(select 1 from public.settlements s where s.spawn_point_id=sp0.id)
  order by sp0.id for update of sp0 skip locked
 loop
  cx:=public.peris_wrap_cell(floor(candidate.x/128::numeric)::integer);
  cy:=public.peris_wrap_cell(floor(candidate.y/128::numeric)::integer);
  if land is null or exists(select 1 from generate_series(-1,1)dx cross join generate_series(-1,1)dy
   where get_bit(land,(public.peris_wrap_cell(cy+dy)+100)*200+public.peris_wrap_cell(cx+dx)+100)=0)then continue;end if;
  if exists(select 1 from generate_series(-1,1)dx cross join generate_series(-1,1)dy join public.peris_map_plots p
   on p.col=public.peris_wrap_cell(cx+dx)and p.row=public.peris_wrap_cell(cy+dy))then continue;end if;
  if exists(select 1 from generate_series(-2,2)dx cross join generate_series(-2,2)dy join public.settlements s
   on public.peris_wrap_cell(floor(s.x/128::numeric)::integer)=public.peris_wrap_cell(cx+dx)
   and public.peris_wrap_cell(floor(s.y/128::numeric)::integer)=public.peris_wrap_cell(cy+dy))then continue;end if;
  if exists(select 1 from generate_series(-1,1)dx cross join generate_series(-1,1)dy join public.peris_camps c
   on public.peris_wrap_cell(floor(c.x/128::numeric)::integer)=public.peris_wrap_cell(cx+dx)
   and public.peris_wrap_cell(floor(c.y/128::numeric)::integer)=public.peris_wrap_cell(cy+dy))then continue;end if;
  if exists(select 1 from generate_series(-3,3)dx cross join generate_series(-3,3)dy join public.peris_settler_expeditions e
   on e.col=public.peris_wrap_cell(cx+dx)and e.row=public.peris_wrap_cell(cy+dy)where e.status='travelling')then continue;end if;
  sp:=candidate;exit;
 end loop;
 if sp.id is null then raise exception 'This world has no free settlement sites';end if;
 insert into public.players(id,display_name)values(u,n);
 insert into public.settlements(owner_id,spawn_point_id,name,x,y,wood,stone,food,gold)values(u,sp.id,n||'''s Keep',sp.x,sp.y,1250,1000,1500,500)returning id into sid;
 insert into public.buildings(settlement_id,building_type,level)select sid,t,0 from unnest(array['lumber','quarry','farm','market','barracks','stables','wall','storehouse'])t;
 insert into public.armies(owner_id,home_settlement_id,name,infantry,archers,cavalry,start_x,start_y,target_x,target_y)values(u,sid,'Legio I · The Dawn',120,50,16,sp.x+40,sp.y+30,sp.x+40,sp.y+30);
 return jsonb_build_object('ok',true);
exception when unique_violation then raise exception 'That ruler name is already taken';
end $$;


revoke all on function public.create_player(text) from public,anon;
grant execute on function public.create_player(text) to authenticated;
notify pgrst,'reload schema';
commit;

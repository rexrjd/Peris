create or replace function public.create_player(p_display_name text)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();n text:=btrim(p_display_name);sp public.spawn_points%rowtype;sid bigint;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform pg_advisory_xact_lock(204200);
 if exists(select 1 from public.players where id=u)then return jsonb_build_object('ok',true);end if;
 if n is null or n!~'^[A-Za-z0-9 _-]{2,20}$'then raise exception 'Use 2-20 letters, numbers, spaces, _ or -';end if;
 select sp0.* into sp from public.spawn_points sp0 left join public.settlements s on s.spawn_point_id=sp0.id
 where s.id is null and public.peris_world_walkable(sp0.x,sp0.y)
 and not exists(select 1 from generate_series(-1,1) dx cross join generate_series(-1,1) dy
  where not public.peris_world_walkable(public.peris_wrap_world(sp0.x+dx*128),public.peris_wrap_world(sp0.y+dy*128)))
 and not exists(select 1 from public.peris_map_plots p
  where public.peris_cell_distance(floor(sp0.x/128::numeric)::integer,floor(sp0.y/128::numeric)::integer,p.col,p.row)<=1)
 and not exists(select 1 from public.settlements existing
  where public.peris_cell_distance(floor(sp0.x/128::numeric)::integer,floor(sp0.y/128::numeric)::integer,floor(existing.x/128::numeric)::integer,floor(existing.y/128::numeric)::integer)<3)
 and not exists(select 1 from public.peris_camps camp
  where public.peris_cell_distance(floor(sp0.x/128::numeric)::integer,floor(sp0.y/128::numeric)::integer,floor(camp.x/128::numeric)::integer,floor(camp.y/128::numeric)::integer)<=1)
 order by sp0.id limit 1 for update of sp0 skip locked;
 if sp.id is null then raise exception 'This world has no free settlement sites';end if;
 insert into public.players(id,display_name)values(u,n);
 insert into public.settlements(owner_id,spawn_point_id,name,x,y,wood,stone,food,gold)values(u,sp.id,n||'''s Keep',sp.x,sp.y,1250,1000,1500,500)returning id into sid;
 insert into public.buildings(settlement_id,building_type,level)select sid,t,0 from unnest(array['lumber','quarry','farm','market','barracks','stables','wall','storehouse'])t;
 insert into public.armies(owner_id,home_settlement_id,name,infantry,archers,cavalry,start_x,start_y,target_x,target_y)values(u,sid,'Legio I · The Dawn',120,50,16,sp.x+40,sp.y+30,sp.x+40,sp.y+30);
 return jsonb_build_object('ok',true);
exception when unique_violation then raise exception 'That ruler name is already taken';
end $$;


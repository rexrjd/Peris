-- Translated viewport intervals retain entities on both sides of a periodic seam.
create or replace function public.peris_map_development(p_sid bigint) returns integer
language sql stable security definer set search_path='' as $$
 select least(5,greatest(1,
 coalesce((select least(5,greatest(0,level)) from public.buildings where settlement_id=p_sid and building_type='market'),0),
 1+floor((coalesce((select sum(least(5,greatest(0,level))) from public.buildings where settlement_id=p_sid and building_type in ('lumber','quarry','farm','wall')),0)
 +coalesce((select sum(least(5,greatest(0,level))) from public.peris_city_slots where settlement_id=p_sid),0))/8)::integer))
$$;
create or replace function public.peris_map_axis_visible(p_value numeric,p_min integer,p_max integer) returns boolean
language sql immutable set search_path='' as $$
 select p_max-p_min>=25600 or exists(select 1 from generate_series(-1,1) shift
 where p_value+shift*25600>=p_min and p_value+shift*25600<p_max)
$$;
create or replace function public.peris_map_snapshot(p_min_x integer,p_min_y integer,p_max_x integer,p_max_y integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();min_x integer:=p_min_x;min_y integer:=p_min_y;max_x integer:=p_max_x;max_y integer:=p_max_y;result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 if min_x is null or min_y is null or max_x is null or max_y is null
 or min_x>=max_x or min_y>=max_y or min_x < -38400 or min_y < -38400 or max_x > 38400 or max_y > 38400 then raise exception 'Choose valid map bounds';end if;
 with nearby_settlements as materialized (
   select s.id,s.owner_id,s.name,s.x,s.y,s.faction from public.settlements s where s.owner_id<>u
   and public.peris_map_axis_visible(s.x,min_x,max_x) and public.peris_map_axis_visible(s.y,min_y,max_y)
   order by s.id limit 601
 ), visible_settlements as (
   select s.id,s.owner_id,s.name,s.x,s.y,s.faction from public.settlements s where s.owner_id=u
   union all select * from (select * from nearby_settlements order by id limit 600) nearby
 ), army_positions as materialized (
   select a.*,(travel.position->>'x')::numeric as map_x,(travel.position->>'y')::numeric as map_y
   from public.armies a cross join lateral (select public.peris_army_position(a) as position) travel
   where a.owner_id=u or a.status='moving'
   or (public.peris_map_axis_visible(a.target_x,min_x,max_x) and public.peris_map_axis_visible(a.target_y,min_y,max_y))
 ), nearby_armies as materialized (
   select a.* from army_positions a where a.owner_id<>u
   and public.peris_map_axis_visible(a.map_x,min_x,max_x) and public.peris_map_axis_visible(a.map_y,min_y,max_y)
   order by a.id limit 601
 ), visible_armies as (
   select a.* from army_positions a where a.owner_id=u
   union all select * from (select * from nearby_armies order by id limit 600) nearby
 ), nearby_plots as materialized (
   select p.*,s.faction from public.peris_map_plots p join public.settlements s on s.id=p.settlement_id where p.owner_id<>u
   and public.peris_map_axis_visible(p.col*128+64,min_x,max_x) and public.peris_map_axis_visible(p.row*128+64,min_y,max_y)
   order by p.row,p.col limit 2001
 ), visible_plots as (
   select p.*,s.faction from public.peris_map_plots p join public.settlements s on s.id=p.settlement_id where p.owner_id=u
   union all select * from (select * from nearby_plots order by row,col limit 2000) nearby
 ), visible_owners as (
   select owner_id from visible_settlements union select owner_id from visible_armies union select owner_id from visible_plots union select u
 )
 select jsonb_build_object('server_now',now(),
   'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name) order by p.id)
     from public.players p join visible_owners o on o.owner_id=p.id),'[]'::jsonb),
   'settlements',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('map_development',public.peris_map_development(s.id)) order by s.id) from visible_settlements s),'[]'::jsonb),
   'armies',coalesce((select jsonb_agg(to_jsonb(a)-'map_x'-'map_y' order by a.id) from visible_armies a),'[]'::jsonb),
   'map_plots',coalesce((select jsonb_agg(p order by p.row,p.col) from visible_plots p),'[]'::jsonb),
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements),
   'settlements_truncated',(select count(*)>600 from nearby_settlements),
   'armies_truncated',(select count(*)>600 from nearby_armies),
   'plots_truncated',(select count(*)>2000 from nearby_plots)) into result;
 return result;
end $$;

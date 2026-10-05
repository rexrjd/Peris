-- Public strategic visibility is bounded independently of the private campaign
-- snapshot. The caller's own markers remain available outside the viewport.
create or replace function public.peris_map_snapshot(p_min_x integer,p_min_y integer,p_max_x integer,p_max_y integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();min_x integer;min_y integer;max_x integer;max_y integer;result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_min_x is null or p_min_y is null or p_max_x is null or p_max_y is null then raise exception 'Choose map bounds';end if;
 min_x:=greatest(-12800,p_min_x);min_y:=greatest(-12800,p_min_y);
 max_x:=least(12800,p_max_x);max_y:=least(12800,p_max_y);
 if min_x>=max_x or min_y>=max_y then raise exception 'Choose valid map bounds';end if;
 with visible_settlements as (
   select s.id,s.owner_id,s.name,s.x,s.y from public.settlements s where s.owner_id=u
   union all
   select * from (select s.id,s.owner_id,s.name,s.x,s.y from public.settlements s
     where s.owner_id<>u and s.x>=min_x and s.x<max_x and s.y>=min_y and s.y<max_y order by s.id limit 600) nearby
 ), army_positions as (
   select a.*,
     (travel.position->>'x')::numeric as map_x,
     (travel.position->>'y')::numeric as map_y
   from public.armies a cross join lateral (
     select public.peris_army_position(a) as position
   ) travel
   where a.owner_id=u or a.status='moving'
     or (a.target_x>=min_x and a.target_x<max_x and a.target_y>=min_y and a.target_y<max_y)
 ), visible_armies as (
   select a.* from army_positions a where a.owner_id=u
   union all
   select * from (select a.* from army_positions a where a.owner_id<>u
     and a.map_x>=min_x and a.map_x<max_x and a.map_y>=min_y and a.map_y<max_y order by a.id limit 600) nearby
 ), visible_owners as (
   select owner_id from visible_settlements union select owner_id from visible_armies union select u
 )
 select jsonb_build_object('server_now',now(),
   'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name) order by p.id)
     from public.players p join visible_owners o on o.owner_id=p.id),'[]'::jsonb),
   'settlements',coalesce((select jsonb_agg(s order by s.id) from visible_settlements s),'[]'::jsonb),
   'armies',coalesce((select jsonb_agg(to_jsonb(a)-'map_x'-'map_y' order by a.id) from visible_armies a),'[]'::jsonb),
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements),
   'settlements_truncated',(select count(*)>600 from public.settlements s where s.owner_id<>u and s.x>=min_x and s.x<max_x and s.y>=min_y and s.y<max_y),
   'armies_truncated',(select count(*)>600 from army_positions a where a.owner_id<>u and a.map_x>=min_x and a.map_x<max_x and a.map_y>=min_y and a.map_y<max_y)) into result;
 return result;
end $$;

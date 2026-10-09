create or replace function public.peris_march(p_target_x integer,p_target_y integer,p_path jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;position jsonb;point jsonb;route jsonb;
 tx integer:=public.peris_wrap_world(p_target_x);ty integer:=public.peris_wrap_world(p_target_y);
 x numeric;y numeric;px numeric;py numeric;cx integer;cy integer;pcx integer;pcy integer;
 distance numeric:=0;segment numeric;seconds numeric;count_points integer;ordinal integer:=0;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_target_x is null or p_target_y is null then raise exception 'Choose a destination';end if;
 if p_path is null or jsonb_typeof(p_path)<>'array' then raise exception 'Choose a valid land route';end if;
 count_points:=jsonb_array_length(p_path);
 if count_points<2 or count_points>2000 then raise exception 'A march needs 2-2000 route points';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and army_id=public.peris_army_id(u) and kind='recruit') then raise exception 'Let training finish before marching';end if;
 select * into a from public.armies where id=public.peris_army_id(u) for update;
 if a.id is null then raise exception 'Army not found';end if;
 position:=public.peris_army_position(a);
 px:=(position->>'x')::numeric;py:=(position->>'y')::numeric;
 if not public.peris_world_walkable(px,py) then raise exception 'The army must start on land';end if;
 pcx:=floor(px/128)::integer;pcy:=floor(py/128)::integer;
 route:=jsonb_build_array(jsonb_build_array(px,py));
 for point in select value from jsonb_array_elements(p_path)with ordinality as points(value,sequence)order by sequence loop
  ordinal:=ordinal+1;
  if jsonb_typeof(point)<>'array' then raise exception 'Choose a valid land route';end if;
  if jsonb_array_length(point)<>2 or jsonb_typeof(point->0)<>'number' or jsonb_typeof(point->1)<>'number' then raise exception 'Route points must be numeric coordinate pairs';end if;
  x:=(point->>0)::numeric;y:=(point->>1)::numeric;
  if x<-12800 or x>=12800 or y<-12800 or y>=12800 then raise exception 'Route leaves the world';end if;
  cx:=floor(x/128)::integer;cy:=floor(y/128)::integer;
  if ordinal=1 then
   if abs(public.peris_wrap_cell(cx-pcx))>1 or abs(public.peris_wrap_cell(cy-pcy))>1 then raise exception 'Route does not start at your army';end if;
   continue;
  end if;
  if abs(public.peris_wrap_cell(cx-pcx))>1 or abs(public.peris_wrap_cell(cy-pcy))>1 then raise exception 'Route points must pass through neighboring fields';end if;
  if not public.peris_world_walkable(x,y) then raise exception 'Armies cannot march across the sea';end if;
  if cx<>pcx and cy<>pcy and (not public.peris_world_walkable((cx+.5)*128,(pcy+.5)*128) or not public.peris_world_walkable((pcx+.5)*128,(cy+.5)*128)) then
   raise exception 'A route cannot cut a sea corner';
  end if;
  segment:=sqrt(power(public.peris_wrapped_delta(px,x),2)+power(public.peris_wrapped_delta(py,y),2));
  if segment=0 and count_points>2 then raise exception 'A route must advance through its fields';end if;
  distance:=distance+segment;route:=route||jsonb_build_array(jsonb_build_array(x,y));
  px:=x;py:=y;pcx:=cx;pcy:=cy;
 end loop;
 if px<>tx or py<>ty then raise exception 'Route must end at the chosen destination';end if;
 seconds:=greatest(2,distance/(22*(public.peris_hero_bonuses(a.id)->>'speed')::numeric));
 update public.armies set start_x=round((position->>'x')::numeric),start_y=round((position->>'y')::numeric),target_x=tx,target_y=ty,
  march_path=route,march_distance=distance,march_map_version=4,departure_at=now(),arrival_at=now()+make_interval(secs=>seconds::double precision),
  status='moving',raid_target_id=null,updated_at=now() where id=a.id;
 return jsonb_build_object('ok',true);
end $$;

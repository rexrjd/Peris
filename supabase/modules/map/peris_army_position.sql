-- Interpolate by traveled route distance. Old saves and armies with no stored
-- route retain the original straight-line interpolation until their next march.
create or replace function public.peris_army_position(p_army public.armies,p_at timestamptz default now())returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t numeric;remaining numeric;point jsonb;previous jsonb;x numeric;y numeric;px numeric;py numeric;dx numeric;dy numeric;segment numeric;
begin
 if p_army.status<>'moving' then return jsonb_build_object('x',p_army.target_x,'y',p_army.target_y);end if;
 t:=greatest(0,least(1,extract(epoch from(p_at-p_army.departure_at))/greatest(0.001,extract(epoch from(p_army.arrival_at-p_army.departure_at)))));
 if p_army.march_path is null or jsonb_typeof(p_army.march_path)<>'array' or jsonb_array_length(p_army.march_path)<2 or coalesce(p_army.march_distance,0)<=0 then
  if p_army.march_map_version=4 then return jsonb_build_object('x',public.peris_wrap_world(p_army.start_x+public.peris_wrapped_delta(p_army.start_x,p_army.target_x)*t),'y',public.peris_wrap_world(p_army.start_y+public.peris_wrapped_delta(p_army.start_y,p_army.target_y)*t));end if;
  return jsonb_build_object('x',p_army.start_x+(p_army.target_x-p_army.start_x)*t,'y',p_army.start_y+(p_army.target_y-p_army.start_y)*t);
 end if;
 remaining:=p_army.march_distance*t;previous:=p_army.march_path->0;
 px:=(previous->>0)::numeric;py:=(previous->>1)::numeric;
 for point in select value from jsonb_array_elements(p_army.march_path)with ordinality as points(value,ordinal)where ordinal>1 order by ordinal loop
  x:=(point->>0)::numeric;y:=(point->>1)::numeric;
  dx:=case when p_army.march_map_version=4 then public.peris_wrapped_delta(px,x) else x-px end;
  dy:=case when p_army.march_map_version=4 then public.peris_wrapped_delta(py,y) else y-py end;
  segment:=sqrt(power(dx,2)+power(dy,2));
  if segment>0 and remaining<=segment then
   if p_army.march_map_version=4 then return jsonb_build_object('x',public.peris_wrap_world(px+dx*remaining/segment),'y',public.peris_wrap_world(py+dy*remaining/segment));end if;
   return jsonb_build_object('x',px+dx*remaining/segment,'y',py+dy*remaining/segment);
  end if;
  remaining:=remaining-segment;px:=x;py:=y;
 end loop;
 return jsonb_build_object('x',p_army.target_x,'y',p_army.target_y);
end $$;

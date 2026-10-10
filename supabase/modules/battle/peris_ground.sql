create or replace function public.peris_ground(p_terrain text,px numeric,py numeric) returns jsonb language sql immutable set search_path='' as $$
 select case
 when p_terrain='woods' and ((nx>260 and nx<650 and ny>45 and ny<310)or(nx>660 and nx<1040 and ny>405 and ny<665)) then '{"kind":"Forest","speed":0.68,"cover":0.6,"height":0}'::jsonb
 when p_terrain='highlands' and power((nx-650)/240,2)+power((ny-285)/180,2)<1 then '{"kind":"High ground","speed":0.85,"cover":1,"height":1}'::jsonb
 when p_terrain='river' and abs(nx-(600+sin(ny/110)*32))<42 and (ny<306 or ny>395) then '{"kind":"Shallows","speed":0.42,"cover":1,"height":0}'::jsonb
 when p_terrain='marsh' and sin(nx/95)+cos(ny/70)>.3 then '{"kind":"Marsh","speed":0.62,"cover":0.9,"height":0}'::jsonb
 when p_terrain='snow' then '{"kind":"Snow","speed":0.88,"cover":1,"height":0}'::jsonb
 when p_terrain='desert' then '{"kind":"Sand","speed":0.9,"cover":1,"height":0}'::jsonb
 when p_terrain='coast' then '{"kind":"Coastal ground","speed":1,"cover":1,"height":0}'::jsonb
 when p_terrain='farmland' then '{"kind":"Farmland","speed":1,"cover":1,"height":0}'::jsonb
 when p_terrain='darkland' then '{"kind":"Volcanic ground","speed":1,"cover":1,"height":0}'::jsonb
 else '{"kind":"Open ground","speed":1,"cover":1,"height":0}'::jsonb end from(select px/sqrt(5) nx,py/sqrt(5) ny) coordinates;
$$;


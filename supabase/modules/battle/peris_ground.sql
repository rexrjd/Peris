create or replace function public.peris_ground(p_terrain text,px numeric,py numeric) returns jsonb language sql immutable set search_path='' as $$
 select case
 when p_terrain='woods' and ((px>420 and px<630 and py>65 and py<310)or(px>690 and px<960 and py>405 and py<665)) then '{"kind":"Forest","speed":0.68,"cover":0.6,"height":0}'::jsonb
 when p_terrain='highlands' and power((px-650)/190,2)+power((py-285)/135,2)<1 then '{"kind":"High ground","speed":0.85,"cover":1,"height":1}'::jsonb
 when p_terrain='river' and abs(px-(600+sin(py/110)*32))<42 and (py<306 or py>395) then '{"kind":"Shallows","speed":0.42,"cover":1,"height":0}'::jsonb
 else '{"kind":"Open ground","speed":1,"cover":1,"height":0}'::jsonb end;
$$;


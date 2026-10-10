-- Tactical terrain comes from the canonical field byte, never a caller-provided camp label.
alter table public.peris_camps add column if not exists bandit boolean not null default false;
alter table public.peris_camps add column if not exists faction text;
alter table public.battles add column if not exists defender_faction text;
create or replace function public.peris_battle_terrain(px numeric,py numeric)returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select (array['plains','woods','highlands','farmland','desert','snow','marsh','river','coast','coast','darkland'])[1+get_byte(terrain,(floor(public.peris_wrap_world(py)/128)::integer+100)*200+floor(public.peris_wrap_world(px)/128)::integer+100)] from public.peris_world_map where id=1),'plains')
$$;
update public.peris_camps set terrain=public.peris_battle_terrain(x,y) where not bandit;

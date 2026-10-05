-- Never shrink an occupied world silently. The enclosing transaction aborts
-- before changing constraints, terrain or positions when migration is needed.
alter table public.armies add column if not exists march_path jsonb;
alter table public.armies add column if not exists march_distance numeric;
do $$
declare outside_settlements integer;outside_armies integer;outside_routes integer;
begin
 select count(*) into outside_settlements from public.settlements
 where x < -12800 or x >= 12800 or y < -12800 or y >= 12800;
 select count(*) into outside_armies from public.armies
 where start_x < -12800 or start_x >= 12800 or start_y < -12800 or start_y >= 12800
    or target_x < -12800 or target_x >= 12800 or target_y < -12800 or target_y >= 12800;
 select count(*) into outside_routes from public.armies a
 where a.march_path is not null and exists (
  select 1 from jsonb_array_elements(a.march_path) p
  where (p->>0)::numeric < -12800 or (p->>0)::numeric >= 12800
     or (p->>1)::numeric < -12800 or (p->>1)::numeric >= 12800
 );
 if outside_settlements + outside_armies + outside_routes > 0 then
  raise exception '200 x 200 world upgrade requires manual migration: % settlements, % armies and % saved routes are outside [-12800, 12800). No positions were moved or deleted.',outside_settlements,outside_armies,outside_routes;
 end if;
end $$;
alter table public.settlements drop constraint if exists settlements_x_check;
alter table public.settlements add constraint settlements_x_check check(x >= -12800 and x < 12800);
alter table public.settlements drop constraint if exists settlements_y_check;
alter table public.settlements add constraint settlements_y_check check(y >= -12800 and y < 12800);

-- Original and historical generated spawn points retain their IDs/coordinates.
-- Current land-only sites are generated after the terrain mask is installed.
create index if not exists spawn_points_map_position_idx on public.spawn_points(x,y);

create index if not exists settlements_map_position_idx on public.settlements(x,y);
create index if not exists armies_map_status_idx on public.armies(status);
create index if not exists armies_map_position_idx on public.armies(target_x,target_y) where status='idle';

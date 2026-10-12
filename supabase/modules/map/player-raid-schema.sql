-- City raids retain the same march, formation and report systems.
alter table public.armies add column if not exists raid_city_id bigint references public.settlements(id)on delete set null;
alter table public.armies add column if not exists siege_target text not null default 'auto';
alter table public.battles add column if not exists raid_city_id bigint references public.settlements(id)on delete set null;
alter table public.battles add column if not exists siege_target text not null default 'auto';
alter table public.battles add column if not exists city_defenders jsonb not null default '[]'::jsonb;

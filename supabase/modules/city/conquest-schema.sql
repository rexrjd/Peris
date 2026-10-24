-- Private loyalty; no rival map projection includes these columns.
alter table public.settlements add column if not exists loyalty numeric not null default 100 check(loyalty between 0 and 100);
alter table public.settlements add column if not exists loyalty_updated_at timestamptz not null default public.peris_game_now();
create table if not exists public.peris_conquest_version(id boolean primary key default true check(id));
alter table public.peris_conquest_version enable row level security;
revoke all on public.peris_conquest_version from public,anon,authenticated;
insert into public.peris_conquest_version values(true)on conflict do nothing;

create or replace function public.peris_loyalty_accrue(p_city bigint,p_until timestamptz)returns void
language sql security definer set search_path='' as $$
 update public.settlements set loyalty=least(100,loyalty+greatest(0,extract(epoch from(p_until-loyalty_updated_at)))*25/3600),
 loyalty_updated_at=greatest(loyalty_updated_at,p_until)where id=p_city
$$;
revoke all on function public.peris_loyalty_accrue(bigint,timestamptz)from public,anon,authenticated;

-- A ruler survives the anonymous browser identity that first created it.
-- Preserve every existing player UUID and all gameplay foreign keys.
do $$declare constraint_name text;begin
 for constraint_name in select conname from pg_constraint
  where conrelid='public.players'::regclass and contype='f' and confrelid='auth.users'::regclass
 loop execute format('alter table public.players drop constraint %I',constraint_name);end loop;
end $$;
create table if not exists public.peris_account_sessions(
 auth_id uuid primary key references auth.users(id) on delete cascade,
 player_id uuid not null references public.players(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index if not exists peris_account_sessions_player on public.peris_account_sessions(player_id);
alter table public.peris_account_sessions enable row level security;
revoke all on public.peris_account_sessions from public,anon,authenticated;

-- Legacy sessions keep their original ruler. New sessions resolve to the ruler
-- explicitly selected by name; clients cannot read or write these bindings.
create or replace function public.peris_player_id()returns uuid
language sql stable security definer set search_path='' as $$
 select coalesce((select player_id from public.peris_account_sessions where auth_id=auth.uid()),auth.uid())
$$;


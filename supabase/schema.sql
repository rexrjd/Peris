-- Run this entire file once in Supabase > SQL Editor > New query.

create table if not exists public.players (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default 'Player',
  avatar_url text,
  x integer not null default 250 check (x >= 0 and x <= 1100),
  y integer not null default 350 check (y >= 0 and y <= 700),
  updated_at timestamptz not null default now()
);

alter table public.players enable row level security;

drop policy if exists "Authenticated users can see players" on public.players;
create policy "Authenticated users can see players"
on public.players for select
to authenticated
using (true);

drop policy if exists "Players can create themselves" on public.players;
create policy "Players can create themselves"
on public.players for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "Players can update themselves" on public.players;
create policy "Players can update themselves"
on public.players for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Add the table to Supabase Realtime. The DO block avoids an error if it is already added.
do $$
begin
  alter publication supabase_realtime add table public.players;
exception
  when duplicate_object then null;
end $$;

-- Private account-wide research. Existing campaigns and accepted orders are retained.
alter table public.players add column if not exists research_faction text check(research_faction in('roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'));
create or replace function public.peris_account_faction(p_owner uuid)returns text language plpgsql stable security definer set search_path='' as $$
begin
 return coalesce((select research_faction from public.players where id=p_owner),(select faction from public.settlements where owner_id=p_owner order by id limit 1),'roman');
end
$$;
revoke all on function public.peris_account_faction(uuid)from public,anon,authenticated;
create table if not exists public.peris_technology_catalog(
 id text primary key,name text not null,branch text not null,era integer not null,
 faction text,cost integer not null check(cost>0),seconds integer not null check(seconds>0),
 prerequisites jsonb not null,effects jsonb not null,metadata jsonb not null
);
create table if not exists public.peris_account_science(
 owner_id uuid primary key references public.players(id)on delete cascade,
 points numeric not null default 75 check(points between 0 and 1000000000),
 updated_at timestamptz not null default public.peris_game_now(),active_id text references public.peris_technology_catalog(id),
 active_since timestamptz,active_rate numeric not null default 1 check(active_rate between 1 and 4),
 check((active_id is null)=(active_since is null))
);
alter table public.peris_account_science alter column updated_at set default public.peris_game_now();
create table if not exists public.peris_research_progress(
 owner_id uuid not null references public.players(id)on delete cascade,
 technology_id text not null references public.peris_technology_catalog(id),
 seconds numeric not null default 0 check(seconds>=0),completed_at timestamptz,
 primary key(owner_id,technology_id)
);
alter table public.peris_account_science enable row level security;
alter table public.peris_research_progress enable row level security;
revoke all on public.peris_technology_catalog,public.peris_account_science,public.peris_research_progress from public,anon,authenticated;
grant select on public.peris_account_science,public.peris_research_progress to authenticated;
drop policy if exists "own science" on public.peris_account_science;
create policy "own science" on public.peris_account_science for select to authenticated using(owner_id=public.peris_player_id());
drop policy if exists "own technology progress" on public.peris_research_progress;
create policy "own technology progress" on public.peris_research_progress for select to authenticated using(owner_id=public.peris_player_id());
create or replace function public.peris_research_bonus(p_owner uuid,p_key text)returns numeric language sql stable security definer set search_path='' as $$
 select least(3,coalesce(sum((c.effects->>p_key)::numeric),0))from public.peris_research_progress p join public.peris_technology_catalog c on c.id=p.technology_id
 where p.owner_id=p_owner and p.completed_at is not null and (c.faction is null or c.faction=public.peris_account_faction(p_owner))
$$;
create or replace function public.peris_research_factor(p_owner uuid,p_key text)returns numeric language sql stable security definer set search_path='' as $$select 1+public.peris_research_bonus(p_owner,p_key)$$;
alter table public.settlements add column if not exists wood_research numeric not null default 1;
alter table public.settlements add column if not exists stone_research numeric not null default 1;
alter table public.settlements add column if not exists food_research numeric not null default 1;
alter table public.settlements add column if not exists gold_research numeric not null default 1;
alter table public.settlements add column if not exists trade_research numeric not null default 1;

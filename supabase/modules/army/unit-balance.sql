-- Versioned rules are private. Historical battles retain their captured values.
create table if not exists public.peris_unit_catalog (
 unit text primary key, building text not null, combat_class text not null,
 cost jsonb not null, train_seconds integer not null, research_seconds integer not null,
 research_cost jsonb not null, attack numeric not null, defence numeric not null, speed integer not null, carry integer not null
);
create table if not exists public.peris_unit_balance (
 version integer not null check(version in(1,2)),unit text not null,rule jsonb not null,
 primary key(version,unit)
);
create table if not exists public.peris_unit_profiles (
 faction text not null,combat_class text not null,attack numeric not null check(attack between .94 and 1.06),
 defence numeric not null check(defence between .94 and 1.06),primary key(faction,combat_class)
);
alter table public.peris_unit_catalog enable row level security;
alter table public.peris_unit_balance enable row level security;
alter table public.peris_unit_profiles enable row level security;
revoke all on public.peris_unit_catalog,public.peris_unit_balance,public.peris_unit_profiles from public,anon,authenticated;
alter table public.battles add column if not exists balance_version integer not null default 1 check(balance_version in(1,2));
alter table public.battles alter column balance_version set default 2;
alter table public.battles add column if not exists attacker_faction text;

create or replace function public.peris_unit_stats(p_unit text,p_faction text,p_version integer)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;p public.peris_unit_profiles%rowtype;
begin
 if p_version is null or p_version not in(1,2)then raise exception 'Unknown unit balance version';end if;
 select rule into r from public.peris_unit_balance where version=p_version and unit=p_unit;
 if r is null then raise exception 'Unknown unit role';end if;
 select * into p from public.peris_unit_profiles where faction=p_faction and combat_class=r->>'combatClass';
 if p.faction is null then raise exception 'Unknown unit faction';end if;
 return r||jsonb_build_object('attack',(r->>'attack')::numeric*case when p_version=2 then p.attack else 1 end,
 'defence',(r->>'defence')::numeric*case when p_version=2 then p.defence else 1 end);
end $$;
revoke all on function public.peris_unit_stats(text,text,integer)from public,anon,authenticated;

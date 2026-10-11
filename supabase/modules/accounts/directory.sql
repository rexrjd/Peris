-- Public ruler summaries only; connection IDs, resources, troops and orders stay private.
create table if not exists public.peris_account_activity(
 player_id uuid primary key references public.players(id) on delete cascade,
 last_seen_at timestamptz not null default now()
);
create table if not exists public.peris_account_creations(
 request_id uuid primary key,player_id uuid not null unique references public.players(id) on delete cascade,
 faction text not null
);
alter table public.peris_account_activity enable row level security;
alter table public.peris_account_creations enable row level security;
revoke all on public.peris_account_activity,public.peris_account_creations from public,anon,authenticated;
create index if not exists peris_account_activity_recent on public.peris_account_activity(last_seen_at desc);
create index if not exists peris_heroes_owner on public.peris_heroes(owner_id);
insert into public.peris_account_activity(player_id,last_seen_at)
 select player_id,max(created_at) from public.peris_account_sessions group by player_id
 on conflict(player_id)do nothing;

create or replace function public.peris_note_account_activity()returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if u is null or not exists(select 1 from public.players where id=u)then return;end if;
 insert into public.peris_account_activity(player_id,last_seen_at)values(u,now())
 on conflict(player_id)do update set last_seen_at=excluded.last_seen_at
 where public.peris_account_activity.last_seen_at<now()-interval '30 seconds';
end $$;

create or replace function public.peris_account_directory(
 p_search text default '',p_faction text default null,p_activity text default 'all',
 p_sort text default 'active',p_offset integer default 0,p_limit integer default 24
)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_search is null or length(p_search)>40 or p_offset is null or p_offset<0 or p_offset>1000000
 or p_limit is null or p_limit<1 or p_limit>100 or p_activity is null or p_activity not in('all','online','recent')
 or p_sort is null or p_sort not in('active','name','cities','hero')
 or(p_faction is not null and p_faction not in('roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'))
 then raise exception 'Invalid account filters' using errcode='22023';end if;
 with summaries as (
  select p.id player_id,p.display_name,p.created_at joined_at,a.last_seen_at,
   coalesce(a.last_seen_at>now()-interval '2 minutes',false)online,
   cap.faction,cap.name capital_name,c.city_count,c.population,
   (select count(*)::integer from public.armies ar where ar.owner_id=p.id)army_count,
   h.id hero_id,h.class hero_class,coalesce(h.faction,cap.faction)hero_faction,
   case when h.id is null then 0 else(select max(l)from generate_series(1,20)l where 50*l*(l-1)<=h.experience)end hero_level
  from public.players p
  join lateral(select s.name,s.faction from public.settlements s where s.owner_id=p.id order by s.id limit 1)cap on true
  join lateral(select count(*)::integer city_count,coalesce(sum(s.population),0)::bigint population from public.settlements s where s.owner_id=p.id)c on true
  left join public.peris_account_activity a on a.player_id=p.id
  left join lateral(select hero.id,hero.class,hero.experience,home.faction from public.peris_heroes hero
   left join public.armies army on army.id=hero.army_id
   left join public.settlements home on home.id=army.home_settlement_id
   where hero.owner_id=p.id order by hero.experience desc,hero.id limit 1)h on true
  where strpos(lower(p.display_name),lower(btrim(p_search)))>0
   and(p_faction is null or cap.faction=p_faction)
   and(p_activity='all' or p_activity='online' and a.last_seen_at>now()-interval '2 minutes'
    or p_activity='recent' and a.last_seen_at>now()-interval '24 hours')
 ),ordered as (
  select s.*,row_number()over(order by
   case when p_sort='active' then s.last_seen_at end desc nulls last,
   case when p_sort='cities' then s.city_count end desc,
   case when p_sort='hero' then s.hero_level end desc,
   lower(s.display_name),s.player_id)ordinal from summaries s
 ),page as(select * from ordered order by ordinal offset p_offset limit p_limit)
 select jsonb_build_object('server_now',now(),'total',(select count(*)from summaries),
  'accounts',coalesce((select jsonb_agg(to_jsonb(page)-'ordinal' order by ordinal)from page),'[]'::jsonb))into result;
 return result;
end $$;

-- PERIS V19 guilds and messages, for an existing V18 world.
-- Keeps campaign tables, science, armies and unrelated function definitions unchanged.
begin;
-- One backend is one world. Operational/security/audit clocks remain real UTC.
create table if not exists public.peris_world_clock(
 id boolean primary key default true check(id),
 version integer not null default 1 check(version=1),
 rate integer not null default 1 check(rate in(1,10,100)),
 profile_id text not null default 'normal-v1' check(profile_id in('normal-v1','accelerated-test-v1')),
 real_anchor timestamptz not null,game_anchor timestamptz not null,
 check(profile_id<>'normal-v1'or rate=1)
);
insert into public.peris_world_clock(id,real_anchor,game_anchor)values(true,now(),now())on conflict(id)do nothing;
alter table public.peris_world_clock enable row level security;
revoke all on public.peris_world_clock from public,anon,authenticated;

create or replace function public.peris_game_now()returns timestamptz
language sql stable security definer set search_path='' as $$
 select game_anchor+(now()-real_anchor)*rate from public.peris_world_clock where id
$$;
create or replace function public.peris_clock_snapshot()returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',version,'rate',rate,'profile_id',profile_id,'real_now',now(),'game_now',public.peris_game_now())from public.peris_world_clock where id
$$;
-- Private operator setup, only before the first account in a disposable backend.
create or replace function public.peris_configure_test_clock(p_rate integer)returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_rate is null or p_rate not in(1,10,100)then raise exception 'Invalid test clock rate';end if;
 perform pg_advisory_xact_lock(204200);
 if exists(select 1 from public.players)then raise exception 'Test clock configuration requires an empty world';end if;
 update public.peris_world_clock set rate=p_rate,profile_id='accelerated-test-v1',real_anchor=now(),game_anchor=now()where id;
end $$;
revoke all on function public.peris_game_now(),public.peris_clock_snapshot(),public.peris_configure_test_clock(integer)from public,anon,authenticated;
-- Core tables exist before this module, including on legacy upgrades.
-- Defaults affect new rows only; accepted dates and balances are untouched.
alter table public.armies alter column departure_at set default public.peris_game_now();
alter table public.armies alter column arrival_at set default public.peris_game_now();
alter table public.battles alter column started_at set default public.peris_game_now();
alter table public.battles alter column last_tick_at set default public.peris_game_now();
alter table public.settlements alter column resources_updated_at set default public.peris_game_now();
alter table public.peris_challenges alter column expires_at set default public.peris_game_now()+interval '90 seconds';

do $$begin if to_regprocedure('public.peris_research_factor(uuid,text)')is null or to_regprocedure('public.peris_player_id()')is null then raise exception 'Install the V18 account/research update first, or use UPGRADE_TO_V19.sql.';end if;end $$;
-- V19 social state is separate from private campaign and public map snapshots.
create table if not exists public.peris_guilds(
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 3 and 32),
 tag text not null check(tag~'^[A-Z0-9]{2,5}$'), description text not null default '' check(length(description)<=1200),
 motd text not null default '' check(length(motd)<=800), leader_id uuid not null references public.players(id),
 recruitment text not null default 'application' check(recruitment in('open','application','invite')),
 focus text not null default 'balanced' check(focus in('balanced','warfare','economy','adventure')),
 crest jsonb not null default '{"color":"#637da3","sigil":"sun"}',
 treasury bigint not null default 0 check(treasury>=0), created_at timestamptz not null default now()
);
create unique index if not exists peris_guild_name_unique on public.peris_guilds(lower(name));
create unique index if not exists peris_guild_tag_unique on public.peris_guilds(lower(tag));
create table if not exists public.peris_guild_roles(
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.peris_guilds(id) on delete cascade,
 key text not null, name text not null check(length(btrim(name)) between 2 and 24), rank integer not null check(rank between 1 and 100),
 permissions jsonb not null default '[]', unique(guild_id,key), unique(guild_id,id)
);
create table if not exists public.peris_guild_members(
 player_id uuid primary key references public.players(id) on delete cascade,
 guild_id uuid not null references public.peris_guilds(id) on delete cascade, role_id uuid not null,
 joined_at timestamptz not null default now(), last_read_id bigint not null default 0,
 specialization text not null default 'balanced' check(specialization in('balanced','offense','defense','economy')),
 foreign key(guild_id,role_id) references public.peris_guild_roles(guild_id,id)
);
create index if not exists peris_guild_members_guild on public.peris_guild_members(guild_id);
create table if not exists public.peris_guild_invitations(
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.peris_guilds(id) on delete cascade,
 player_id uuid not null references public.players(id) on delete cascade, invited_by uuid not null references public.players(id),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
 status text not null default 'pending' check(status in('pending','accepted','declined','cancelled'))
);
create unique index if not exists peris_guild_invite_pending on public.peris_guild_invitations(guild_id,player_id)where status='pending';
create table if not exists public.peris_guild_applications(
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.peris_guilds(id) on delete cascade,
 player_id uuid not null references public.players(id) on delete cascade, body text not null default '' check(length(body)<=800),
 created_at timestamptz not null default now(), status text not null default 'pending' check(status in('pending','accepted','declined','cancelled'))
);
create unique index if not exists peris_guild_application_pending on public.peris_guild_applications(guild_id,player_id)where status='pending';
create table if not exists public.peris_guild_relations(
 id uuid primary key default gen_random_uuid(), left_id uuid not null references public.peris_guilds(id) on delete cascade,
 right_id uuid not null references public.peris_guilds(id) on delete cascade, proposer_id uuid not null references public.peris_guilds(id) on delete cascade,
 kind text not null check(kind in('alliance','nap','war')), status text not null check(status in('pending','active')),
 created_at timestamptz not null default now(), check(left_id<right_id), check(proposer_id in(left_id,right_id)), unique(left_id,right_id)
);
create table if not exists public.peris_guild_log(
 id bigint generated by default as identity primary key, guild_id uuid not null references public.peris_guilds(id) on delete cascade,
 text text not null, created_at timestamptz not null default now()
);
create index if not exists peris_guild_log_recent on public.peris_guild_log(guild_id,id desc);
create table if not exists public.peris_guild_ledger(
 id bigint generated by default as identity primary key, guild_id uuid not null references public.peris_guilds(id) on delete cascade,
 player_id uuid references public.players(id) on delete set null, player_name text not null, amount bigint not null, created_at timestamptz not null default now()
);
create index if not exists peris_guild_ledger_recent on public.peris_guild_ledger(guild_id,id desc);
create table if not exists public.peris_message_threads(
 id uuid primary key default gen_random_uuid(), player_a uuid not null references public.players(id) on delete cascade,
 player_b uuid not null references public.players(id) on delete cascade, created_at timestamptz not null default now(),
 check(player_a<player_b), unique(player_a,player_b)
);
create index if not exists peris_message_threads_a on public.peris_message_threads(player_a,id);
create index if not exists peris_message_threads_b on public.peris_message_threads(player_b,id);
create table if not exists public.peris_messages(
 id bigint generated by default as identity primary key,
 thread_id uuid references public.peris_message_threads(id) on delete cascade,
 guild_id uuid references public.peris_guilds(id) on delete cascade,
 sender_id uuid references public.players(id) on delete set null, sender_name text not null,
 kind text not null default 'message' check(kind in('message','announcement')), body text not null check(length(btrim(body)) between 1 and 2000),
 created_at timestamptz not null default now(), check((thread_id is null)<>(guild_id is null)), check(kind<>'announcement' or guild_id is not null)
);
create index if not exists peris_messages_direct_recent on public.peris_messages(thread_id,id desc)where thread_id is not null;
create index if not exists peris_messages_guild_recent on public.peris_messages(guild_id,id desc)where guild_id is not null;
create index if not exists peris_messages_sender_recent on public.peris_messages(sender_id,created_at desc);
create table if not exists public.peris_message_reads(
 owner_id uuid not null references public.players(id) on delete cascade, thread_id uuid not null references public.peris_message_threads(id) on delete cascade,
 last_read_id bigint not null default 0, archived boolean not null default false, primary key(owner_id,thread_id)
);
create table if not exists public.peris_message_blocks(
 owner_id uuid not null references public.players(id) on delete cascade, player_id uuid not null references public.players(id) on delete cascade,
 primary key(owner_id,player_id), check(owner_id<>player_id)
);
create table if not exists public.peris_social_receipts(
 owner_id uuid not null references public.players(id) on delete cascade, request_id uuid not null,
 command jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(owner_id,request_id)
);
do $$declare t text;begin
 foreach t in array array['peris_guilds','peris_guild_roles','peris_guild_members','peris_guild_invitations','peris_guild_applications','peris_guild_relations','peris_guild_log','peris_guild_ledger','peris_message_threads','peris_messages','peris_message_reads','peris_message_blocks','peris_social_receipts']loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
-- All social reads/mutations use bounded, ownership-checked RPCs. No client can
-- select the raw message table, rewrite permissions, or impersonate a sender.
create or replace function public.peris_social_relation(p_a uuid,p_b uuid)returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select case when a.guild_id=b.guild_id then 'guild' else r.kind end
 from public.peris_guild_members a join public.peris_guild_members b on b.player_id=p_b
 left join public.peris_guild_relations r on r.left_id=least(a.guild_id,b.guild_id)and r.right_id=greatest(a.guild_id,b.guild_id)and r.status='active'
 where a.player_id=p_a),'neutral')
$$;
create or replace function public.peris_guild_permission(p_player uuid,p_guild uuid,p_permission text)returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.peris_guild_members m join public.peris_guild_roles r on r.id=m.role_id
 where m.player_id=p_player and m.guild_id=p_guild and r.permissions ? p_permission)
$$;


create or replace function public.peris_guild_card(p_id uuid,p_private boolean default false)returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',g.id,'name',g.name,'tag',g.tag,'description',g.description,
  'motd',case when p_private then g.motd else '' end,'treasury',case when p_private then g.treasury else null end,
  'leader_id',g.leader_id,'recruitment',g.recruitment,'focus',g.focus,'crest',g.crest,'created_at',g.created_at,
  'members',(select count(*)from public.peris_guild_members where guild_id=g.id),
  'cities',(select count(*)from public.settlements s join public.peris_guild_members m on m.player_id=s.owner_id where m.guild_id=g.id),
  'population',(select coalesce(sum(s.population),0)from public.settlements s join public.peris_guild_members m on m.player_id=s.owner_id where m.guild_id=g.id),
  'online',(select count(*)from public.peris_guild_members m join public.peris_account_activity a on a.player_id=m.player_id where m.guild_id=g.id and a.last_seen_at>now()-interval '2 minutes'))
 from public.peris_guilds g where g.id=p_id
$$;

create or replace function public.peris_social_directory(p_kind text default 'guilds',p_search text default '',p_focus text default 'all',p_offset integer default 0)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();rows jsonb;total bigint;
begin
 if u is null or not exists(select 1 from public.players where id=u)then raise exception 'Enter a ruler account first' using errcode='42501';end if;
 if p_kind is null or p_kind not in('guilds','players')or p_search is null or length(p_search)>40 or p_offset is null or p_offset<0 or p_offset>1000000
 or p_focus is null or p_focus not in('all','balanced','warfare','economy','adventure')then raise exception 'Invalid directory filters' using errcode='22023';end if;
 if p_kind='guilds'then
  select count(*)into total from public.peris_guilds where(strpos(lower(name),lower(btrim(p_search)))>0 or strpos(lower(tag),lower(btrim(p_search)))>0)and(p_focus='all'or focus=p_focus);
  select coalesce(jsonb_agg(card order by n),'[]')into rows from(
   select public.peris_guild_card(g.id)card,row_number()over(order by (select count(*)from public.peris_guild_members where guild_id=g.id)desc,lower(g.name),g.id)n
   from public.peris_guilds g where(strpos(lower(name),lower(btrim(p_search)))>0 or strpos(lower(tag),lower(btrim(p_search)))>0)and(p_focus='all'or focus=p_focus)
   order by n offset p_offset limit 24)q;
 else
  select count(*)into total from public.players where id<>u and strpos(lower(display_name),lower(btrim(p_search)))>0;
  select coalesce(jsonb_agg(to_jsonb(q)-'n'order by n),'[]')into rows from(
   select p.id,p.display_name as name,cap.faction,m.guild_id,g.tag guild_tag,a.last_seen_at,
    coalesce(a.last_seen_at>now()-interval '2 minutes',false)online,
    (select count(*)from public.settlements where owner_id=p.id)cities,
    (select coalesce(sum(population),0)from public.settlements where owner_id=p.id)population,
    row_number()over(order by a.last_seen_at desc nulls last,lower(p.display_name),p.id)n
   from public.players p left join public.peris_guild_members m on m.player_id=p.id left join public.peris_guilds g on g.id=m.guild_id
   left join public.peris_account_activity a on a.player_id=p.id
   left join lateral(select faction from public.settlements where owner_id=p.id order by id limit 1)cap on true
   where p.id<>u and strpos(lower(p.display_name),lower(btrim(p_search)))>0 order by n offset p_offset limit 24)q;
 end if;
 return jsonb_build_object('items',rows,'total',total,'server_now',now());
end $$;

create or replace function public.peris_social_guild(p_id uuid)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();own boolean;perms jsonb;result jsonb;
begin
 if u is null or not exists(select 1 from public.players where id=u)then raise exception 'Enter a ruler account first' using errcode='42501';end if;
 if not exists(select 1 from public.peris_guilds where id=p_id)then raise exception 'This guild no longer exists' using errcode='PT404';end if;
 select exists(select 1 from public.peris_guild_members where player_id=u and guild_id=p_id)into own;
 select coalesce(r.permissions,'[]')into perms from public.peris_guild_members m join public.peris_guild_roles r on r.id=m.role_id where m.player_id=u and m.guild_id=p_id;perms:=coalesce(perms,'[]');
 select jsonb_build_object('guild',public.peris_guild_card(p_id,own),'permissions',perms,
  'members',coalesce((select jsonb_agg(to_jsonb(q)order by q.rank desc,lower(q.name))from(
   select p.id,p.display_name name,m.role_id,r.name role_name,r.rank,m.joined_at,m.specialization,cap.faction,
    (select count(*)from public.settlements where owner_id=p.id)cities,(select coalesce(sum(population),0)from public.settlements where owner_id=p.id)population,
    coalesce(a.last_seen_at>now()-interval '2 minutes',false)online,case when own then a.last_seen_at else null end last_seen_at
   from public.peris_guild_members m join public.players p on p.id=m.player_id join public.peris_guild_roles r on r.id=m.role_id
   left join public.peris_account_activity a on a.player_id=p.id left join lateral(select faction from public.settlements where owner_id=p.id order by id limit 1)cap on true where m.guild_id=p_id)q),'[]'),
  'roles',case when own then coalesce((select jsonb_agg(to_jsonb(r)order by rank desc)from public.peris_guild_roles r where guild_id=p_id),'[]')else '[]'::jsonb end,
  'relations',coalesce((select jsonb_agg(to_jsonb(q))from(select r.id,r.left_id,r.right_id,r.proposer_id,r.kind,r.status,g.id other_id,g.name other_name,g.tag other_tag,g.crest
   from public.peris_guild_relations r join public.peris_guilds g on g.id=case when r.left_id=p_id then r.right_id else r.left_id end
   where p_id in(r.left_id,r.right_id)and(r.status='active'or own))q),'[]'),
  'invitations',case when perms ? 'invite'then coalesce((select jsonb_agg(to_jsonb(q))from(
   select i.id,i.guild_id,i.player_id,p.display_name player_name,g.name guild_name,g.tag guild_tag,g.crest,i.created_at,i.expires_at
   from public.peris_guild_invitations i join public.players p on p.id=i.player_id join public.peris_guilds g on g.id=i.guild_id
   where i.guild_id=p_id and i.status='pending'and i.expires_at>now())q),'[]')else '[]'::jsonb end,
  'applications',case when perms ? 'recruitment'then coalesce((select jsonb_agg(to_jsonb(q))from(
   select a.id,a.guild_id,a.player_id,p.display_name player_name,a.body,a.created_at from public.peris_guild_applications a join public.players p on p.id=a.player_id
   where a.guild_id=p_id and a.status='pending'order by a.created_at limit 100)q),'[]')else '[]'::jsonb end,
  'log',case when own then coalesce((select jsonb_agg(to_jsonb(q)order by id desc)from(select id,text,created_at from public.peris_guild_log where guild_id=p_id order by id desc limit 30)q),'[]')else '[]'::jsonb end,
  'ledger',case when own then coalesce((select jsonb_agg(to_jsonb(q)order by id desc)from(select id,player_name,amount,created_at from public.peris_guild_ledger where guild_id=p_id order by id desc limit 30)q),'[]')else '[]'::jsonb end)into result;
 return result;
end $$;

create or replace function public.peris_social_thread(p_kind text,p_id uuid,p_before bigint default null)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();messages jsonb;first_id bigint;older bigint;
begin
 if u is null or p_kind is null or p_kind not in('direct','guild')then raise exception 'Choose a conversation' using errcode='22023';end if;
 if p_kind='direct'and not exists(select 1 from public.peris_message_threads where id=p_id and u in(player_a,player_b))
 or p_kind='guild'and not exists(select 1 from public.peris_guild_members where guild_id=p_id and player_id=u)then raise exception 'This conversation is private' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(q)order by id),'[]'),min(id)into messages,first_id from(
  select id,sender_id,sender_name,body,kind,created_at from public.peris_messages
  where(case when p_kind='direct'then thread_id=p_id else guild_id=p_id end)and(p_before is null or id<p_before)
  order by id desc limit 50)q;
 if exists(select 1 from public.peris_messages where(case when p_kind='direct'then thread_id=p_id else guild_id=p_id end)and id<first_id)then older:=first_id;end if;
 return jsonb_build_object('messages',messages,'before',older,'server_now',now());
end $$;

create or replace function public.peris_social_snapshot()returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();gid uuid;tag text;threads jsonb;invites jsonb;applications jsonb;unread bigint;attention bigint;blocked jsonb;
begin
 if u is null or not exists(select 1 from public.players where id=u)then raise exception 'Enter a ruler account first' using errcode='42501';end if;
 select m.guild_id,g.tag into gid,tag from public.peris_guild_members m join public.peris_guilds g on g.id=m.guild_id where m.player_id=u;
 with inbox as(
  select t.id,'direct'kind,p.display_name name,p.id player_id,null::text guild_tag,null::jsonb crest,last.body last_body,last.created_at last_at,
   (select count(*)from public.peris_messages m where m.thread_id=t.id and m.sender_id is distinct from u and m.id>coalesce(r.last_read_id,0))unread,coalesce(r.archived,false)archived,
   exists(select 1 from public.peris_message_blocks where owner_id=u and player_id=p.id)blocked
  from public.peris_message_threads t join public.players p on p.id=case when t.player_a=u then t.player_b else t.player_a end
  left join public.peris_message_reads r on r.owner_id=u and r.thread_id=t.id
  left join lateral(select body,created_at from public.peris_messages where thread_id=t.id order by id desc limit 1)last on true where u in(t.player_a,t.player_b)
  union all
  select g.id,'guild',g.name,null,g.tag,g.crest,last.body,last.created_at,
   (select count(*)from public.peris_messages msg where guild_id=g.id and sender_id is distinct from u and id>m.last_read_id),false,false
  from public.peris_guilds g join public.peris_guild_members m on m.guild_id=g.id and m.player_id=u
  left join lateral(select body,created_at from public.peris_messages where guild_id=g.id order by id desc limit 1)last on true
 )select coalesce((select jsonb_agg(to_jsonb(q)order by kind desc,last_at desc nulls last)from(select * from inbox order by kind desc,last_at desc nulls last limit 100)q),'[]'),(select coalesce(sum(inbox.unread),0)from inbox)into threads,unread;
 select coalesce(jsonb_agg(to_jsonb(q)order by created_at desc),'[]')into invites from(
  select i.id,i.guild_id,i.player_id,p.display_name player_name,g.name guild_name,g.tag guild_tag,g.crest,i.created_at,i.expires_at
  from public.peris_guild_invitations i join public.peris_guilds g on g.id=i.guild_id join public.players p on p.id=i.player_id
  where i.player_id=u and i.status='pending'and i.expires_at>now())q;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]')into applications from(
  select a.id,a.guild_id,a.player_id,p.display_name player_name,a.body,a.created_at from public.peris_guild_applications a join public.players p on p.id=a.player_id where a.player_id=u and a.status='pending')q;
 select jsonb_array_length(invites)+(select count(*)from public.peris_guild_applications where guild_id=gid and status='pending'and public.peris_guild_permission(u,gid,'recruitment'))+
  (select count(*)from public.peris_guild_relations where gid in(left_id,right_id)and proposer_id<>gid and status='pending'and public.peris_guild_permission(u,gid,'diplomacy'))into attention;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name)),'[]')into blocked from public.peris_message_blocks b join public.players p on p.id=b.player_id where owner_id=u;
 return jsonb_build_object('server_now',now(),'guild_id',gid,'guild_tag',tag,'threads',threads,'invitations',invites,'applications',applications,'attention',attention,'unread',unread,'blocked',blocked);
end $$;


create or replace function public.peris_social_log(p_guild uuid,p_text text)returns void
language sql security definer set search_path='' as $$
 insert into public.peris_guild_log(guild_id,text)values(p_guild,p_text)
$$;
create or replace function public.peris_guild_join(p_guild uuid,p_player uuid)returns void
language plpgsql security definer set search_path='' as $$
declare role uuid;v_name text;
begin
 if exists(select 1 from public.peris_guild_members where player_id=p_player)then raise exception 'This ruler already belongs to a guild' using errcode='PT409';end if;
 if(select count(*)from public.peris_guild_members where guild_id=p_guild)>=60 then raise exception 'This guild is full (60 members)' using errcode='PT409';end if;
 select id into role from public.peris_guild_roles where guild_id=p_guild and key='member';
 if role is null then raise exception 'This guild no longer exists' using errcode='PT404';end if;
 insert into public.peris_guild_members(player_id,guild_id,role_id,last_read_id)
 values(p_player,p_guild,role,coalesce((select max(id)from public.peris_messages where guild_id=p_guild),0));
 update public.peris_guild_invitations set status='cancelled'where player_id=p_player and status='pending';
 update public.peris_guild_applications set status='cancelled'where player_id=p_player and status='pending';
 select display_name into v_name from public.players where id=p_player;
 perform public.peris_social_log(p_guild,v_name||' joined the guild.');
end $$;

create or replace function public.peris_social_command(p_request_id uuid,p_command jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();v_name text;t text:=p_command->>'type';gid uuid;target uuid;other uuid;role uuid;rid uuid;mid bigint;
 g public.peris_guilds%rowtype;m public.peris_guild_members%rowtype;actor public.peris_guild_roles%rowtype;r public.peris_guild_roles%rowtype;
 inv public.peris_guild_invitations%rowtype;app public.peris_guild_applications%rowtype;rel public.peris_guild_relations%rowtype;
 old public.peris_social_receipts%rowtype;result jsonb:='{"ok":true}';perms jsonb;body text;n text;v_tag text;sigil text;color text;kind text;amount bigint;city bigint;last_id bigint;
begin
 if u is null or not exists(select 1 from public.players where id=u)then raise exception 'Enter a ruler account first' using errcode='42501';end if;
 if p_request_id is null or p_command is null or jsonb_typeof(p_command)<>'object'or length(p_command::text)>10000 or t is null then raise exception 'Invalid social request' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,72319));
 select * into old from public.peris_social_receipts where owner_id=u and request_id=p_request_id;
 if old.request_id is not null then
  if old.command<>p_command then raise exception 'A retry must use the original action' using errcode='22023';end if;
  return old.result;
 end if;
 select display_name into v_name from public.players where id=u;
 -- Only guild structural changes share this short lock. DMs and read receipts
 -- for unrelated rulers remain independent. Game ticks never take this lock.
 if t not in('send','read','read_all','archive','block','unblock')then perform pg_advisory_xact_lock(72320);end if;
 select * into m from public.peris_guild_members where player_id=u;gid:=m.guild_id;
 select * into actor from public.peris_guild_roles where id=m.role_id;
 select * into g from public.peris_guilds where id=gid;

 if t='create'or t='edit'then
  n:=btrim(p_command->>'name');v_tag:=upper(btrim(p_command->>'tag'));
  color:=p_command->'crest'->>'color';sigil:=p_command->'crest'->>'sigil';
  if n is null or length(n)not between 3 and 32 or v_tag is null or v_tag!~'^[A-Z0-9]{2,5}$'
  or color is null or color!~'^#[0-9a-fA-F]{6}$'or sigil is null or sigil not in('sun','moon','swords','mountain','star','tower')
  or p_command->>'recruitment'is null or p_command->>'recruitment'not in('open','application','invite')
  or p_command->>'focus'is null or p_command->>'focus'not in('balanced','warfare','economy','adventure')
  or length(coalesce(p_command->>'description',''))>1200 or length(coalesce(p_command->>'motd',''))>800 then raise exception 'Check the guild name, tag and profile' using errcode='22023';end if;
  if exists(select 1 from public.peris_guilds where (lower(peris_guilds.name)=lower(n)or lower(peris_guilds.tag)=lower(v_tag))and(t='create'or id<>gid))then raise exception 'That guild name or tag is already taken' using errcode='PT409';end if;
  if t='create'then
   if gid is not null then raise exception 'Leave your current guild first' using errcode='PT409';end if;
   insert into public.peris_guilds(name,tag,description,motd,leader_id,recruitment,focus,crest)
   values(n,v_tag,coalesce(p_command->>'description',''),coalesce(p_command->>'motd',''),u,p_command->>'recruitment',p_command->>'focus',p_command->'crest')returning id into gid;
   insert into public.peris_guild_roles(guild_id,key,name,rank,permissions)values
   (gid,'leader','Guildmaster',100,'["invite","recruitment","kick","roles","edit","diplomacy","announce","treasury"]'),
   (gid,'officer','Officer',80,'["invite","recruitment","kick","announce"]'),(gid,'member','Member',20,'[]'),(gid,'recruit','Recruit',10,'[]');
   select id into role from public.peris_guild_roles where guild_id=gid and key='leader';
   insert into public.peris_guild_members(player_id,guild_id,role_id)values(u,gid,role);
   update public.peris_guild_invitations set status='cancelled'where player_id=u and status='pending';
   update public.peris_guild_applications set status='cancelled'where player_id=u and status='pending';
   perform public.peris_social_log(gid,v_name||' founded '||n||'.');result:=result||jsonb_build_object('guild_id',gid);
  else
   if not public.peris_guild_permission(u,gid,'edit')then raise exception 'Your rank cannot edit this guild' using errcode='42501';end if;
   update public.peris_guilds set name=n,tag=v_tag,description=coalesce(p_command->>'description',''),motd=coalesce(p_command->>'motd',''),recruitment=p_command->>'recruitment',focus=p_command->>'focus',crest=p_command->'crest'where id=gid;
   perform public.peris_social_log(gid,v_name||' updated the guild profile.');
  end if;
 elsif t='join'or t='apply'then
  target:=(p_command->>'guild_id')::uuid;
  if gid is not null then raise exception 'You already belong to a guild' using errcode='PT409';end if;
  select * into g from public.peris_guilds where id=target;
  if g.id is null then raise exception 'This guild no longer exists' using errcode='PT404';end if;
  if t='join'then
   if g.recruitment<>'open'then raise exception 'This guild requires an application or invitation' using errcode='42501';end if;
   perform public.peris_guild_join(target,u);result:=result||jsonb_build_object('guild_id',target);
  else
   if g.recruitment<>'application'then raise exception 'This guild is not accepting applications' using errcode='PT409';end if;
   if(select count(*)from public.peris_guild_applications where player_id=u and status='pending')>=5 then raise exception 'You can have five pending applications' using errcode='PT409';end if;
   if length(coalesce(p_command->>'body',''))>800 then raise exception 'Keep your application under 800 characters' using errcode='22023';end if;
   insert into public.peris_guild_applications(guild_id,player_id,body)values(target,u,coalesce(p_command->>'body',''))on conflict(guild_id,player_id)where status='pending'do update set body=excluded.body;
  end if;
 elsif t='invite'then
  if not public.peris_guild_permission(u,gid,'invite')then raise exception 'Your rank cannot invite players' using errcode='42501';end if;
  target:=(p_command->>'player_id')::uuid;
  if not exists(select 1 from public.players where id=target)then raise exception 'Ruler not found' using errcode='PT404';end if;
  if exists(select 1 from public.peris_guild_members where player_id=target)then raise exception 'This ruler already belongs to a guild' using errcode='PT409';end if;
  if(select count(*)from public.peris_guild_invitations where guild_id=gid and status='pending'and expires_at>now())>=100 then raise exception 'Review your pending invitations first' using errcode='PT409';end if;
  insert into public.peris_guild_invitations(guild_id,player_id,invited_by)values(gid,target,u)
  on conflict(guild_id,player_id)where status='pending'do update set expires_at=now()+interval '7 days',invited_by=u;
  perform public.peris_social_log(gid,v_name||' invited '||(select display_name from public.players where id=target)||'.');
 elsif t='invitation'or t='cancel_invite'then
  select * into inv from public.peris_guild_invitations where id=(p_command->>'id')::uuid for update;
  if inv.id is null or inv.status<>'pending'then raise exception 'This invitation is no longer pending' using errcode='PT409';end if;
  if t='cancel_invite'then
   if not public.peris_guild_permission(u,inv.guild_id,'invite')then raise exception 'Your rank cannot withdraw this invitation' using errcode='42501';end if;
   update public.peris_guild_invitations set status='cancelled'where id=inv.id;
  else
   if inv.player_id<>u then raise exception 'This is not your invitation' using errcode='42501';end if;
   if inv.expires_at<=now()then raise exception 'This invitation expired' using errcode='PT409';end if;
   if coalesce((p_command->>'accept')::boolean,false)then perform public.peris_guild_join(inv.guild_id,u);result:=result||jsonb_build_object('guild_id',inv.guild_id);end if;
   update public.peris_guild_invitations set status=case when coalesce((p_command->>'accept')::boolean,false)then 'accepted'else 'declined'end where id=inv.id;
  end if;
 elsif t='application'or t='cancel_application'then
  select * into app from public.peris_guild_applications where id=(p_command->>'id')::uuid for update;
  if app.id is null or app.status<>'pending'then raise exception 'This application is no longer pending' using errcode='PT409';end if;
  if t='cancel_application'then
   if app.player_id<>u then raise exception 'This is not your application' using errcode='42501';end if;
   update public.peris_guild_applications set status='cancelled'where id=app.id;
  else
   if not public.peris_guild_permission(u,app.guild_id,'recruitment')then raise exception 'Your rank cannot review applications' using errcode='42501';end if;
   if coalesce((p_command->>'accept')::boolean,false)then perform public.peris_guild_join(app.guild_id,app.player_id);end if;
   update public.peris_guild_applications set status=case when coalesce((p_command->>'accept')::boolean,false)then 'accepted'else 'declined'end where id=app.id;
  end if;
 elsif t='leave'or t='kick'then
  target:=case when t='leave'then u else(p_command->>'player_id')::uuid end;
  select gr.* into r from public.peris_guild_members gm join public.peris_guild_roles gr on gr.id=gm.role_id where gm.player_id=target and gm.guild_id=gid;
  if r.id is null then raise exception 'This ruler is not in your guild' using errcode='PT404';end if;
  if t='kick'and(not public.peris_guild_permission(u,gid,'kick')or target=u or r.rank>=actor.rank)then raise exception 'Your rank cannot remove this member' using errcode='42501';end if;
  if g.leader_id=target then raise exception 'Transfer leadership, or disband the guild, before leaving' using errcode='PT409';end if;
  delete from public.peris_guild_members where player_id=target;
  perform public.peris_social_log(gid,(select display_name from public.players where id=target)||case when t='leave'then ' left the guild.'else ' was removed by '||v_name||'.'end);
 elsif t='role_save'or t='role_delete'then
  if not public.peris_guild_permission(u,gid,'roles')then raise exception 'Your rank cannot manage ranks' using errcode='42501';end if;
  role:=nullif(p_command->>'id','')::uuid;select * into r from public.peris_guild_roles where id=role and guild_id=gid;
  if role is not null and(r.id is null or r.rank>=actor.rank or r.key='leader')then raise exception 'You cannot change this rank' using errcode='42501';end if;
  if t='role_delete'then
   if role is null or r.key in('leader','officer','member','recruit')then raise exception 'Default ranks cannot be deleted' using errcode='22023';end if;
   update public.peris_guild_members set role_id=(select id from public.peris_guild_roles where guild_id=gid and key='member')where role_id=role;
   delete from public.peris_guild_roles where id=role;
  else
   n:=btrim(p_command->>'name');perms:=p_command->'permissions';
   if n is null or length(n)not between 2 and 24 or jsonb_typeof(perms)is distinct from 'array'
   or p_command->>'rank'is null or(p_command->>'rank')::integer not between 1 and 99 or(p_command->>'rank')::integer>=actor.rank
   or exists(select 1 from jsonb_array_elements_text(perms)permission where permission not in('invite','recruitment','kick','roles','edit','diplomacy','announce','treasury')or not(actor.permissions ? permission))then raise exception 'Choose a lower rank and permissions you hold' using errcode='42501';end if;
   if role is null then
    if(select count(*)from public.peris_guild_roles where guild_id=gid)>=12 then raise exception 'You can have 12 ranks' using errcode='PT409';end if;
    insert into public.peris_guild_roles(guild_id,key,name,rank,permissions)values(gid,p_request_id::text,n,(p_command->>'rank')::integer,perms);
   else update public.peris_guild_roles set name=n,rank=(p_command->>'rank')::integer,permissions=perms where id=role;end if;
  end if;
  perform public.peris_social_log(gid,v_name||' updated guild ranks.');
 elsif t='assign_role'or t='specialization'then
  target:=(p_command->>'player_id')::uuid;select gr.* into r from public.peris_guild_members gm join public.peris_guild_roles gr on gr.id=gm.role_id where gm.player_id=target and gm.guild_id=gid;
  if not public.peris_guild_permission(u,gid,'roles')or r.id is null or r.rank>=actor.rank then raise exception 'Your rank cannot manage this member' using errcode='42501';end if;
  if t='specialization'then
   if p_command->>'specialization'is null or p_command->>'specialization'not in('balanced','offense','defense','economy')then raise exception 'Choose a valid specialization' using errcode='22023';end if;
   update public.peris_guild_members set specialization=p_command->>'specialization'where player_id=target;
  else
   select * into r from public.peris_guild_roles where id=(p_command->>'role_id')::uuid and guild_id=gid;
   if r.id is null or r.rank>=actor.rank or r.key='leader'or exists(select 1 from jsonb_array_elements_text(r.permissions)permission where not(actor.permissions ? permission))then raise exception 'Choose a lower rank with permissions you hold' using errcode='42501';end if;
   update public.peris_guild_members set role_id=r.id where player_id=target;
   perform public.peris_social_log(gid,v_name||' changed '||(select display_name from public.players where id=target)||'''s rank to '||r.name||'.');
  end if;
 elsif t='transfer'then
  if g.id is null or g.leader_id<>u then raise exception 'Only the guildmaster can transfer leadership' using errcode='42501';end if;
  target:=(p_command->>'player_id')::uuid;
  if target=u or not exists(select 1 from public.peris_guild_members where player_id=target and guild_id=gid)then raise exception 'Choose another guild member' using errcode='22023';end if;
  update public.peris_guild_members set role_id=(select id from public.peris_guild_roles where guild_id=gid and key=case when player_id=target then 'leader'else 'officer'end)where player_id in(u,target);
  update public.peris_guilds set leader_id=target where id=gid;
  perform public.peris_social_log(gid,v_name||' transferred leadership to '||(select display_name from public.players where id=target)||'.');
 elsif t='disband'then
  if g.id is null or g.leader_id<>u then raise exception 'Only the guildmaster can disband this guild' using errcode='42501';end if;
  if p_command->>'confirmation'is distinct from g.tag then raise exception 'Type the guild tag to confirm' using errcode='22023';end if;
  if g.treasury>0 then raise exception 'Withdraw the guild treasury before disbanding' using errcode='PT409';end if;
  delete from public.peris_guilds where id=gid;
 elsif t='diplomacy'then
  if not public.peris_guild_permission(u,gid,'diplomacy')then raise exception 'Your rank cannot manage diplomacy' using errcode='42501';end if;
  target:=(p_command->>'guild_id')::uuid;kind:=p_command->>'kind';
  if target is null or target=gid or not exists(select 1 from public.peris_guilds where id=target)or kind is null or kind not in('alliance','nap','war')then raise exception 'Choose another guild and a diplomatic relation' using errcode='22023';end if;
  if exists(select 1 from public.peris_guild_relations where left_id=least(gid,target)and right_id=greatest(gid,target))then raise exception 'End or withdraw the existing relation first' using errcode='PT409';end if;
  insert into public.peris_guild_relations(left_id,right_id,proposer_id,kind,status)values(least(gid,target),greatest(gid,target),gid,kind,case when kind='war'then 'active'else 'pending'end);
  perform public.peris_social_log(gid,v_name||case when kind='war'then ' declared war on 'else ' proposed '||case when kind='nap'then 'a non-aggression pact with 'else 'an alliance with 'end end||(select peris_guilds.name from public.peris_guilds where id=target)||'.');
  perform public.peris_social_log(target,'['||g.tag||'] '||g.name||case when kind='war'then ' declared war.'else ' proposed '||case when kind='nap'then 'a non-aggression pact.'else 'an alliance.'end end);
 elsif t='relation_reply'or t='relation_end'then
  select * into rel from public.peris_guild_relations where id=(p_command->>'id')::uuid for update;
  if not public.peris_guild_permission(u,gid,'diplomacy')or rel.id is null or gid not in(rel.left_id,rel.right_id)then raise exception 'Your rank cannot manage this relation' using errcode='42501';end if;
  if t='relation_reply'then
   if rel.status<>'pending'or rel.proposer_id=gid then raise exception 'Only the invited guild can answer this offer' using errcode='42501';end if;
   if coalesce((p_command->>'accept')::boolean,false)then update public.peris_guild_relations set status='active'where id=rel.id;
   else delete from public.peris_guild_relations where id=rel.id;end if;
  else delete from public.peris_guild_relations where id=rel.id;end if;
  perform public.peris_social_log(rel.left_id,v_name||case when t='relation_end'then ' ended the diplomatic relation.'when coalesce((p_command->>'accept')::boolean,false)then ' accepted the diplomatic offer.'else ' declined the diplomatic offer.'end);
  perform public.peris_social_log(rel.right_id,v_name||case when t='relation_end'then ' ended the diplomatic relation.'when coalesce((p_command->>'accept')::boolean,false)then ' accepted the diplomatic offer.'else ' declined the diplomatic offer.'end);
 elsif t='donate'or t='withdraw'then
  amount:=(p_command->>'amount')::bigint;city:=(p_command->>'settlement_id')::bigint;
  if gid is null or amount is null or amount<1 or amount>100000 or not exists(select 1 from public.settlements where id=city and owner_id=u)then raise exception 'Choose your city and 1–100,000 gold' using errcode='22023';end if;
  perform public.peris_settle(u);perform 1 from public.settlements where id=city for update;
  if t='donate'then
   if(select gold from public.settlements where id=city)<amount then raise exception 'This city has insufficient gold' using errcode='PT409';end if;
   update public.settlements set gold=gold-amount where id=city;
   update public.peris_guilds set treasury=treasury+amount where id=gid;
  else
   if not public.peris_guild_permission(u,gid,'treasury')then raise exception 'Your rank cannot withdraw gold' using errcode='42501';end if;
   if g.treasury<amount then raise exception 'Insufficient guild gold' using errcode='PT409';end if;
   if(select gold+amount>capacity from public.settlements where id=city)then raise exception 'This city has insufficient storage space' using errcode='PT409';end if;
   update public.peris_guilds set treasury=treasury-amount where id=gid;
   update public.settlements set gold=gold+amount where id=city;
  end if;
  insert into public.peris_guild_ledger(guild_id,player_id,player_name,amount)values(gid,u,v_name,case when t='donate'then amount else -amount end);
 elsif t='send'or t='announce'then
  body:=btrim(p_command->>'body');kind:=coalesce(p_command->>'kind','direct');
  if body is null or length(body)not between 1 and 2000 or kind not in('direct','guild')then raise exception 'Write a message of 1–2,000 characters' using errcode='22023';end if;
  if(select count(*)from public.peris_messages where sender_id=u and created_at>now()-interval '1 minute')>=30 then raise exception 'You are sending too quickly. Wait a moment.' using errcode='PT429';end if;
  if kind='guild'or t='announce'then
   if gid is null then raise exception 'Join a guild to use its channel' using errcode='42501';end if;
   if t='announce'and not public.peris_guild_permission(u,gid,'announce')then raise exception 'Your rank cannot post announcements' using errcode='42501';end if;
   -- Membership deletion waits until this send finishes.
   perform 1 from public.peris_guild_members where player_id=u and guild_id=gid for key share;
   if not found then raise exception 'Join a guild to use its channel' using errcode='42501';end if;
   insert into public.peris_messages(guild_id,sender_id,sender_name,body,kind)values(gid,u,v_name,body,case when t='announce'then 'announcement'else 'message'end)returning id into mid;
   result:=result||jsonb_build_object('thread_id',gid,'kind','guild','message_id',mid);
  else
   target:=(p_command->>'player_id')::uuid;
   if target is null or target=u or not exists(select 1 from public.players where id=target)then raise exception 'Choose another ruler to message' using errcode='22023';end if;
   if exists(select 1 from public.peris_message_blocks where(owner_id=u and player_id=target)or(owner_id=target and player_id=u))then raise exception 'Messages are blocked between these rulers' using errcode='PT403';end if;
   insert into public.peris_message_threads(player_a,player_b)values(least(u,target),greatest(u,target))on conflict(player_a,player_b)do update set player_a=excluded.player_a returning id into rid;
   insert into public.peris_messages(thread_id,sender_id,sender_name,body)values(rid,u,v_name,body)returning id into mid;
   insert into public.peris_message_reads(owner_id,thread_id,last_read_id)values(u,rid,0),(target,rid,0)
   on conflict(owner_id,thread_id)do update set archived=false;
   result:=result||jsonb_build_object('thread_id',rid,'kind','direct','message_id',mid);
  end if;
 elsif t='read'or t='archive'then
  rid:=(p_command->>'id')::uuid;kind:=p_command->>'kind';
  if kind is null or kind not in('direct','guild')then raise exception 'Choose a conversation' using errcode='22023';end if;
  if kind='direct'then
   if not exists(select 1 from public.peris_message_threads where id=rid and u in(player_a,player_b))then raise exception 'This conversation is private' using errcode='42501';end if;
   select coalesce(max(id),0)into last_id from public.peris_messages where thread_id=rid;
   if t='read'then last_id:=least(last_id,greatest(0,coalesce((p_command->>'up_to')::bigint,0)));end if;
   insert into public.peris_message_reads(owner_id,thread_id,last_read_id,archived)values(u,rid,last_id,case when t='archive'then coalesce((p_command->>'archived')::boolean,true)else false end)
   on conflict(owner_id,thread_id)do update set last_read_id=greatest(public.peris_message_reads.last_read_id,excluded.last_read_id),archived=case when t='archive'then excluded.archived else public.peris_message_reads.archived end;
  else
   if gid is null or rid<>gid or t='archive'then raise exception 'Join this guild to read its channel' using errcode='42501';end if;
   select least(coalesce(max(id),0),greatest(0,coalesce((p_command->>'up_to')::bigint,0)))into last_id from public.peris_messages where guild_id=gid;
   update public.peris_guild_members set last_read_id=greatest(last_read_id,last_id)where player_id=u;
  end if;
 elsif t='read_all'then
  insert into public.peris_message_reads(owner_id,thread_id,last_read_id)
  select u,t.id,coalesce((select max(id)from public.peris_messages where thread_id=t.id),0)from public.peris_message_threads t where u in(t.player_a,t.player_b)
  on conflict(owner_id,thread_id)do update set last_read_id=greatest(public.peris_message_reads.last_read_id,excluded.last_read_id);
  update public.peris_guild_members set last_read_id=greatest(last_read_id,coalesce((select max(id)from public.peris_messages where guild_id=gid),0))where player_id=u;
 elsif t='block'or t='unblock'then
  target:=(p_command->>'player_id')::uuid;
  if target is null or target=u or not exists(select 1 from public.players where id=target)then raise exception 'Choose another ruler' using errcode='22023';end if;
  if t='block'then insert into public.peris_message_blocks(owner_id,player_id)values(u,target)on conflict do nothing;
  else delete from public.peris_message_blocks where owner_id=u and player_id=target;end if;
 else raise exception 'Unknown social action' using errcode='22023';
 end if;
 insert into public.peris_social_receipts(owner_id,request_id,command,result)values(u,p_request_id,p_command,result);
 return result;
end $$;


create or replace function public.peris_prepare_city_raid(p_owner uuid,p_army bigint,p_city bigint,p_path jsonb,p_troops jsonb,p_target text default 'auto')returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.settlements%rowtype;available jsonb;chosen jsonb;unit_name text;
begin
 if p_owner is null then raise exception 'Authentication required';end if;
 if p_target not in('auto','market','barracks','stables','workshop','smithy','warehouse','granary','housing','mage_tower','fishery','lumber','quarry','farm','storehouse','trading_post')then raise exception 'Choose a valid catapult target';end if;
 perform public.peris_settle(p_owner);
 select * into a from public.armies where id=p_army and owner_id=p_owner for update;
 select * into c from public.settlements where id=p_city and owner_id<>p_owner;
 if a.id is null or c.id is null or to_jsonb(c)->>'ruined_at' is not null then raise exception 'Choose your legion and another player''s living city';end if;
 if public.peris_social_relation(p_owner,c.owner_id)in('guild','alliance','nap')then raise exception 'Your guild or diplomatic pact protects this city';end if;
 available:=public.peris_roster(to_jsonb(a));chosen:=public.peris_garrison_troops(coalesce(nullif(p_troops,'null'::jsonb),available));
 if public.peris_roster_total(chosen)=0 then raise exception 'Send at least one soldier';end if;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
  if(chosen->>unit_name)::integer>(available->>unit_name)::integer then raise exception 'Choose troops currently available in this legion';end if;
 end loop;
 perform public.peris_march_for_target(p_owner,a.id,c.x,c.y,p_path,null,c.id);
 perform public.peris_garrison_add(p_owner,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer,public.peris_roster_add(available,chosen,-1));
 perform public.peris_write_roster(a.id,chosen);
 update public.armies set siege_target=p_target,arrival_at=departure_at+make_interval(secs=>greatest(2,march_distance/public.peris_march_speed(id))::double precision)where id=a.id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_start_city_raid(p_owner uuid,p_army bigint)returns bigint
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.settlements%rowtype;defenders jsonb;roster jsonb;leader bigint;bid bigint;wall integer;bonus jsonb;
begin
 select * into a from public.armies where id=p_army and owner_id=p_owner;
 select * into c from public.settlements where id=a.raid_city_id and owner_id<>p_owner;
 if a.id is null or c.id is null or to_jsonb(c)->>'ruined_at' is not null or a.status<>'idle'or a.target_x<>c.x or a.target_y<>c.y then return null;end if;
 -- A pact accepted during travel protects the city when the raid arrives.
 if public.peris_social_relation(p_owner,c.owner_id)in('guild','alliance','nap')then perform public.peris_return_raid(a.id);return null;end if;
 -- Avoid waiting on another ruler while the caller already holds its own lock.
 if exists(select 1 from public.peris_settler_expeditions where owner_id in(p_owner,c.owner_id)and status='travelling'and arrival_at<=public.peris_game_now())and not pg_try_advisory_xact_lock(204200)then return null;end if;
 begin perform 1 from public.players where id in(p_owner,c.owner_id)order by id for update nowait;
 exception when lock_not_available then return null;end;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id in(p_owner,c.owner_id)or defender_owner_id in(p_owner,c.owner_id)))then return null;end if;
 perform public.peris_settle(c.owner_id);
 perform 1 from public.armies where id=a.id for update;
 select * into c from public.settlements where id=c.id for update;
 select coalesce(jsonb_agg(jsonb_build_object('army_id',d.id,'troops',public.peris_roster(to_jsonb(d)))order by d.id),'[]')into defenders
 from public.armies d where d.owner_id=c.owner_id and d.status='idle'and d.raid_target_id is null and d.raid_city_id is null
 and floor(d.target_x/128.0)=floor(c.x/128.0)and floor(d.target_y/128.0)=floor(c.y/128.0);
 select d.id into leader from public.armies d left join public.peris_heroes h on h.army_id=d.id
 where d.owner_id=c.owner_id and d.status='idle'and d.raid_target_id is null and d.raid_city_id is null
 and floor(d.target_x/128.0)=floor(c.x/128.0)and floor(d.target_y/128.0)=floor(c.y/128.0)order by coalesce(h.experience,0)desc,d.id limit 1;
 select public.peris_roster(to_jsonb(g))into roster from public.peris_garrisons g where owner_id=c.owner_id and col=floor(c.x/128.0)::integer and row=floor(c.y/128.0)::integer for update;
 if roster is not null then defenders:=defenders||jsonb_build_array(jsonb_build_object('col',floor(c.x/128.0),'row',floor(c.y/128.0),'troops',roster));end if;
 -- Guild troops remain owned by their sender, and are accounted for individually.
 if to_regclass('public.peris_guild_reinforcements')is not null then
 select defenders||coalesce(jsonb_agg(jsonb_build_object('guild_reinforcement_id',r.id,'troops',r.troops)order by r.id),'[]'::jsonb) into defenders
 from public.peris_guild_reinforcements r
 join public.peris_guild_members sender on sender.player_id=r.owner_id
 join public.peris_guild_members receiver on receiver.player_id=r.recipient_id and receiver.guild_id=sender.guild_id
 where r.target_settlement_id=c.id and r.recipient_id=c.owner_id and r.status='stationed';
 end if;
 select public.peris_roster(g.unit_roster)into roster from public.peris_city_garrisons g where g.settlement_id=c.id and g.owner_id=c.owner_id for update;
 if roster is not null and public.peris_roster_total(roster)>0 then defenders:=defenders||jsonb_build_array(jsonb_build_object('city_garrison_id',c.id,'troops',roster));end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,terrain,difficulty,enemy_name,attacker_ready,defender_ready,defender_faction,raid_city_id,siege_target,city_defenders)
 values(p_owner,c.owner_id,a.id,leader,'pvp','combat',public.peris_battle_terrain(c.x,c.y),'normal',c.name,true,true,c.faction,c.id,a.siege_target,defenders)returning id into bid;
 perform public.peris_add_formations(bid,p_owner,'attacker',a.infantry,a.archers,a.cavalry,90);
 perform public.peris_add_formations(bid,c.owner_id,'defender',0,0,0,90);
 select coalesce(level,0)into wall from public.buildings where settlement_id=c.id and building_type='wall';wall:=coalesce(wall,0);
 bonus:=public.peris_hero_bonuses(leader);
 update public.battle_formations set defence_multiplier=defence_multiplier*(1+public.peris_wall_defence_bonus(wall)),
 attack_multiplier=(1+least(.6,coalesce((select sum(level)*.04 from public.peris_city_slots where settlement_id=c.id and building_type='smithy'),0)))*(bonus->>'damage')::numeric where battle_id=bid and side='defender';
 update public.armies set raid_city_id=null where id=a.id;
 return bid;
end $$;

-- Social-only migration permissions. Campaign helper grants remain untouched.
do $$declare r record;begin
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'and(p.proname like 'peris_social_%'or p.proname like 'peris_guild_%')loop
  execute 'revoke all on function '||r.oid::regprocedure::text||' from public,anon,authenticated';
 end loop;
end $$;
grant execute on function public.peris_social_snapshot(),public.peris_social_directory(text,text,text,integer),public.peris_social_guild(uuid),public.peris_social_thread(text,uuid,bigint),public.peris_social_command(uuid,jsonb)to authenticated;
notify pgrst,'reload schema';

commit;

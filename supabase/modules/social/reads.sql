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


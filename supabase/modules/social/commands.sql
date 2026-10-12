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


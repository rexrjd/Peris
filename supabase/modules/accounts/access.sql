-- Login never allocates; creation never silently takes over an occupied name.
-- A creation UUID makes a lost-response retry safe even after reconnecting.
create or replace function public.peris_enter_account(
 p_display_name text,p_mode text default 'login',p_faction text default null,p_creation_id uuid default null
)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();n text:=btrim(p_display_name);r public.players%rowtype;
 bound uuid;prior public.peris_account_creations%rowtype;receipt jsonb;created boolean:=false;
begin
 if u is null then raise exception 'Authentication required' using errcode='42501';end if;
 if n is null or n!~'^[A-Za-z0-9 _-]{2,20}$'or p_mode is null or p_mode not in('login','create')then
  raise exception 'Choose a valid ruler name and account action' using errcode='22023';end if;
 if p_mode='create' and(p_creation_id is null or p_faction is null or p_faction not in('roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'))then
  raise exception 'Choose a race for your new account' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,72215));
 select player_id into bound from public.peris_account_sessions where auth_id=u;
 if bound is null and exists(select 1 from public.players where id=u)then bound:=u;end if;
 if bound is not null and not exists(select 1 from public.players where id=bound and lower(display_name)=lower(n))then
  raise exception 'Choose a fresh browser session to switch rulers' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(n),72214));
 select * into r from public.players where lower(display_name)=lower(n);
 if p_mode='login' then
  if r.id is null then raise exception 'No account has that name. Choose Create account to start a realm.' using errcode='PT404';end if;
 else
  perform pg_advisory_xact_lock(hashtextextended(p_creation_id::text,72216));
  select * into prior from public.peris_account_creations where request_id=p_creation_id;
  if prior.player_id is not null then
   if r.id is distinct from prior.player_id or prior.faction<>p_faction then
    raise exception 'This creation request belongs to another name or race' using errcode='22023';end if;
  elsif r.id is not null then
   raise exception 'That name already belongs to a ruler. Log in or choose another name.' using errcode='PT422';
  else
   receipt:=public.peris_login(n);
   select * into r from public.players where id=(receipt->>'player_id')::uuid;
   update public.settlements set faction=p_faction where owner_id=r.id;
   update public.armies set name='First host' where owner_id=r.id;
   insert into public.peris_account_creations(request_id,player_id,faction)values(p_creation_id,r.id,p_faction);
  end if;
  created:=true;
 end if;
 receipt:=public.peris_login(n);
 perform public.peris_note_account_activity();
 return receipt||jsonb_build_object('created',created);
end $$;

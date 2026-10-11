-- Intentionally name-only: entering an existing name grants that ruler's control.
create or replace function public.peris_login(p_display_name text)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();n text:=btrim(p_display_name);r public.players%rowtype;bound uuid;created boolean:=false;
begin
 if u is null then raise exception 'Authentication required' using errcode='42501';end if;
 if n is null or n!~'^[A-Za-z0-9 _-]{2,20}$'then
  raise exception 'Use 2-20 letters, numbers, spaces, _ or -' using errcode='22023';end if;
 -- Serialize this browser identity first, then the requested name. Concurrent
 -- first logins with the same name reuse one ruler and one starting estate.
 perform pg_advisory_xact_lock(hashtextextended(u::text,72215));
 select player_id into bound from public.peris_account_sessions where auth_id=u;
 if bound is null and exists(select 1 from public.players where id=u)then bound:=u;end if;
 if bound is not null then
  select * into r from public.players where id=bound;
  if lower(r.display_name)<>lower(n)then
   raise exception 'Choose a fresh browser session to switch rulers' using errcode='PT409';end if;
 else
  perform pg_advisory_xact_lock(hashtextextended(lower(n),72214));
  select * into r from public.players where lower(display_name)=lower(n);
  if r.id is null then
   perform public.create_player(n);
   select * into r from public.players where id=u;
   created:=true;
  end if;
 end if;
 if r.id is null then raise exception 'The ruler account could not be opened';end if;
 insert into public.peris_account_sessions(auth_id,player_id)values(u,r.id)
 on conflict(auth_id)do nothing;
 return jsonb_build_object('player_id',r.id,'display_name',r.display_name,'created',created);
end $$;


-- Optional hooks keep earlier focused migrations usable without enabling scouting.
create or replace function public.peris_optional_scout_missions()returns table(id bigint,owner_id uuid,target_owner_id uuid,source_settlement_id bigint,target_city_id bigint,status text,scouts integer,departure_at timestamptz,arrival_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_scout_missions')is not null then return query execute 'select id,owner_id,target_owner_id,source_settlement_id,target_city_id,status,scouts,departure_at,arrival_at from public.peris_scout_missions where status in(''outbound'',''returning'')';end if;
end $$;
create or replace function public.peris_scout_edges()returns table(owner_id uuid,recipient_id uuid)
language plpgsql stable security definer set search_path='' as $$
begin
 return query select m.owner_id,m.target_owner_id from public.peris_optional_scout_missions()m where m.target_owner_id is not null
 union select m.owner_id,s.owner_id from public.peris_optional_scout_missions()m join public.settlements s on s.id=m.target_city_id;
 if to_regclass('public.peris_scout_missions')is not null then
  return query execute 'select m.owner_id,a.owner_id from public.peris_scout_missions m join public.armies a on a.raid_target_id=m.target_camp_id where m.status=''outbound''
   union select m.owner_id,b.attacker_owner_id from public.peris_scout_missions m join public.battles b on b.camp_id=m.target_camp_id and b.status=''active''where m.status=''outbound''
   union select m.owner_id,n.owner_id from public.peris_scout_missions m join public.peris_scout_missions n on n.target_camp_id=m.target_camp_id and n.id>m.id where m.status=''outbound''and n.status=''outbound''';
 end if;
end $$;
create or replace function public.peris_due_scouts()returns table(owner_id uuid,due timestamptz)
language sql stable security definer set search_path='' as $$select owner_id,min(arrival_at)from public.peris_optional_scout_missions()where arrival_at<=public.peris_game_now()group by owner_id$$;
create or replace function public.peris_optional_advance_scouts(p_owners uuid[],p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
begin if to_regprocedure('public.peris_scout_advance(uuid[],timestamp with time zone)')is not null then execute 'select public.peris_scout_advance($1,$2)'using p_owners,p_at;end if;end $$;
revoke all on function public.peris_optional_scout_missions(),public.peris_scout_edges(),public.peris_due_scouts(),public.peris_optional_advance_scouts(uuid[],timestamptz)from public,anon,authenticated;

create or replace function public.peris_scout_camp_cutoff(p_camp integer,p_until timestamptz)returns timestamptz
language plpgsql stable security definer set search_path='' as $$
declare cutoff timestamptz;
begin
 if to_regclass('public.peris_scout_missions')is not null then execute 'select min(arrival_at)from public.peris_scout_missions where target_camp_id=$1 and status=''outbound'''into cutoff using p_camp;end if;
 return least(p_until,coalesce(cutoff,p_until));
end $$;
revoke all on function public.peris_scout_camp_cutoff(integer,timestamptz)from public,anon,authenticated;

create or replace function public.peris_optional_scout_camp_mutation(p_camp integer,p_at timestamptz,p_owner uuid)returns void
language plpgsql security definer set search_path='' as $$
begin if p_camp is not null and to_regprocedure('public.peris_scout_flush_camp(integer,timestamp with time zone,uuid)')is not null then execute 'select public.peris_scout_flush_camp($1,$2,$3)'using p_camp,p_at,p_owner;end if;end $$;
revoke all on function public.peris_optional_scout_camp_mutation(integer,timestamptz,uuid)from public,anon,authenticated;

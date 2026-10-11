-- New orders wait thirty wall-clock seconds before leaving. Existing routes and saves retain their timing.
alter table public.armies add column if not exists march_sent_at timestamptz;
alter table public.armies add column if not exists march_cancel_until timestamptz;
alter table public.armies add column if not exists raid_reserve jsonb;

create or replace function public.peris_restore_raid_reserve(p_army bigint)returns void
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;
begin select * into a from public.armies where id=p_army for update;
 if a.raid_reserve is not null then perform public.peris_write_roster(a.id,public.peris_roster_add(public.peris_roster(to_jsonb(a)),a.raid_reserve));update public.armies set raid_reserve=null where id=a.id;end if;
end $$;

create or replace function public.peris_cancel_march(p_army bigint,p_sent_at timestamptz)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where id=p_army and owner_id=u for update;
 if a.id is null then raise exception 'Choose one of your armies';end if;
 if p_sent_at is null or a.march_sent_at is distinct from p_sent_at then raise exception 'This march is no longer the same order';end if;
 if a.status<>'moving' or a.march_cancel_until is null or now()>=a.march_cancel_until or now()<a.march_sent_at then
  raise exception 'Marches can only be cancelled during the first 30 seconds';
 end if;
 perform public.peris_restore_raid_reserve(a.id);
 update public.armies set status='idle',raid_target_id=null,target_x=start_x,target_y=start_y,
  departure_at=now(),arrival_at=now(),march_path=null,march_distance=null,march_sent_at=null,march_cancel_until=null,march_origin=null,march_returning=false,updated_at=now()
  where id=a.id;
 perform public.peris_garrison_merge(a.id);
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_prepare_raid_for(p_owner uuid,p_army bigint,p_camp integer,p_path jsonb default null,p_troops jsonb default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;a public.armies%rowtype;c public.peris_camps%rowtype;inf integer;arc integer;cav integer;route jsonb;steps integer;i integer;available jsonb;preset jsonb;unit_name text;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where id=p_army and owner_id=u for update;
 select * into c from public.peris_camps where id=p_camp;
 if c.id is null then raise exception 'Camp not found';end if;
 if a.id is null or a.infantry+a.archers+a.cavalry=0 then raise exception 'Recruit soldiers before starting a raid';end if;
 if a.status<>'idle' or a.raid_target_id is not null or a.raid_reserve is not null then raise exception 'This legion already has a march or raid';end if;
 if not c.bandit and exists(select 1 from public.peris_progress where owner_id=u and camp_id=p_camp and available_at>now())then raise exception 'The camp is still regrouping';end if;
 if p_troops is not null then
  if jsonb_typeof(p_troops)<>'object' then raise exception 'Choose troops currently available in this legion';end if;
  available:=public.peris_roster(to_jsonb(a));preset:=public.peris_garrison_troops(p_troops);
  foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
   if (preset->>unit_name)::integer>(available->>unit_name)::integer then raise exception 'Choose troops currently available in this legion';end if;
  end loop;
  if public.peris_roster_total(preset)=0 then raise exception 'Send at least one soldier';end if;
 end if;
 route:=p_path;
 if route is null then
  steps:=greatest(1,ceil(greatest(abs(public.peris_wrapped_delta(a.target_x,c.x)),abs(public.peris_wrapped_delta(a.target_y,c.y)))/64)::integer);
  route:=jsonb_build_array(jsonb_build_array(a.target_x,a.target_y));
  for i in 1..steps loop route:=route||jsonb_build_array(jsonb_build_array(public.peris_wrap_world(round(a.target_x+public.peris_wrapped_delta(a.target_x,c.x)*i/steps)::integer),public.peris_wrap_world(round(a.target_y+public.peris_wrapped_delta(a.target_y,c.y)*i/steps)::integer)));end loop;
 end if;
 perform public.peris_march_for(u,a.id,c.x,c.y,route,c.id);
 update public.armies set raid_target_id=c.id where id=a.id;
 if p_troops is not null then
  perform public.peris_garrison_add(u,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer,public.peris_roster_add(available,preset,-1));
  perform public.peris_write_roster(a.id,preset);
 end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_prepare_raid(p_camp integer,p_path jsonb default null,p_troops jsonb default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if u is null then raise exception 'Authentication required';end if;
 return public.peris_prepare_raid_for(u,public.peris_army_id(u),p_camp,p_path,p_troops);
end $$;

create or replace function public.peris_return_raid(p_army bigint)returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;route jsonb;seconds numeric;
begin
 select * into a from public.armies where id=p_army for update;
 if a.march_returning then return true;end if;
 if a.id is null or a.march_origin is null or a.march_path is null or a.march_distance is null then return false;end if;
 select jsonb_agg(value order by ordinal desc) into route from jsonb_array_elements(a.march_path)with ordinality as points(value,ordinal);
 seconds:=greatest(2,a.march_distance/(22*(public.peris_hero_bonuses(a.id)->>'speed')::numeric));
 update public.armies set start_x=a.target_x,start_y=a.target_y,target_x=(a.march_origin->>'x')::integer,target_y=(a.march_origin->>'y')::integer,
  march_path=route,status='moving',raid_target_id=null,march_returning=true,march_sent_at=null,march_cancel_until=null,
  departure_at=now(),arrival_at=now()+make_interval(secs=>seconds::double precision),updated_at=now() where id=a.id;
 return true;
end $$;

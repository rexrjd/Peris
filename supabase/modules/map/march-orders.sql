-- New orders wait thirty wall-clock seconds before leaving. Existing routes and saves retain their timing.
alter table public.armies add column if not exists march_sent_at timestamptz;
alter table public.armies add column if not exists march_cancel_until timestamptz;
alter table public.armies add column if not exists raid_reserve jsonb;

create or replace function public.peris_restore_raid_reserve(p_army bigint)returns void
language sql security definer set search_path='' as $$
 update public.armies set
 infantry=infantry+coalesce((raid_reserve->>'infantry')::integer,0),
 archers=archers+coalesce((raid_reserve->>'archers')::integer,0),
 cavalry=cavalry+coalesce((raid_reserve->>'cavalry')::integer,0),raid_reserve=null
 where id=p_army and raid_reserve is not null
$$;

create or replace function public.peris_cancel_march(p_army bigint,p_sent_at timestamptz)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;
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

create or replace function public.peris_prepare_raid(p_camp integer,p_path jsonb default null,p_troops jsonb default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;c public.peris_camps%rowtype;inf integer;arc integer;cav integer;previous_target text;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where id=public.peris_army_id(u) for update;
 select * into c from public.peris_camps where id=p_camp;
 if c.id is null then raise exception 'Camp not found';end if;
 if a.id is null or a.infantry+a.archers+a.cavalry=0 then raise exception 'Recruit soldiers before starting a raid';end if;
 if a.status<>'idle' or a.raid_target_id is not null or a.raid_reserve is not null then raise exception 'This legion already has a march or raid';end if;
 if exists(select 1 from public.peris_progress where owner_id=u and camp_id=p_camp and available_at>now())then raise exception 'The camp is still regrouping';end if;
 if p_troops is not null then
  if jsonb_typeof(p_troops)<>'object' then raise exception 'Choose troops currently available in this legion';end if;
  inf:=(p_troops->>'infantry')::integer;arc:=(p_troops->>'archers')::integer;cav:=(p_troops->>'cavalry')::integer;
  if inf is null or arc is null or cav is null or inf<0 or arc<0 or cav<0 or inf>a.infantry or arc>a.archers or cav>a.cavalry then raise exception 'Choose troops currently available in this legion';end if;
  if inf+arc+cav=0 then raise exception 'Send at least one soldier';end if;
 end if;
 previous_target:=current_setting('peris.raid_target',true);perform set_config('peris.raid_target',c.id::text,true);
 if p_path is null then perform public.move_army(c.x,c.y);else perform public.peris_march(c.x,c.y,p_path);end if;
 perform set_config('peris.raid_target',coalesce(previous_target,''),true);
 update public.armies set raid_target_id=c.id where id=a.id;
 if p_troops is not null then
  perform public.peris_garrison_add(u,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer,
   jsonb_build_object('infantry',a.infantry-inf,'archers',a.archers-arc,'cavalry',a.cavalry-cav));
  update public.armies set infantry=inf,archers=arc,cavalry=cav where id=a.id;
 end if;
 return jsonb_build_object('ok',true);
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

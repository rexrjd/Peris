-- Private campaign plans reference real bandit camps and owned legions.

-- Saved metadata has no recurring timer; manual starts reuse authoritative raid commands.

create table if not exists public.peris_campaign_farm_lists (

 id bigint generated always as identity primary key,

 owner_id uuid not null references public.players(id) on delete cascade,

 name text not null check(char_length(btrim(name)) between 2 and 40),

 troops jsonb not null, casualties_only boolean not null default false,

 unique(id,owner_id)

);

create table if not exists public.peris_campaign_farms (

 id bigint generated always as identity primary key,

 owner_id uuid not null references public.players(id) on delete cascade,

 list_id bigint not null, camp_id integer not null references public.peris_camps(id),

 army_id bigint not null references public.armies(id) on delete cascade,

 troops jsonb not null, created_at timestamptz not null default now(),

 foreign key(list_id,owner_id) references public.peris_campaign_farm_lists(id,owner_id) on delete cascade,

 unique(list_id,camp_id)

);

create index if not exists peris_campaign_farm_lists_owner on public.peris_campaign_farm_lists(owner_id,id);

create index if not exists peris_campaign_farms_owner on public.peris_campaign_farms(owner_id,list_id,id);

alter table public.peris_campaign_farms add column if not exists sent bigint not null default 0 check(sent>=0);
alter table public.peris_campaign_farms add column if not exists skipped bigint not null default 0 check(skipped>=0);

alter table public.peris_campaign_farm_lists enable row level security;

alter table public.peris_campaign_farms enable row level security;

revoke all on public.peris_campaign_farm_lists,public.peris_campaign_farms from public,anon,authenticated;

grant select on public.peris_campaign_farm_lists,public.peris_campaign_farms to authenticated;

drop policy if exists "own campaign farm lists" on public.peris_campaign_farm_lists;

create policy "own campaign farm lists" on public.peris_campaign_farm_lists for select to authenticated using(owner_id=public.peris_player_id());

drop policy if exists "own campaign farms" on public.peris_campaign_farms;

create policy "own campaign farms" on public.peris_campaign_farms for select to authenticated using(owner_id=public.peris_player_id());



create or replace function public.peris_campaign_farm_troops(p_troops jsonb,p_allow_empty boolean)

returns jsonb language plpgsql immutable set search_path='' as $$

declare result jsonb:=public.peris_roster(p_troops);

begin

 if public.peris_roster_total(result)>1000 or (not p_allow_empty and public.peris_roster_total(result)=0)then raise exception 'Save a party of 1–1000 soldiers';end if;

 return result;

end $$;



create or replace function public.peris_campaign_farm_command(p_command jsonb)

returns jsonb language plpgsql security definer set search_path='' as $$

declare

 u uuid:=public.peris_player_id();kind text:=p_command->>'type';v_entry_id bigint;v_list_id bigint;v_camp_id integer;v_army_id bigint;

 preset jsonb;list_name text;losses_only boolean;list public.peris_campaign_farm_lists;farm public.peris_campaign_farms;v_duplicate_id bigint;

 started integer:=0;skipped jsonb:='[]';batch_path jsonb;previous_army text;previous_city text;target_army public.armies%rowtype;repeat_enabled boolean;repeat_interval integer;
 selected_ids bigint[];selected_id jsonb;selected_count integer;v_action text;

begin

 if u is null then raise exception 'Authentication required';end if;

 if jsonb_typeof(p_command) is distinct from 'object' then raise exception 'Choose a campaign farm command';end if;

 -- Settlement takes the global founding lock before its owner lock when needed.

 if kind='startCampaignFarmList' then perform public.peris_settle(u);end if;

 -- Serialize one owner's saves/deletes so list limits and duplicate checks are atomic.

 perform 1 from public.players where id=u for update;

 if not found then raise exception 'Create your realm first';end if;

 if p_command ? 'id' then

  if jsonb_typeof(p_command->'id') is distinct from 'number' or (p_command->>'id')::numeric<>trunc((p_command->>'id')::numeric) or (p_command->>'id')::numeric not between 1 and 9007199254740991 then raise exception 'Choose a valid saved farm';end if;

  v_entry_id:=(p_command->>'id')::bigint;

 end if;

 if kind='manageCampaignFarmTargets' then
  if jsonb_typeof(p_command->'ids') is distinct from 'array' then raise exception 'Choose saved targets';end if;
  selected_count:=jsonb_array_length(p_command->'ids');
  if selected_count not between 1 and 100 then raise exception 'Choose up to 100 targets';end if;
  selected_ids:=array[]::bigint[];
  for selected_id in select value from jsonb_array_elements(p_command->'ids')loop
   if jsonb_typeof(selected_id) is distinct from 'number' then raise exception 'Choose valid saved targets';end if;
   if selected_id::text::numeric<>trunc(selected_id::text::numeric) or selected_id::text::numeric not between 1 and 9007199254740991 then raise exception 'Choose valid saved targets';end if;
   selected_ids:=array_append(selected_ids,selected_id::text::bigint);
  end loop;
  if (select count(distinct id)from unnest(selected_ids)ids(id))<>selected_count or (select count(*)from public.peris_campaign_farms where owner_id=u and id=any(selected_ids))<>selected_count then raise exception 'Choose your own saved targets';end if;
  v_action:=p_command->>'action';
  if v_action='delete' then delete from public.peris_campaign_farms where owner_id=u and id=any(selected_ids);
  elsif v_action='move' then
   if jsonb_typeof(p_command->'listId') is distinct from 'number' then raise exception 'Choose your own destination list';end if;
   if (p_command->>'listId')::numeric<>trunc((p_command->>'listId')::numeric) then raise exception 'Choose your own destination list';end if;
   v_list_id:=(p_command->>'listId')::bigint;
   if not exists(select 1 from public.peris_campaign_farm_lists where id=v_list_id and owner_id=u)then raise exception 'Choose your own destination list';end if;
   if (select count(*)from public.peris_campaign_farms where list_id=v_list_id and not(id=any(selected_ids)))+selected_count>100 then raise exception 'A campaign farm list holds up to 100 targets';end if;
   if exists(select camp_id from public.peris_campaign_farms where (list_id=v_list_id and not(id=any(selected_ids)))or(owner_id=u and id=any(selected_ids))group by camp_id having count(*)>1)then raise exception 'A selected camp is already in the destination list';end if;
   update public.peris_campaign_farms set list_id=v_list_id where owner_id=u and id=any(selected_ids);
  else raise exception 'Choose move or delete';end if;
  return jsonb_build_object('ok',true,'changed',selected_count);
 elsif kind in('setCampaignFarmListEnabled','applyCampaignFarmListTroops')then
  select * into list from public.peris_campaign_farm_lists where id=v_entry_id and owner_id=u;
  if not found then raise exception 'Choose your own farm list';end if;
  if kind='applyCampaignFarmListTroops'then
   preset:=public.peris_campaign_farm_troops(list.troops,false);
   update public.peris_campaign_farms set troops=preset where list_id=list.id and owner_id=u;
  else
   if jsonb_typeof(p_command->'enabled') is distinct from 'boolean'then raise exception 'Choose a repeat preference';end if;
   repeat_enabled:=(p_command->>'enabled')::boolean;
   update public.peris_campaign_farms set enabled=repeat_enabled,next_at=case when repeat_enabled then public.peris_game_now()+make_interval(secs=>interval_seconds)else null end,last_status=case when repeat_enabled then 'Scheduled'else 'Paused'end where list_id=list.id and owner_id=u and enabled is distinct from repeat_enabled;
  end if;
  return jsonb_build_object('ok',true);
 elsif kind='startCampaignFarmList' then

  if not exists(select 1 from public.peris_campaign_farm_lists where id=v_entry_id and owner_id=u)then raise exception 'Choose your own farm list';end if;

  if p_command ? 'routes' and jsonb_typeof(p_command->'routes') is distinct from 'array' then raise exception 'Choose valid farm routes';end if;

  previous_army:=current_setting('peris.army_id',true);previous_city:=current_setting('peris.city_id',true);

  for farm in select f.* from public.peris_campaign_farms f where f.list_id=v_entry_id and f.owner_id=u order by f.id for update loop

   -- A failed target rolls back its own preparation; other available legions still depart.

   begin

    select * into target_army from public.armies where id=farm.army_id and owner_id=u for update;

    if target_army.id is null then raise exception 'Choose your own legion';end if;

    if not exists(select 1 from public.peris_camps where id=farm.camp_id and bandit)then raise exception 'Only bandit camps can be started from a farm list';end if;

    preset:=public.peris_campaign_farm_troops(farm.troops,false);

    batch_path:=null;

    if p_command ? 'routes' then

     select r->'path' into batch_path from jsonb_array_elements(p_command->'routes')r where r->>'targetId'=farm.id::text limit 1;

     if batch_path is null then raise exception 'No connected land route is available for this target';end if;

    end if;

    perform set_config('peris.army_id',farm.army_id::text,true);perform set_config('peris.city_id',target_army.home_settlement_id::text,true);

    perform public.peris_prepare_raid(farm.camp_id,batch_path,preset);

    update public.armies set farm_list_id=farm.list_id where id=farm.army_id;

    update public.peris_campaign_farms set route=(select march_path from public.armies where id=farm.army_id),last_status='Raid preparing',sent=sent+1 where id=farm.id;
    started:=started+1;

   exception when others then

    update public.peris_campaign_farms set last_status=sqlerrm,skipped=peris_campaign_farms.skipped+1 where id=farm.id;
    skipped:=skipped||jsonb_build_array(jsonb_build_object('targetId',farm.id,'reason',sqlerrm));

   end;

  end loop;

  perform set_config('peris.army_id',coalesce(previous_army,''),true);perform set_config('peris.city_id',coalesce(previous_city,''),true);

  if started=0 then raise exception 'No raids started. %',coalesce(skipped->0->>'reason','Add camp targets to this list first.');end if;

  return jsonb_build_object('started',started,'skipped',skipped);

 elsif kind='saveCampaignFarmList' then

  if jsonb_typeof(p_command->'name') is distinct from 'string' then raise exception 'Use a farm list name of 2–40 characters';end if;

  list_name:=btrim(p_command->>'name');

  if char_length(list_name) not between 2 and 40 then raise exception 'Use a farm list name of 2–40 characters';end if;

  if jsonb_typeof(p_command->'casualtiesOnly') is distinct from 'boolean' then raise exception 'Choose a report preference';end if;

  preset:=public.peris_campaign_farm_troops(p_command->'troops',true);losses_only:=(p_command->>'casualtiesOnly')::boolean;

  if v_entry_id is null then

   if (select count(*)from public.peris_campaign_farm_lists where owner_id=u)>=50 then raise exception 'You can save up to 50 campaign farm lists';end if;

   insert into public.peris_campaign_farm_lists(owner_id,name,troops,casualties_only)values(u,list_name,preset,losses_only)returning * into list;

  else

   update public.peris_campaign_farm_lists set name=list_name,troops=preset,casualties_only=losses_only where id=v_entry_id and owner_id=u returning * into list;

   if not found then raise exception 'Choose your own farm list';end if;

  end if;

  return to_jsonb(list);

 elsif kind='saveCampaignFarm' then

  foreach list_name in array array['listId','campId','armyId'] loop

   if jsonb_typeof(p_command->list_name) is distinct from 'number' or (p_command->>list_name)::numeric<>trunc((p_command->>list_name)::numeric) or (p_command->>list_name)::numeric not between 1 and 9007199254740991 then raise exception 'Choose a farm list, camp and legion';end if;

  end loop;

  v_list_id:=(p_command->>'listId')::bigint;v_camp_id:=(p_command->>'campId')::integer;v_army_id:=(p_command->>'armyId')::bigint;

  if not exists(select 1 from public.peris_campaign_farm_lists l where l.id=v_list_id and l.owner_id=u)then raise exception 'Choose your own farm list';end if;

  if not exists(select 1 from public.peris_camps c where c.id=v_camp_id and c.bandit)then raise exception 'Only bandit camps can be saved. Story locations are manual encounters';end if;

  perform 1 from public.armies a where a.id=v_army_id and a.owner_id=u for share;

  if not found then raise exception 'Choose your own legion';end if;

  preset:=public.peris_campaign_farm_troops(p_command->'troops',false);

  select f.id into v_duplicate_id from public.peris_campaign_farms f where f.owner_id=u and f.list_id=v_list_id and f.camp_id=v_camp_id;

  if v_entry_id is null then v_entry_id:=v_duplicate_id;

  else

   select * into farm from public.peris_campaign_farms f where f.id=v_entry_id and f.owner_id=u;

   if not found then raise exception 'Choose your own saved farm';end if;

   if v_duplicate_id is not null and v_duplicate_id<>v_entry_id then raise exception 'This camp is already in that farm list';end if;

  end if;

  if v_entry_id is not null and farm.id is null then select * into farm from public.peris_campaign_farms f where f.id=v_entry_id and f.owner_id=u;end if;

  if (farm.id is null or farm.list_id<>v_list_id) and (select count(*)from public.peris_campaign_farms f where f.list_id=v_list_id)>=100 then raise exception 'A campaign farm list holds up to 100 targets';end if;

  if v_entry_id is null then

   insert into public.peris_campaign_farms(owner_id,list_id,camp_id,army_id,troops)values(u,v_list_id,v_camp_id,v_army_id,preset)returning * into farm;

  else

   update public.peris_campaign_farms f set list_id=v_list_id,camp_id=v_camp_id,army_id=v_army_id,troops=preset,route=case when f.army_id=v_army_id and f.camp_id=v_camp_id then f.route else null end where f.id=v_entry_id and f.owner_id=u returning * into farm;

  end if;

  if p_command ? 'enabled' and jsonb_typeof(p_command->'enabled')<>'boolean'then raise exception 'Choose a repeat preference';end if;
  repeat_enabled:=coalesce((p_command->>'enabled')::boolean,farm.enabled,false);
  repeat_interval:=coalesce((p_command->>'intervalSeconds')::integer,farm.interval_seconds,300);
  if repeat_interval not between 60 and 86400 then raise exception 'Use a repeat interval of 60–86400 seconds';end if;
  update public.peris_campaign_farms set enabled=repeat_enabled,interval_seconds=repeat_interval,
   next_at=case when repeat_enabled then case when enabled and interval_seconds=repeat_interval then coalesce(next_at,public.peris_game_now()+make_interval(secs=>repeat_interval))else public.peris_game_now()+make_interval(secs=>repeat_interval)end else null end
   where id=farm.id returning * into farm;
  return to_jsonb(farm);

 elsif kind='deleteCampaignFarm' then

  delete from public.peris_campaign_farms where id=v_entry_id and owner_id=u;

  if not found then raise exception 'Choose your own saved farm';end if;

 elsif kind='deleteCampaignFarmList' then

  if not exists(select 1 from public.peris_campaign_farm_lists where id=v_entry_id and owner_id=u)then raise exception 'Choose your own farm list';end if;

  if exists(select 1 from public.peris_campaign_farms f where f.list_id=v_entry_id)then raise exception 'Remove or move this list’s targets before deleting it';end if;

  delete from public.peris_campaign_farm_lists where id=v_entry_id and owner_id=u;

 else raise exception 'Choose a campaign farm command';

 end if;

 return jsonb_build_object('ok',true);

end $$;

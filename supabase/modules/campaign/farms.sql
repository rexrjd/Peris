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
alter table public.peris_campaign_farm_lists enable row level security;
alter table public.peris_campaign_farms enable row level security;
revoke all on public.peris_campaign_farm_lists,public.peris_campaign_farms from public,anon,authenticated;
grant select on public.peris_campaign_farm_lists,public.peris_campaign_farms to authenticated;
drop policy if exists "own campaign farm lists" on public.peris_campaign_farm_lists;
create policy "own campaign farm lists" on public.peris_campaign_farm_lists for select to authenticated using(owner_id=auth.uid());
drop policy if exists "own campaign farms" on public.peris_campaign_farms;
create policy "own campaign farms" on public.peris_campaign_farms for select to authenticated using(owner_id=auth.uid());

create or replace function public.peris_campaign_farm_troops(p_troops jsonb,p_allow_empty boolean)
returns jsonb language plpgsql immutable set search_path='' as $$
declare role_name text; amount numeric; total numeric:=0; result jsonb:='{}';
begin
 if jsonb_typeof(p_troops) is distinct from 'object' then raise exception 'Choose a troop preset';end if;
 foreach role_name in array array['infantry','archers','cavalry'] loop
  if jsonb_typeof(p_troops->role_name) is distinct from 'number' then raise exception 'Choose whole troop counts';end if;
  amount:=(p_troops->>role_name)::numeric;
  if amount<>trunc(amount) or amount<0 or amount>1000 then raise exception 'Choose whole troop counts from 0 to 1000';end if;
  total:=total+amount;result:=result||jsonb_build_object(role_name,amount::integer);
 end loop;
 if total>1000 or (not p_allow_empty and total=0) then raise exception 'Save a party of 1–1000 soldiers';end if;
 return result;
end $$;

create or replace function public.peris_campaign_farm_command(p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid();kind text:=p_command->>'type';v_entry_id bigint;v_list_id bigint;v_camp_id integer;v_army_id bigint;
 preset jsonb;list_name text;losses_only boolean;list public.peris_campaign_farm_lists;farm public.peris_campaign_farms;v_duplicate_id bigint;
 started integer:=0;skipped jsonb:='[]';batch_path jsonb;previous_army text;previous_city text;target_army public.armies%rowtype;
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
 if kind='startCampaignFarmList' then
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
    started:=started+1;
   exception when others then
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
   update public.peris_campaign_farms f set list_id=v_list_id,camp_id=v_camp_id,army_id=v_army_id,troops=preset where f.id=v_entry_id and f.owner_id=u returning * into farm;
  end if;
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

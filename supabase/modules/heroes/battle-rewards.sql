-- Repeated camp victories can award gear without reusing a first-clear key.
alter table public.peris_hero_artifacts add column if not exists source_battle_id bigint references public.battles(id) on delete set null;
create unique index if not exists peris_hero_battle_drop on public.peris_hero_artifacts(owner_id,source_battle_id);

create or replace function public.peris_npc_artifact(p_tier integer,p_camp integer,p_battle bigint)returns text
language sql immutable set search_path='' as $$
 select pool[1+mod(abs(mod(p_battle,1000003))*17+abs(p_camp::bigint)*31,array_length(pool,1))::integer]
 from(select case when p_tier>=5 then array['warblade','runestaff','plate','windboots','warhelm','crown_seal']
 when p_tier>=3 then array['warblade','runestaff','plate','windboots','warhelm']
 else array['iron_sword','oak_staff','chainmail','circlet','boots','talisman','warhelm']end pool)roll
$$;

create or replace function public.peris_battle_hero_reward(p_army bigint,p_experience integer,p_camp integer,p_battle bigint)returns jsonb
language plpgsql security definer set search_path='' as $$
declare h public.peris_heroes%rowtype;after_xp integer;drop_id bigint;artifact text;tier integer;full_bag boolean:=false;items jsonb:='[]';existing jsonb;faction text;
begin
 select result->'hero_reward' into existing from public.battles where id=p_battle and mode='pve';
 if existing is not null and existing<>'null'::jsonb then return existing;end if;
 select * into h from public.peris_heroes where army_id=p_army for update;
 if h.id is null then return null;end if;
 perform public.peris_hero_reward(p_army,p_experience,null);
 select experience into after_xp from public.peris_heroes where id=h.id;
 select s.faction into faction from public.armies a join public.settlements s on s.id=a.home_settlement_id where a.id=p_army;
 if p_camp is not null then
  select count(*)>=200 into full_bag from public.peris_hero_artifacts where owner_id=h.owner_id;
  if not full_bag then
   select c.tier into tier from public.peris_camps c where c.id=p_camp;
   artifact:=public.peris_npc_artifact(tier,p_camp,p_battle);
   insert into public.peris_hero_artifacts(owner_id,artifact_id,slot,source_battle_id)
   select h.owner_id,c.id,c.slot,p_battle from public.peris_artifact_catalog c where c.id=artifact
   on conflict(owner_id,source_battle_id)do nothing returning id into drop_id;
   if drop_id is not null then items:=jsonb_build_array(jsonb_build_object('id',drop_id,'artifact_id',artifact));end if;
  end if;
 end if;
 return jsonb_build_object('hero_id',h.id,'hero_name',h.name,'hero_class',h.class,'faction',faction,
 'experience',after_xp-h.experience,'experience_before',h.experience,'experience_after',after_xp,
 'level_before',public.peris_hero_level(h.experience),'level_after',public.peris_hero_level(after_xp),
 'artifacts',items,'inventory_full',full_bag);
end $$;

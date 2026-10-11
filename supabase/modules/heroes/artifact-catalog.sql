-- Generated from heroes/domain/artifacts.ts. Keep catalog stats and loot pools identical.
insert into public.peris_artifact_catalog(id,name,slot,attack,defence,power,knowledge,speed)values
('iron_sword','Iron oath','weapon',2,0,0,0,0),
('oak_staff','Staff of embers','weapon',0,0,2,0,0),
('chainmail','Guardian mail','armour',0,2,0,0,0),
('circlet','Scholar’s circlet','head',0,0,0,2,0),
('boots','Wayfarer’s boots','boots',0,0,0,0,0.15),
('talisman','Amber talisman','charm',0,0,1,1,0),
('warblade','Dawnblade','weapon',4,0,0,0,0),
('runestaff','Staff of the archmage','weapon',0,0,4,0,0),
('plate','Crownforged plate','armour',0,4,0,0,0),
('warhelm','Helm of command','head',2,1,0,0,0),
('windboots','Windwalkers','boots',0,0,0,0,0.25),
('runic_amulet','Runic amulet','charm',0,0,2,2,0),
('sunblade','Sunfire edge','weapon',6,1,0,0,0),
('astral_staff','Astral staff','weapon',0,0,6,1,0),
('phoenix_mail','Phoenix mantle','armour',0,6,1,0,0),
('oracle_crown','Oracle’s crown','head',0,0,2,4,0),
('stormstride','Stormstriders','boots',0,1,0,0,0.35),
('moonstone_heart','Heart of the moon','charm',0,0,3,3,0),
('lionheart_blade','Lionheart','weapon',8,2,0,0,0),
('celestial_staff','Celestial spire','weapon',0,0,8,2,0),
('aegis_plate','Aegis of the dawn','armour',2,8,0,0,0),
('sovereign_crown','Sovereign’s crown','head',2,2,0,6,0),
('horizon_boots','Horizon treads','boots',0,0,0,2,0.45),
('crown_seal','Seal of the lost crown','charm',2,2,2,2,0)
on conflict(id)do update set name=excluded.name,slot=excluded.slot,attack=excluded.attack,defence=excluded.defence,power=excluded.power,knowledge=excluded.knowledge,speed=excluded.speed;

create or replace function public.peris_npc_artifact(p_tier integer,p_camp integer,p_battle bigint)returns text
language sql immutable set search_path='' as $$
 select pool[1+mod(abs(mod(p_battle,1000003))*17+abs(p_camp::bigint)*31,array_length(pool,1))::integer]
 from(select case when p_tier>=9 then array['lionheart_blade','celestial_staff','aegis_plate','sovereign_crown','horizon_boots','crown_seal'] when p_tier>=6 then array['sunblade','astral_staff','phoenix_mail','oracle_crown','stormstride','moonstone_heart'] when p_tier>=3 then array['warblade','runestaff','plate','warhelm','windboots','runic_amulet'] else array['iron_sword','oak_staff','chainmail','circlet','boots','talisman'] end pool)roll
$$;

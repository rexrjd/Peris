import fs from 'node:fs/promises';
import { ARTIFACTS, ARTIFACT_POOLS } from '../src/features/heroes/domain/artifacts.ts';
const q = value => "'" + value.replaceAll("'", "''") + "'";
const rows = Object.entries(ARTIFACTS).map(([id,a]) => `(${q(id)},${q(a.name)},${q(a.slot)},${a.attack??0},${a.defence??0},${a.power??0},${a.knowledge??0},${a.speed??0})`).join(',\n');
const pool = rarity => 'array[' + ARTIFACT_POOLS[rarity].map(q).join(',') + ']';
const sql = `-- Generated from heroes/domain/artifacts.ts. Keep catalog stats and loot pools identical.\ninsert into public.peris_artifact_catalog(id,name,slot,attack,defence,power,knowledge,speed)values\n${rows}\non conflict(id)do update set name=excluded.name,slot=excluded.slot,attack=excluded.attack,defence=excluded.defence,power=excluded.power,knowledge=excluded.knowledge,speed=excluded.speed;\n\ncreate or replace function public.peris_npc_artifact(p_tier integer,p_camp integer,p_battle bigint)returns text\nlanguage sql immutable set search_path='' as $$\n select pool[1+mod(abs(mod(p_battle,1000003))*17+abs(p_camp::bigint)*31,array_length(pool,1))::integer]\n from(select case when p_tier>=9 then ${pool('Legendary')} when p_tier>=6 then ${pool('Epic')} when p_tier>=3 then ${pool('Rare')} else ${pool('Common')} end pool)roll\n$$;\n`;
const file = 'supabase/modules/heroes/artifact-catalog.sql';
if (process.argv.includes('--check')) { if ((await fs.readFile(file,'utf8')).replace(/\r\n/g,'\n') !== sql) throw Error('Stale artifact catalog: run npm run build:artifact-catalog'); }
else await fs.writeFile(file,sql);
console.log(`${Object.keys(ARTIFACTS).length} artifact definitions ${process.argv.includes('--check')?'match':'generated'}`);

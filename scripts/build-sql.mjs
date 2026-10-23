import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const manifest=JSON.parse(await fs.readFile(path.join(root,'supabase/modules/manifest.json'),'utf8'))
const normalizeNewlines=text=>text.replace(/\r\n/g,'\n')
const readSource=async file=>normalizeNewlines(await fs.readFile(file,'utf8'))
const chunks=await Promise.all(manifest.map(file=>readSource(path.join(root,'supabase/modules',file))))
const upgrade=chunks.join('')
const body=upgrade.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')
const fresh=(await readSource(path.join(root,'supabase/modules/install/fresh-base.sql')))+body+(await readSource(path.join(root,'supabase/modules/install/fresh-tail.sql')))
const signupFix='-- PERIS multiplayer signup hotfix for an existing V10-V13 world.\n-- Replaces allocation only; preserves accounts, cities, armies, loot and world data.\n-- Run this entire file in Supabase SQL Editor, then retry the same ruler name.\nbegin;\n\n'+(await readSource(path.join(root,'supabase/modules/accounts/create_player.sql')))+"\nrevoke all on function public.create_player(text) from public,anon;\ngrant execute on function public.create_player(text) to authenticated;\nnotify pgrst,'reload schema';\ncommit;\n"
const outputs={'UPGRADE_TO_V13.sql':upgrade,'FRESH_INSTALL_V13.sql':fresh,'UPGRADE_TO_V12.sql':upgrade,'FRESH_INSTALL_V12.sql':fresh,'UPGRADE_TO_V11.sql':upgrade,'FRESH_INSTALL_V11.sql':fresh,'UPGRADE_TO_V10.sql':upgrade,'FRESH_INSTALL_V10.sql':fresh,'UPGRADE_TO_V9.sql':upgrade,'FRESH_INSTALL_V9.sql':fresh,'UPGRADE_TO_V8.sql':upgrade,'UPGRADE_TO_V7.sql':upgrade,'UPGRADE_V5_TO_V6.sql':upgrade,'schema.sql':upgrade,'FRESH_INSTALL_V8.sql':fresh,'FRESH_INSTALL_V7.sql':fresh,'FRESH_INSTALL_V6.sql':fresh}
const citySlotsSource=await readSource(path.join(root,'supabase/modules/city/city-slots.sql'))
const slotFunctionStart=citySlotsSource.indexOf('create or replace function public.peris_queue_slot(')
const slotFunctionEnd=citySlotsSource.indexOf('\nrevoke all on function',slotFunctionStart)
if(slotFunctionStart<0||slotFunctionEnd<0)throw Error('Missing city slot function')
outputs['UPGRADE_UNIQUE_BARRACKS.sql']='-- PERIS: one new barracks per city. Existing buildings, queues and troops are preserved.\n-- Apply to the current game schema; safe to run again. No table rewrite or new constraint.\nbegin;\n'+citySlotsSource.slice(slotFunctionStart,slotFunctionEnd)+"\nrevoke all on function public.peris_queue_slot(integer,text) from public,anon,authenticated;\ngrant execute on function public.peris_queue_slot(integer,text) to authenticated;\nnotify pgrst,'reload schema';\ncommit;\n"
outputs['UPGRADE_CITY_ENVIRONMENT.sql']='-- PERIS: new fisheries require nearby map water. Existing fisheries and queues are preserved.\n-- Apply to an existing current world after review. No geography, table or saved city is rewritten.\nbegin;\n'+citySlotsSource.slice(slotFunctionStart,slotFunctionEnd)+"\nrevoke all on function public.peris_queue_slot(integer,text) from public,anon,authenticated;\ngrant execute on function public.peris_queue_slot(integer,text) to authenticated;\nnotify pgrst,'reload schema';\ncommit;\n"
// Focused upgrade includes only changed rules and functions, never whole modules
// containing seed data or unrelated migrations.
const balanceFunctions=[['empire/gameplay.sql',['peris_apply_hero']],['campaign/camp-schema.sql',['peris_roster_loss_cost','peris_deliver_loot']],['campaign/player-raids.sql',['peris_finish_city_raid']]]
const selectedBalanceFunctions=[]
for(const [file,names]of balanceFunctions){
 const source=await readSource(path.join(root,'supabase/modules',file))
 const definitions=source.match(/create or replace function public\.[\s\S]*?\$\$;/g)??[]
 for(const name of names){const matches=definitions.filter(def=>def.startsWith('create or replace function public.'+name+'('));if(!matches.length)throw Error('Missing balance function '+name);selectedBalanceFunctions.push(...matches)}
}
const balanceSources=await Promise.all(['install/unit-balance-guard.sql','army/unit-balance.sql','army/unit-balance-catalog.sql','army/battle-balance.sql','battle/peris_add_formations.sql','battle/peris_finish.sql','snapshot/peris_snapshot.sql'].map(file=>readSource(path.join(root,'supabase/modules',file))))
outputs['UPGRADE_UNIT_BALANCE.sql']=balanceSources.join('\n')+'\n'+selectedBalanceFunctions.join('\n')+"\nrevoke all on function public.peris_apply_hero(bigint,uuid,text),public.peris_add_formations(bigint,uuid,text,integer,integer,integer,numeric),public.peris_finish(bigint,text,text),public.peris_finish_city_raid(bigint,text,text),public.peris_roster_loss_cost(jsonb,jsonb),public.peris_roster_loss_cost(jsonb,jsonb,integer),public.peris_deliver_loot(bigint) from public,anon,authenticated;\nrevoke all on function public.peris_snapshot() from public,anon;\ngrant execute on function public.peris_snapshot() to authenticated;\nnotify pgrst,'reload schema';\ncommit;\n"
outputs['FIX_MULTIPLAYER_SIGNUP.sql']=signupFix
outputs['FRONTIER_LOCAL.sql']='-- Generated by scripts/build-sql.mjs. Local Frontier server only.\n'+(await readSource(path.join(root,'supabase/modules/frontier/local.sql')))
outputs['UPGRADE_TO_V16.sql']=upgrade
outputs['FRESH_INSTALL_V16.sql']=fresh
const socialFiles=['social/schema.sql','social/reads.sql','social/commands.sql','social/upgrade-permissions.sql']
const socialChunks=await Promise.all(socialFiles.map(file=>readSource(path.join(root,'supabase/modules',file))))
const raidSource=await readSource(path.join(root,'supabase/modules/campaign/player-raids.sql'))
const raidGuardFunctions=['peris_prepare_city_raid','peris_start_city_raid'].map(name=>{
 const start=raidSource.indexOf('create or replace function public.'+name+'(')
 if(start<0)throw Error('Missing raid function '+name)
 const end=raidSource.indexOf('\ncreate or replace function ',start+1)
 return raidSource.slice(start,end<0?undefined:end)
}).join('\n')
outputs['UPGRADE_GUILDS_TO_V19.sql']='-- PERIS V19 guilds and messages, for an existing V18 world.\n-- Keeps campaign tables, science, armies and unrelated function definitions unchanged.\nbegin;\ndo $$begin if to_regprocedure(\'public.peris_research_factor(uuid,text)\')is null or to_regprocedure(\'public.peris_player_id()\')is null then raise exception \'Install the V18 account/research update first, or use UPGRADE_TO_V19.sql.\';end if;end $$;\n'+socialChunks.slice(0,3).join('\n')+'\n'+raidGuardFunctions+'\n'+socialChunks[3]+'\ncommit;\n'
outputs['UPGRADE_TO_V19.sql']=upgrade
outputs['FRESH_INSTALL_V19.sql']=fresh
outputs['UPGRADE_TO_V18.sql']=upgrade
outputs['FRESH_INSTALL_V18.sql']=fresh
outputs['UPGRADE_TO_V17.sql']=upgrade
outputs['FRESH_INSTALL_V17.sql']=fresh
outputs['UPGRADE_TO_V14.sql']=upgrade
outputs['FRESH_INSTALL_V14.sql']=fresh
outputs['UPGRADE_TO_V15.sql']=upgrade
outputs['FRESH_INSTALL_V15.sql']=fresh

// Focused guild-defence upgrade for an existing V19 + City Logistics database.
const guildSupport=await readSource(path.join(root,'supabase/modules/city/guild-reinforcements.sql'))
const guildFunctions=[]
for (const [file,names] of [
 ['campaign/player-raids.sql',['peris_start_city_raid','peris_finish_city_raid']],
 ['city/peris_settle.sql',['peris_settle']],
 ['campaign/game-worker.sql',['peris_game_tick']],
 ['city/ruins.sql',['peris_ruin_city']],
 ['snapshot/peris_snapshot.sql',['peris_snapshot']],
 ['security/command-receipts.sql',['peris_submit_command']]
]) {
 const source=await readSource(path.join(root,'supabase/modules',file))
 const definitions=source.match(/create or replace function public\.[\s\S]*?\$\$;/g)??[]
 for(const name of names){const definition=definitions.find(text=>text.startsWith('create or replace function public.'+name+'('))
 if(!definition)throw Error('Missing guild reinforcement dependency: '+name)
 guildFunctions.push(definition)}
}
outputs['UPGRADE_GUILD_REINFORCEMENTS.sql']=[
 '-- Apply AFTER City Logistics and V19 Guilds. No existing garrisons are reassigned.',
 'begin;',guildSupport,...guildFunctions,"notify pgrst,'reload schema';",'commit;'
].join('\n')

const cityGarrisonModule=await readSource(path.join(root,'supabase/modules/city/city-garrisons.sql'))
const ruinModule=await readSource(path.join(root,'supabase/modules/city/ruins.sql'))
const ruinDefinitions=[
 ['empire/schema.sql',['peris_city_id','peris_army_id','peris_scope_order']],
 ['map/garrisons.sql',['peris_station_owned']],
 ['empire/gameplay.sql',['peris_culture_rate','peris_found_complete','peris_empire_command']],
 ['map/peris_march.sql',['peris_march_for_target']],
 ['map/march-orders.sql',['peris_return_raid']],
 ['campaign/sync_my_state.sql',['peris_sync_owner']],
 ['city/peris_settle.sql',['peris_settle']],
 ['campaign/player-raids.sql',['peris_prepare_city_raid','peris_start_city_raid','peris_damage_city','peris_finish_city_raid']],
 ['snapshot/peris_snapshot.sql',['peris_snapshot']],
 ['snapshot/peris_map_snapshot.sql',['peris_map_snapshot']],
 ['security/command-receipts.sql',['peris_submit_command']],
]
const ruinFunctions=[]
for(const[file,names] of ruinDefinitions){
 const source=await readSource(path.join(root,'supabase/modules',file))
 const defs=source.match(/create or replace function public\.[\s\S]*?\$\$;/g)??[]
 for(const name of names){const def=defs.find(x=>x.startsWith('create or replace function public.'+name+'('))
  if(!def)throw Error('City ruins migration missing '+file+':'+name)
  ruinFunctions.push(def)
 }
}
outputs['UPGRADE_CITY_RUINS.sql']=[
 '-- PERIS permanent city ruins: focused upgrade for an existing V19 database.',
 '-- REVIEW FIRST. Back up your database. Not automatically deployed.',
 'begin;',
 cityGarrisonModule,
 ruinModule,
 ...ruinFunctions,
 'revoke all on function public.peris_ruin_route(uuid,integer,integer),public.peris_ruin_redirect_army(bigint),public.peris_ruin_advance(uuid,timestamptz),public.peris_ruin_city(bigint) from public,anon,authenticated;',
 "notify pgrst,'reload schema';",
 'commit;'
].join('\n')

// Deploy this focused module after the city ruins migration. It changes only
// garrison storage/commands, city-siege resolution, the snapshot and evacuation.
const garrisonFunctions=[
 ['empire/gameplay.sql',['peris_empire_command']],
 ['campaign/player-raids.sql',['peris_start_city_raid','peris_finish_city_raid']],
 ['city/ruins.sql',['peris_ruin_city']],
 ['snapshot/peris_snapshot.sql',['peris_snapshot']],
]
const garrisonDefinitions=[]
for(const [file,names] of garrisonFunctions){
 const source=await readSource(path.join(root,'supabase/modules',file))
 const definitions=source.match(/create or replace function public\.[\s\S]*?\$\$;/g)??[]
 for(const name of names){
  const definition=definitions.find(x=>x.startsWith('create or replace function public.'+name+'('))
  if(!definition)throw Error('City garrisons migration missing '+file+':'+name)
  garrisonDefinitions.push(definition)
 }
}
outputs['UPGRADE_CITY_GARRISONS.sql']=[
 '-- PERIS permanent city garrisons. Run after UPGRADE_CITY_RUINS.sql.',
 '-- Back up your realm first. Do not mix with an in-progress migration.',
 'begin;',
 "do $$ begin if to_regprocedure('public.peris_ruin_city(bigint)') is null then raise exception 'Apply UPGRADE_CITY_RUINS.sql first'; end if; end $$;",
 cityGarrisonModule,
 ...garrisonDefinitions,
 "notify pgrst,'reload schema';",
 'commit;'
].join('\n')

// Focused, idempotent upgrade for direct-garrison training and timed city-to-city
// shipments. Requires the already deployed city-garrison/ruins feature.
const cityLogisticsSource=await readSource(path.join(root,'supabase/modules/city/garrison-logistics.sql'))
const logisticsDependencies=[
 ['empire/schema.sql',['peris_scope_order']],
 ['army/peris_queue_recruit.sql',['peris_queue_recruit_to','peris_queue_recruit']],
 ['city/peris_settle.sql',['peris_settle']],
 ['empire/gameplay.sql',['peris_empire_command']],
 ['city/ruins.sql',['peris_ruin_city']],
 ['snapshot/peris_snapshot.sql',['peris_snapshot']],
 ['campaign/game-worker.sql',['peris_game_tick']],
 ['city/ruins.sql',['peris_ruin_city']],
]
const logisticsDefinitions=[]
for(const [file,names] of logisticsDependencies){
 const source=await readSource(path.join(root,'supabase/modules',file))
 const definitions=source.match(/create or replace function public\.[\s\S]*?\$\$;/g)??[]
 for(const name of names){
  const definition=definitions.find(x=>x.startsWith('create or replace function public.'+name+'('))
  if(!definition)throw Error('Garrison logistics migration missing '+file+':'+name)
  logisticsDefinitions.push(definition)
 }
}
outputs['UPGRADE_CITY_LOGISTICS.sql']=[
 '-- PERIS: direct city-garrison recruitment and marching garrison reinforcements.',
 '-- Apply after UPGRADE_CITY_GARRISONS.sql, once. No existing units are changed.',
 'begin;',
 "do $$ begin if to_regclass('public.peris_city_garrisons') is null or to_regprocedure('public.peris_ruin_city(bigint)') is null then raise exception 'Apply the existing City Ruins and City Garrisons updates first'; end if; end $$;",
 cityLogisticsSource,
 ...logisticsDefinitions,
 "notify pgrst,'reload schema';",
 'commit;',
].join('\n')

// Market is a separate reviewed migration; no geography, seeds or unrelated state.
const marketDependencies=[]
for(const [file,names]of[
 ['city/city-slots.sql',['peris_queue_slot']],
 ['city/peris_settle.sql',['peris_settle_core','peris_settle']],
 ['snapshot/peris_snapshot.sql',['peris_snapshot']],
 ['campaign/game-worker.sql',['peris_game_tick']],
 ['security/command-receipts.sql',['peris_submit_command']],
]){
 const source=await readSource(path.join(root,'supabase/modules',file))
 const defs=source.match(/create or replace function public\.[\s\S]*?\$\$;/g)??[]
 for(const name of names){const def=defs.find(x=>x.startsWith('create or replace function public.'+name+'('));if(!def)throw Error('Missing Market dependency '+name);marketDependencies.push(def)}
}
outputs['UPGRADE_MARKET.sql']=[
 '-- PERIS Market caravans. Apply after V19 + City Logistics + Guild Reinforcements. Review separately; never deployed automatically.',
 'begin;',
 "do $$begin if to_regprocedure('public.peris_game_tick(integer)')is null or to_regprocedure('public.peris_guild_reinforcements_advance(uuid,timestamp with time zone)')is null then raise exception 'Install V19, City Logistics and Guild Reinforcements first';end if;end $$;",
 "alter table public.peris_city_slots drop constraint if exists peris_city_slots_building_type_check;",
 "alter table public.peris_city_slots add constraint peris_city_slots_building_type_check check(building_type in('barracks','stables','workshop','smithy','warehouse','granary','fishery','mage_tower','housing','academy','bazaar'));",
 await readSource(path.join(root,'supabase/modules/city/market.sql')),
 await readSource(path.join(root,'supabase/modules/city/market-hooks.sql')),
 ...marketDependencies,
 'revoke all on function public.peris_settle_core(uuid,timestamptz),public.peris_settle(uuid,timestamptz)from public,anon,authenticated;',
 "notify pgrst,'reload schema';",'commit;'
].join('\n')

// Focused installers also ship the private dependency of extracted finalizers.
const participantLocks=await readSource(path.join(root,'supabase/modules/battle/participant-locks.sql'))
const guildHooks=await readSource(path.join(root,'supabase/modules/city/guild-reinforcement-hooks.sql'))
const marketHooks=await readSource(path.join(root,'supabase/modules/city/market-hooks.sql'))
const settleSource=await readSource(path.join(root,'supabase/modules/city/peris_settle.sql'))
const settleCore=(settleSource.match(/create or replace function public\.[\s\S]*?\$\$;/g)??[]).find(x=>x.startsWith('create or replace function public.peris_settle_core('))
const gameClock=await readSource(path.join(root,'supabase/modules/time/game-clock.sql'))
for(const[name,content]of Object.entries(outputs)){
 let complete=content
 if(complete.includes('public.peris_settle_core(')&&!complete.includes('create or replace function public.peris_settle_core('))complete=complete.replace(/^begin;$/m,()=> 'begin;\n'+settleCore+'\nrevoke all on function public.peris_settle_core(uuid,timestamptz)from public,anon,authenticated;\n')
 if((complete.includes('public.peris_optional_trade_caravans()')||complete.includes('public.peris_due_trade_caravans()'))&&!complete.includes('create or replace function public.peris_optional_trade_caravans()'))complete=complete.replace(/^begin;$/m,()=> 'begin;\n'+marketHooks)
 if((complete.includes('public.peris_optional_guild_reinforcements()')||complete.includes('public.peris_due_guild_reinforcements()'))&&!complete.includes('create or replace function public.peris_optional_guild_reinforcements()'))complete=complete.replace(/^begin;$/m,()=> 'begin;\n'+guildHooks)
 if(complete.includes('public.peris_lock_battle_participants(')&&!complete.includes('create or replace function public.peris_lock_battle_participants(')){
  if(!/^begin;$/m.test(complete))throw Error('Missing transaction boundary for participant dependency: '+name)
  complete=complete.replace(/^begin;$/m,()=> 'begin;\n'+participantLocks)
 }
 if(complete.includes('public.peris_game_now()')&&!complete.includes('create or replace function public.peris_game_now()')){
  if(!/^begin;$/m.test(complete))throw Error('Missing transaction boundary for clock dependency: '+name)
  complete=complete.replace(/^begin;$/m,()=> 'begin;\n'+gameClock)
 }
 outputs[name]=complete
}
for(const[file,content]of Object.entries(outputs)){const target=path.join(root,'supabase',file);if(process.argv.includes('--check')){if(await readSource(target)!==content)throw Error('Stale SQL bundle: '+file)}else{let existing;try{existing=await readSource(target)}catch(error){if(error.code!=='ENOENT')throw error}if(existing!==content)await fs.writeFile(target,content)}}
console.log(process.argv.includes('--check')?'SQL bundles match modular source':'SQL bundles rebuilt')

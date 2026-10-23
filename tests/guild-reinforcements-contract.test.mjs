import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {strict as assert} from 'node:assert';
const text = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const sql=text('supabase/modules/city/guild-reinforcements.sql');
const raids=text('supabase/modules/campaign/player-raids.sql');
const settle=text('supabase/modules/city/peris_settle.sql');
const worker=text('supabase/modules/campaign/game-worker.sql');
const editor=text('src/features/social/ui/GuildReinforcementDialog.tsx');
const hooks=text('supabase/modules/city/guild-reinforcement-hooks.sql');
const rpc=text('src/engine/online/rpcCommands.ts');
test('guild reinforcements are authorized on the server and troops remain with sender',()=>{
 assert.match(sql,/join public\.peris_guild_members b on b\.guild_id=a\.guild_id/);
 assert.match(sql,/r\.owner_id=public\.peris_player_id\(\) or r\.recipient_id=public\.peris_player_id\(\)/);
 assert.match(sql,/peris_garrison_troops\(p_troops\)/);
 assert.match(sql,/remaining:=public\.peris_roster_add\(stock,selected,-1\)/);
 assert.match(sql,/status='stationed'/);
 assert.match(sql,/status='returning'/);
 assert.doesNotMatch(sql,/grant\s+(update|insert|delete)\s+on\s+public\.peris_guild_reinforcements\s+to\s+authenticated/i);
});
test('guild reinforcements join autobattle and take actual casualties',()=>{
 assert.match(raids,/guild_reinforcement_id.*r\.id/);
 assert.match(raids,/party \? 'guild_reinforcement_id'/);
 assert.match(raids,/peris_roster_add\(current_roster,losses,-1\)/);
 assert.match(sql,/status='active'.*continue/);
});
test('offline worker handles shipments and due arrivals',()=>{
 assert.match(worker,/peris_due_guild_reinforcements/);
 assert.match(hooks,/r.status in\('outbound','returning'\)/);
 assert.match(settle,/peris_guild_reinforcements_advance\(p_owner,p_until\)/);
});
test('member picker uses authoritative commands and Events supports sender-owned recall',()=>{
 assert.match(text('src/features/social/ui/GuildsPanel.tsx'),/Send reinforcements to/);
 assert.match(rpc,/peris_send_guild_reinforcements/);
 assert.match(editor,/peris_guild_reinforcement_targets/);
 assert.match(rpc,/peris_recall_guild_reinforcements/);
 assert.match(text('src/features/map/ui/MapOperations.tsx'),/support.owner_id===playerId/);
});

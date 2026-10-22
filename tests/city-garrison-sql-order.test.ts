import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('offline city defence is present in the generated fresh installation and focused upgrade',()=>{
  const fresh=readFileSync('supabase/FRESH_INSTALL_V19.sql','utf8');
  const upgrade=readFileSync('supabase/UPGRADE_CITY_GARRISONS.sql','utf8');
  const idx=(sql:string,term:string)=>{const i=sql.indexOf(term);assert.ok(i>=0,`missing ${term}`);return i;};
  assert.ok(idx(fresh,'create table if not exists public.peris_city_garrisons')<idx(fresh,'create or replace function public.peris_start_city_raid('));
  assert.ok(idx(fresh,'create table if not exists public.peris_city_garrisons')<idx(fresh,'create or replace function public.peris_snapshot('));
  const ruins=readFileSync('supabase/UPGRADE_CITY_RUINS.sql','utf8');
  assert.ok(idx(ruins,'create table if not exists public.peris_city_garrisons')<idx(ruins,'create or replace function public.peris_ruin_city('));
  for(const name of ['peris_wall_defence_bonus','peris_manage_city_garrison','peris_start_city_raid','peris_finish_city_raid','peris_ruin_city','peris_snapshot'])
    assert.ok(upgrade.includes('create or replace function public.'+name+'('),name);
  assert.match(upgrade,/defence_multiplier=defence_multiplier\*\(1\+public\.peris_wall_defence_bonus\(wall\)\)/);
  assert.ok(!upgrade.includes('effective*.06'));
});

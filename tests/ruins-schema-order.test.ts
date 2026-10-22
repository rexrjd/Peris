import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const sourceRoot = 'supabase/modules/';
const earliestRuinsColumn = 'alter table public.settlements add column if not exists ruined_at timestamptz;';
const earliestDefeatColumn = 'alter table public.players add column if not exists defeated_at timestamptz;';

// SQL-language functions are validated at CREATE FUNCTION, not at first use.
// These columns must exist before peris_station_owned() is defined.
test('ruins columns precede SQL-language functions in generated fresh and upgrade bundles', async () => {
  const manifest = JSON.parse(await readFile(sourceRoot + 'manifest.json', 'utf8')) as string[];
  const baseIndex = manifest.indexOf('schema/base.sql');
  const preludeIndex = manifest.indexOf('city/ruins-columns.sql');
  const stationIndex = manifest.indexOf('map/garrisons.sql');
  const ruinsIndex = manifest.indexOf('city/ruins.sql');
  assert.ok(baseIndex >= 0 && baseIndex < preludeIndex);
  assert.ok(preludeIndex < stationIndex && stationIndex < ruinsIndex);

  const prelude = await readFile(sourceRoot + 'city/ruins-columns.sql', 'utf8');
  assert.ok(prelude.includes(earliestRuinsColumn));
  assert.ok(prelude.includes(earliestDefeatColumn));

  for (const filename of ['FRESH_INSTALL_V16.sql', 'FRESH_INSTALL_V17.sql', 'FRESH_INSTALL_V19.sql', 'UPGRADE_TO_V19.sql']) {
    const sql = (await readFile('supabase/' + filename, 'utf8')).toLowerCase();
    const columnPosition = sql.indexOf(earliestRuinsColumn);
    const defeatPosition = sql.indexOf(earliestDefeatColumn);
    const stationPosition = sql.indexOf('create or replace function public.peris_station_owned(');
    assert.ok(columnPosition >= 0 && defeatPosition >= 0 && stationPosition >= 0, filename + ': missing SQL fragment');
    assert.ok(columnPosition < stationPosition && defeatPosition < stationPosition, filename + ': ruins schema created too late');
  }
});

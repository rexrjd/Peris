import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

test('every generated battle installer supplies the private participant guard before use', () => {
    for (const name of readdirSync('supabase').filter(name => name.endsWith('.sql'))) {
        const sql = readFileSync('supabase/' + name, 'utf8');
        if (!sql.includes('public.peris_lock_battle_participants(')) continue;
        assert.ok(sql.includes('create or replace function public.peris_lock_battle_participants('), name + ' needs the participant helper');
        assert.ok(sql.includes('revoke all on function public.peris_lock_battle_participants(uuid,uuid)from public,anon,authenticated;'), name + ' must keep the helper private');
    }
});

test('focused installers embed prerequisite SQL literally, including dollar-quoted function bodies', () => {
    for (const [source, signature] of [
        ['time/game-clock.sql', 'create or replace function public.peris_game_now()'],
        ['battle/participant-locks.sql', 'create or replace function public.peris_lock_battle_participants('],
    ]) {
        const body = readFileSync('supabase/modules/' + source, 'utf8').replace(/\r\n/g, '\n').trim();
        for (const name of readdirSync('supabase').filter(name => name.endsWith('.sql'))) {
            const sql = readFileSync('supabase/' + name, 'utf8').replace(/\r\n/g, '\n');
            if (sql.includes(signature)) assert.ok(sql.includes(body), name + ' must retain the complete literal ' + source);
        }
    }
});

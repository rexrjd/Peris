import { test, expect } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { startPractice } from '../../src/features/battle/domain/practice';

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true })));
});

test('launcher unit preview and faction Quick Battle are normal game flows', async ({ page }, info) => {
    test.setTimeout(150000);
    const errors: string[] = [], models: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const logs: string[] = []; page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') logs.push(message.text()); });
    page.on('request', request => { if (request.url().includes('.glb')) models.push(request.url()); });
    await page.goto('/');
    await page.getByRole('button', { name: 'Unit preview · Browse all factions' }).click();
    const preview = page.getByRole('dialog', { name: 'Unit preview' });
    await preview.getByLabel('Gallery faction').selectOption('dwarf');
    await preview.getByLabel('Gallery unit').selectOption('heavy_cavalry');
    await expect(preview.getByTestId('gallery-status')).toContainText('Ready', { timeout: 60000 });
    await info.attach('texture-console', { body: JSON.stringify(logs), contentType: 'application/json' });
    await expect(preview.locator('.gallery-canvas')).toHaveAttribute('data-unit-textures', 'ready');
    await page.screenshot({ path: info.outputPath('game-dwarf-unit-preview.png') });
    await preview.getByRole('button', { name: 'Return to game' }).click();
    await page.getByRole('button', { name: /Quick battle/ }).click();
    await page.getByLabel('Your faction', { exact: true }).selectOption('dwarf');
    await page.getByLabel('Enemy faction', { exact: true }).selectOption('demon');
    await page.getByRole('button', { name: 'Deploy your army' }).click();
    await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-unit-models', 'published', { timeout: 60000 });
    await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-faction', 'dwarf');
    await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-enemy-faction', 'demon');
    await expect(page.locator('.unit-card')).toHaveCount(7);
    await page.locator('.unit-card').last().click();
    await page.getByRole('button', { name: 'Inspect selected troops', exact: true }).click();
    await page.screenshot({ path: info.outputPath('game-dwarf-cavalry.png') });
    await page.getByRole('button', { name: 'Battle overview', exact: true }).click();
    await page.getByRole('button', { name: 'Begin battle', exact: true }).click();
    await expect(page.locator('.deployment-banner')).toHaveCount(0);
    expect(models.some(url => /dwarf-roster\.glb\?v=/.test(url))).toBe(true);
    expect(models.some(url => /demon-roster-lod\.glb\?v=/.test(url))).toBe(true);
    expect(models.some(url => /-army(?:-lod)?\.glb/.test(url))).toBe(false);
    expect(errors).toEqual([]);
});

test('a resumed campaign battle uses faction models and preserves saved troop rules', async ({ page }, info) => {
    test.setTimeout(120000);
    const world = createSolo('Campaign models'); world.settlements[0].faction = 'elf';
    startPractice(world, 'solo-ruler', () => 777, 'plains', 'normal');
    const battle = world.battles[0]; battle.mode = 'pve'; battle.camp_id = 1; battle.enemy_name = 'Campaign model check';
    delete battle.attacker_faction; delete battle.defender_faction;
    await page.addInitScript(world => {
        localStorage.setItem('peris-campaign-v6', JSON.stringify(world));
        localStorage.setItem(`peris-welcome:solo-ruler:${world.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/'); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-unit-models', 'published', { timeout: 60000 });
    await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-faction', 'elf');
    await expect(page.locator('.unit-card').first()).toContainText('Leaf Guard');
    await page.screenshot({ path: info.outputPath('campaign-faction-units.png') });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!));
    expect(saved.armies[0].infantry).toBe(world.armies[0].infantry);
    expect(saved.formations[0].label).toBe(world.formations[0].label);
});

test('campaign map uses published army markers and opens the unit preview from its menu', async ({ page }, info) => {
    test.setTimeout(120000);
    const world = createSolo('Map models'); world.settlements[0].faction = 'orc';
    await page.addInitScript(world => {
        localStorage.setItem('peris-campaign-v6', JSON.stringify(world));
        localStorage.setItem(`peris-welcome:solo-ruler:${world.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/'); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('button', { name: 'Focus your army', exact: true }).click();
    const map = page.locator('canvas[aria-label^="Interactive 200 by 200"]');
    await expect(map).toHaveAttribute('data-army-models', 'published', { timeout: 60000 });
    await page.screenshot({ path: info.outputPath('campaign-map-faction-army.png') });
    await page.getByLabel('Game menu', { exact: true }).click();
    await page.getByRole('button', { name: 'Unit preview', exact: true }).click();
    await expect(page.getByLabel('Gallery faction')).toHaveValue('orc');
    await expect(page.getByTestId('gallery-status')).toContainText('Ready', { timeout: 60000 });
    await page.getByRole('button', { name: 'Return to game' }).click();
    await expect(map).toHaveAttribute('data-army-models', 'published');
});

test('shared-world map and defender battle use the correct published factions', async ({ page }, info) => {
    test.setTimeout(150000);
    const me = '11111111-1111-4111-8111-111111111111', rival = '22222222-2222-4222-8222-222222222222';
    const world = JSON.parse(JSON.stringify(createSolo('Online model QA')).replaceAll('solo-ruler', me)) as ReturnType<typeof createSolo>;
    world.settlements[0].faction = 'dwarf';
    const opponent = { ...world.armies[0], id: 900, owner_id: rival, home_settlement_id: 901, faction: 'demon' as const };
    const privateWorld = world;
    let fighting = false; const selects: string[] = [];
    const duel = structuredClone(world); startPractice(duel, me, () => 100, 'plains', 'normal', 'balanced', 'dwarf', 'demon');
    const battle = duel.battles[0]; battle.mode = 'pvp'; battle.attacker_owner_id = rival; battle.defender_owner_id = me;
    battle.attacker_army_id = 900; battle.defender_army_id = world.armies[0].id; battle.defender_ready = false;
    delete battle.attacker_faction; delete battle.defender_faction;
    duel.formations.forEach(f => { f.owner_id = f.side === 'attacker' ? rival : me; });
    const session = { access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6IjExMTExMTExLTExMTEtNDExMS04MTExLTExMTExMTExMTExMSJ9.test', token_type: 'bearer', expires_in: 3600, refresh_token: 'test-refresh', user: { id: me, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
    await page.route('**/auth/v1/**', route => route.fulfill({ json: session }));
    await page.route('**/rest/v1/**', async route => {
        const url = new URL(route.request().url()), path = url.pathname;
        if (path.endsWith('/players')) return route.fulfill({ json: { id: me } });
        if (path.endsWith('/armies')) { selects.push(url.searchParams.get('select')!); return route.fulfill({ json: [{ id: 900, owner_id: rival, home_settlement_id: 901 }] }); }
        if (path.endsWith('/settlements')) { selects.push(url.searchParams.get('select')!); return route.fulfill({ json: [{ id: world.settlements[0].id, faction: 'dwarf' }, { id: 901, faction: 'demon' }] }); }
        if (path.endsWith('/peris_snapshot')) return route.fulfill({ json: fighting ? duel : privateWorld });
        if (path.endsWith('/peris_map_snapshot')) return route.fulfill({ json: { server_now: world.server_now, players: world.players, settlements: world.settlements, armies: [world.armies[0], opponent], map_plots: [], total_players: 2, total_settlements: 2, settlements_truncated: false, armies_truncated: false, plots_truncated: false } });
        return route.fulfill({ json: null });
    });
    await page.goto('/'); await page.getByRole('button', { name: 'Shared world', exact: true }).click();
    await page.getByRole('button', { name: 'Enter the shared world' }).click();
    const map = page.locator('canvas[aria-label^="Interactive 200 by 200"]');
    await expect(map).toHaveAttribute('data-army-models', 'published', { timeout: 60000 });
    await page.screenshot({ path: info.outputPath('multiplayer-map-units.png') });
    fighting = true;
    await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-unit-models', 'published', { timeout: 60000 });
    await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-faction', 'dwarf');
    await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-enemy-faction', 'demon');
    await page.screenshot({ path: info.outputPath('multiplayer-defender-units.png') });
    expect(selects).toContain('id,faction');
    expect(selects.every(fields => !/food|gold|wood|stone|rate|capacity/.test(fields))).toBe(true);
});

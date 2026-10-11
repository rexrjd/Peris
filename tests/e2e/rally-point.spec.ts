import { test, expect, type Page, type TestInfo, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { beginRaid } from '../../src/features/campaign/domain/raids';
import { emptyRoster, readRoster, writeRoster, RECRUIT_RULES, type RecruitUnit } from '../../src/features/army/domain/roster';
import { marchArmy, startRaidReturn } from '../../src/features/map/domain/commands';
import { findMarchPath } from '../../src/features/map/domain/pathfinding';
import { cellCenter, isWalkable } from '../../src/features/map/domain/worldGrid';
import { refreshCityEconomy } from '../../src/features/city/domain/slots';
import { validateSave } from '../../src/platform/storage/saves';
import type { World } from '../../src/shared/model/world';
import type { LocalCommandContext } from '../../src/shared/model/commands';

const roman = JSON.parse(readFileSync('assets/concepts/faction-sheets-v1/expanded-rosters.json', 'utf8')).roster.find((row: { id: string }) => row.id === 'roman');
const troopName = (unit: RecruitUnit): string => [...roman.troops, ...roman.siege].find((row: { id: string }) => row.id === RECRUIT_RULES[unit].role).name;
const saved = (page: Page): Promise<World> => page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!));

function fixture(expired = false) {
    const world = createSolo('Rally QA'), city = world.settlements[0], army = world.armies[0], owner = army.owner_id;
    city.name = 'Stonehaven'; city.faction = 'roman'; army.name = 'Home legion';
    writeRoster(army, { ...emptyRoster(), infantry: 11, spearmen: 3, archers: 7, elite: 2, cavalry: 5, scout: 4, heavyCavalry: 6, ram: 2, catapult: 1 });
    const second = [[15, 3], [12, 2], [18, 6]].map(([col, row]) => cellCenter(col, row)).find(p => isWalkable(Math.floor(p.x / 128), Math.floor(p.y / 128)) && findMarchPath(city, p))!;
    world.settlements.push({ ...city, id: 2, name: 'Dawnwatch', ...second });
    world.buildings.push(...world.buildings.slice().map(row => ({ ...row, id: row.id + 1000, settlement_id: 2 })));
    const field = [[2, 2], [1, 3], [0, 2]].map(([col, row]) => ({ col, row })).find(cell => isWalkable(cell.col, cell.row) && !world.camps.some(c => Math.floor(c.x / 128) === cell.col && Math.floor(c.y / 128) === cell.row))!;
    world.map_plots = [{ ...field, owner_id: owner, settlement_id: city.id, building_type: null, level: 0 }];
    for (const [id, name] of [[200, 'Camp raiders'], [300, 'Returning guard'], [400, 'Eastern reinforcement'], [500, 'Field watch']] as const) {
        const copy = { ...army, id, name, unit_roster: { ...readRoster(army) } };
        if (id === 200 || id === 500) { const p = cellCenter(field.col, field.row); copy.start_x = copy.target_x = p.x; copy.start_y = copy.target_y = p.y; }
        world.armies.push(copy);
        world.heroes!.push({ ...world.heroes![0], id: id + 1, army_id: id, name: 'Captain ' + id });
    }
    const camp = world.camps.filter(c => c.bandit && Math.hypot(c.x - city.x, c.y - city.y) > 2500 && Math.hypot(c.x - city.x, c.y - city.y) < 7000)
        .find(c => findMarchPath(cellCenter(field.col, field.row), c) && findMarchPath({ x: army.target_x, y: army.target_y }, c))!;
    let id = 9000;
    const ctx: LocalCommandContext = { world, playerId: owner, armyId: 200, now: new Date(Date.parse(world.server_now) - (expired ? 60000 : 0)).toISOString(), nextId: () => ++id, active: undefined, paused: () => {}, finalize: () => {} };
    marchArmy(ctx, { type: 'raid', campId: camp.id });
    ctx.now = world.server_now; ctx.armyId = 300; marchArmy(ctx, { type: 'raid', campId: camp.id });
    startRaidReturn(world, world.armies.find(row => row.id === 300)!, Date.parse(world.server_now));
    ctx.armyId = 400; marchArmy(ctx, { type: 'move', ...second });
    const garrison = { owner_id: owner, ...field, infantry: 0, archers: 0, cavalry: 0 };
    writeRoster(garrison, { ...emptyRoster(), scout: 3, heavyCavalry: 2, catapult: 2 });
    world.garrisons = [garrison];
    world.campaign_farm_lists = [
        { id: 1, owner_id: owner, name: 'Nearby camps', troops: { ...emptyRoster(), infantry: 2, scout: 1 }, casualties_only: false },
        { id: 2, owner_id: owner, name: 'Reserve farms', troops: { ...emptyRoster(), infantry: 1 }, casualties_only: false },
    ];
    world.campaign_farms = [{ id: 1, owner_id: owner, list_id: 1, camp_id: camp.id, army_id: army.id,
        troops: { ...emptyRoster(), infantry: 2, scout: 1, catapult: 1 }, created_at: world.server_now, enabled: false, interval_seconds: 300 }];
    // Keep a real battle record, a pruned unknown battle, and a pruned camp receipt.
    beginRaid(world, owner, camp.id, () => ++id, army.id);
    const battle = world.battles[0];
    const result = { attacker_initial: 41, defender_initial: 20, attacker_survivors: 39, defender_survivors: 0,
        attacker_losses: 2, defender_losses: 20, loot: { wood: 12, stone: 4, food: 6, gold: 1 }, duration: 55, reason: 'Victory',
        attacker_roster: readRoster(army), attacker_survivor_roster: { ...readRoster(army), infantry: 9 }, attacker_faction: 'roman' as const };
    Object.assign(battle, { status: 'resolved', phase: 'finished', winner_side: 'attacker', winner_owner_id: owner, result,
        enemy_name: 'Stored camp victory', ended_at: world.server_now });
    world.reports = [
        { id: 101, owner_id: owner, battle_id: battle.id, camp_id: camp.id, title: 'Stored camp victory', won: true, result, created_at: world.server_now },
        { id: 102, owner_id: owner, battle_id: 87654, title: 'Older saved raid', won: true, result, created_at: new Date(Date.parse(world.server_now) - 3600000).toISOString() },
        { id: 103, owner_id: owner, battle_id: 87655, camp_id: camp.id, title: 'Older camp spoils', won: true,
            result: { ...result, delivered: { wood: 10, stone: 4, food: 6, gold: 1 }, overflow: { wood: 2, stone: 0, food: 0, gold: 0 } },
            created_at: new Date(Date.parse(world.server_now) - 7200000).toISOString() },
    ];
    refreshCityEconomy(world, 1); refreshCityEconomy(world, 2);
    validateSave(world);
    return { world, city, field, camp };
}

async function start(page: Page, world: World) {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(w => {
        if (!localStorage.getItem('peris-campaign-v6')) localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/'); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('navigation', { name: 'Game navigation' }).getByRole('button', { name: 'Rally Point', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Rally Point', exact: true, level: 1 })).toBeVisible();
    return errors;
}
async function capture(page: Page, info: TestInfo, name: string) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const path = info.outputPath(name + '.png'); await page.screenshot({ path, fullPage: true });
    await info.attach(name, { path, contentType: 'image/png' });
}
async function count(summary: Locator, unit: RecruitUnit, amount: number) {
    await expect(summary.locator('.game-troop-summary > span').filter({ has: summary.page().getByRole('img', { name: troopName(unit), exact: true }) }).first()).toHaveText(String(amount));
}

test('Rally Point keeps city-specific stations and incoming/outgoing nine-role parties together', async ({ page }, info) => {
    const f = fixture(), errors = await start(page, f.world);
    await expect(page.getByLabel('Rally Point city')).toHaveValue('1');
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /^Incoming 1$/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
    const village = page.getByRole('article', { name: 'Station: Stonehaven', exact: true });
    const field = page.getByRole('article', { name: `Station: Field (${f.field.col} | ${f.field.row})`, exact: true });
    await count(village, 'scout', 4); await count(village, 'catapult', 1);
    await expect(field.locator('header')).toContainText('48 troops');
    await count(field.locator('.rally-station-party').nth(0), 'scout', 4);
    await count(field.locator('.rally-station-party').nth(0), 'catapult', 1);
    await count(field.locator('.rally-station-party').nth(1), 'scout', 3);
    await count(field.locator('.rally-station-party').nth(1), 'catapult', 2);
    await capture(page, info, 'rally-overview');
    if (info.project.name === 'desktop-chromium') {
        const original = page.viewportSize()!;
        await page.setViewportSize({ width: 761, height: 900 });
        await capture(page, info, 'rally-tablet-761');
        await page.setViewportSize(original);
    }
    await page.getByRole('tab', { name: /^Incoming 1$/ }).click();
    const returning = page.getByRole('article', { name: 'Returning: Returning guard', exact: true });
    await expect(returning).toContainText('Stonehaven'); await count(returning, 'scout', 4);
    await expect(returning.getByRole('button', { name: 'Cancel order', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: /^Outgoing 2$/ }).click();
    await expect(page.getByRole('article', { name: 'Raid: Camp raiders', exact: true })).toContainText(f.camp.name);
    await expect(page.getByRole('article', { name: 'Reinforcement: Eastern reinforcement', exact: true })).toContainText('Dawnwatch');
    await capture(page, info, 'rally-outgoing');
    await page.getByLabel('Rally Point city').selectOption('2');
    await expect(page.getByRole('tab', { name: /^Incoming 1$/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Outgoing 0$/ })).toBeVisible();
    await page.getByRole('tab', { name: /^Incoming 1$/ }).click();
    await expect(page.getByRole('article', { name: 'Reinforcement: Eastern reinforcement', exact: true })).toContainText('Dawnwatch');
    await expect(page.getByRole('article', { name: 'Returning: Returning guard', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('Rally Point cancellation restores the owned departure station and expires at thirty seconds', async ({ page }, info) => {
    const f = fixture(); await start(page, f.world);
    await page.getByRole('tab', { name: /^Outgoing 2$/ }).click();
    const raid = page.getByRole('article', { name: 'Raid: Camp raiders', exact: true });
    await raid.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await expect.poll(async () => (await saved(page)).armies.find(row => row.id === 200)?.status).toBe('idle');
    const world = await saved(page), restored = world.armies.find(row => row.id === 200)!;
    expect(readRoster(restored).scout).toBe(7); expect(readRoster(restored).catapult).toBe(3);
    expect(world.garrisons).toEqual([]);
    await expect(page.getByRole('tab', { name: /^Outgoing 1$/ })).toBeVisible();
    await capture(page, info, 'rally-cancelled');
    // Reload an already-expired real march to verify the deadline without a slow sleep.
    const expired = fixture(true).world;
    await page.addInitScript(w => {
        localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, expired);
    await page.reload(); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('navigation', { name: 'Game navigation' }).getByRole('button', { name: 'Rally Point', exact: true }).click();
    await page.getByRole('tab', { name: /^Outgoing 2$/ }).click();
    await expect(page.getByRole('article', { name: 'Raid: Camp raiders', exact: true }).getByRole('button', { name: 'Cancel order', exact: true })).toHaveCount(0);
    expect((await saved(page)).armies.find(row => row.id === 200)?.status).toBe('moving');
});

test('embedded farm lists keep edits, moving targets and a reviewed manual batch in the main game', async ({ page }, info) => {
    const f = fixture(), errors = await start(page, f.world);
    await page.getByRole('tab', { name: 'Farm lists', exact: true }).click();
    const lists = page.getByRole('region', { name: 'Farm lists', exact: true });
    await expect(page.getByRole('dialog', { name: 'Farm lists', exact: true })).toHaveCount(0);
    await lists.getByLabel('Sort farm targets').selectOption('totalBounty');
    await lists.getByRole('button', { name: 'Edit list', exact: true }).first().click();
    let dialog = page.getByRole('dialog', { name: 'Edit farm list', exact: true });
    await dialog.getByLabel(troopName('scout') + ' default quantity').fill('2');
    await dialog.getByRole('button', { name: 'Save list', exact: true }).click();
    await expect.poll(async () => (await saved(page)).campaign_farm_lists?.[0].troops.scout).toBe(2);
    await lists.getByRole('button', { name: 'Edit', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Edit farm target', exact: true });
    await dialog.getByLabel('Farm list', { exact: true }).selectOption('2');
    await dialog.getByRole('button', { name: 'Save target', exact: true }).click();
    await expect.poll(async () => (await saved(page)).campaign_farms?.[0].list_id).toBe(2);
    await lists.getByRole('button', { name: 'Start list', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Start farm list: Reserve farms', exact: true });
    await expect(dialog.getByRole('img', { name: troopName('scout'), exact: true })).toBeVisible();
    await expect(dialog.getByRole('img', { name: troopName('catapult'), exact: true })).toBeVisible();
    expect((await saved(page)).armies[0].status).toBe('idle');
    await capture(page, info, 'rally-farm-batch-review');
    await dialog.getByRole('button', { name: 'Confirm batch', exact: true }).click();
    await expect.poll(async () => (await saved(page)).armies[0].status).toBe('moving');
    expect(readRoster((await saved(page)).armies[0]).scout).toBe(1);
    await lists.getByRole('button', { name: /Cancel raid/ }).click();
    await expect.poll(async () => (await saved(page)).armies[0].status).toBe('idle');
    expect(readRoster((await saved(page)).armies[0]).scout).toBe(4);
    expect(errors).toEqual([]);
});

test('Rally Point opens real report details even when an older battle has been pruned', async ({ page }, info) => {
    const f = fixture(), errors = await start(page, f.world);
    await page.getByRole('tab', { name: 'Reports', exact: true }).click();
    await page.getByRole('button', { name: /Stored camp victory/ }).click();
    let report = page.getByRole('dialog', { name: 'Battle result', exact: true });
    await expect(report.getByRole('heading', { name: 'Victory', exact: true })).toBeVisible();
    await expect(report).toContainText('Stored camp victory');
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: 'Game navigation' }).getByRole('button', { name: 'Rally Point', exact: true }).click();
    await page.getByRole('tab', { name: 'Reports', exact: true }).click();
    await page.getByRole('button', { name: /Older saved raid/ }).click();
    report = page.getByRole('dialog', { name: 'Saved battle report', exact: true });
    await expect(report).toContainText('Older saved raid');
    await expect(report).toContainText('Attacking forces');
    await expect(report).toContainText('Defending forces');
    await capture(page, info, 'rally-saved-report');
    await report.getByRole('button', { name: 'Back to reports', exact: true }).click();
    await page.getByRole('button', { name: /Older camp spoils/ }).click();
    report = page.getByRole('dialog', { name: 'Saved battle report', exact: true });
    await expect(report.getByRole('heading', { name: 'Victory', exact: true })).toBeVisible();
    await expect(report.getByRole('region', { name: 'Delivered spoils', exact: true })).toContainText('Storage overflow discarded');
    await expect(report.getByRole('region', { name: 'Returned troops', exact: true }).getByRole('img', { name: troopName('scout'), exact: true })).toBeVisible();
    await capture(page, info, 'rally-pruned-camp-report');
    expect((await saved(page)).reports).toHaveLength(3);
    expect(errors).toEqual([]);
});

test('Rally Point reports respect owned losses-only farm filters and exclude rival private receipts', async ({ page }) => {
    const f = fixture(), owner = f.world.players[0].id;
    f.world.campaign_farm_lists![0].casualties_only = true;
    const source = f.world.reports[0];
    f.world.reports[0] = { ...source, farm_list_id: 1 };
    f.world.reports.push(
        { ...source, id: 104, battle_id: 87656, title: 'Quiet farm run', farm_list_id: 1,
            result: { ...source.result, attacker_losses: 0, attacker_survivors: source.result.attacker_initial, attacker_survivor_roster: source.result.attacker_roster } },
        { ...source, id: 105, owner_id: 'rival-ruler', battle_id: 87657, title: 'Private rival receipt' },
    );
    validateSave(f.world);
    await start(page, f.world);
    await page.getByRole('tab', { name: 'Reports', exact: true }).click();
    await expect(page.getByRole('button', { name: /Stored camp victory/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Quiet farm run/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Private rival receipt/ })).toHaveCount(0);
    expect((await saved(page)).reports.filter(row => row.owner_id === owner)).toHaveLength(4);
});

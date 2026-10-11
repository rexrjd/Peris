import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { emptyRoster, writeRoster, RECRUIT_RULES, type RecruitUnit } from '../../src/features/army/domain/roster';
import { findMarchPath } from '../../src/features/map/domain/pathfinding';
import { marchSpeed } from '../../src/features/map/domain/commands';
import { carryingCapacity } from '../../src/features/frontier/domain/balance';
import { clock } from '../../src/shared/time/clock';
import { validateSave } from '../../src/platform/storage/saves';
import type { BattleResult } from '../../src/features/battle/domain/types';
import type { World } from '../../src/shared/model/world';

const roman = JSON.parse(readFileSync('assets/concepts/faction-sheets-v1/expanded-rosters.json', 'utf8')).roster.find((row: { id: string }) => row.id === 'roman');
const troopName = (unit: RecruitUnit): string => [...roman.troops, ...roman.siege].find((row: { id: string }) => row.id === RECRUIT_RULES[unit].role).name;

function fixture() {
    const world = createSolo('Receipt parity'), army = world.armies[0], owner = army.owner_id;
    const camp = world.camps.filter(row => row.bandit).sort((a, b) => Math.hypot(a.x - army.start_x, a.y - army.start_y) - Math.hypot(b.x - army.start_x, b.y - army.start_y))
        .find(row => findMarchPath({ x: army.start_x, y: army.start_y }, row))!;
    writeRoster(army, { ...emptyRoster(), scout: 3, catapult: 2 });
    const result: BattleResult = {
        attacker_initial: 5, attacker_survivors: 3, attacker_losses: 2, defender_initial: 10, defender_survivors: 0, defender_losses: 10,
        loot: { wood: 20, stone: 10, food: 5, gold: 0 }, duration: 33, reason: 'Army routed',
        attacker_roster: { ...emptyRoster(), scout: 3, catapult: 2 }, attacker_survivor_roster: { ...emptyRoster(), scout: 2, catapult: 1 }, attacker_faction: 'roman',
        replacement_cost: { wood: 33, stone: 25, food: 27, gold: 13 }, carrying_capacity: 20,
    };
    const receipt = { id: 101, owner_id: owner, battle_id: 901, camp_id: camp.id, title: 'Delivered camp receipt', won: true, result, created_at: world.server_now };
    world.campaign_farm_lists = [{ id: 1, owner_id: owner, name: 'Losses only', troops: emptyRoster(), casualties_only: true }];
    world.reports = [
        { ...receipt, result: { ...result, delivered: { wood: 20, stone: 10, food: 5, gold: 0 }, delivered_at: world.server_now, overflow: { wood: 0, stone: 0, food: 0, gold: 0 }, estimated_profit: { wood: -13, stone: -15, food: -22, gold: -13 } } },
        { ...receipt, id: 102, battle_id: 902, title: 'Awaiting delivery receipt' },
        { ...receipt, id: 103, battle_id: 903, camp_id: undefined, title: 'Unknown side receipt' },
        { ...receipt, id: 104, battle_id: 904, title: 'Hidden quiet farm', farm_list_id: 1,
            result: { ...result, attacker_losses: 0, attacker_survivors: 5, attacker_survivor_roster: result.attacker_roster } },
        { ...receipt, id: 105, battle_id: 905, owner_id: 'rival-ruler', title: 'Private rival receipt' },
    ];
    world.report_count = 8; world.hidden_report_count = 1;
    validateSave(world);
    return { world, camp };
}

async function start(page: Page, world: World) {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(w => {
        localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/'); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    return errors;
}
async function capture(page: Page, info: TestInfo, name: string) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const path = info.outputPath(name + '.png'); await page.screenshot({ path });
    await info.attach(name, { path, contentType: 'image/png' });
}

test('Reports navigation opens pruned camp and neutral receipts with actual delivery economics', async ({ page }, info) => {
    const f = fixture(), errors = await start(page, f.world);
    await page.getByRole('navigation', { name: 'Game navigation' }).getByRole('button', { name: /^Reports/ }).click();
    const ledger = page.getByLabel('Battle report ledger');
    await expect(ledger).toContainText('Showing 3 of 8 visible reports');
    await expect(ledger).toContainText('1 quiet report is hidden');
    await expect(ledger.getByRole('button', { name: /Hidden quiet farm|Private rival receipt/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Delivered camp receipt/ }).click();
    let dialog = page.getByRole('dialog', { name: 'Saved battle report', exact: true });
    await expect(dialog.getByRole('heading', { name: 'Victory', exact: true })).toBeVisible();
    const economics = dialog.getByRole('region', { name: 'Raid economics' });
    await expect(economics.locator('.signed-resources b')).toHaveText(['-13', '-15', '-22', '-13']);
    await expect(dialog.getByRole('region', { name: 'Delivered spoils' })).toBeVisible();
    await capture(page, info, 'delivered-report');
    await dialog.getByRole('button', { name: 'Back to reports', exact: true }).click();
    await page.getByRole('button', { name: /Awaiting delivery receipt/ }).click();
    dialog = page.getByRole('dialog', { name: 'Saved battle report', exact: true });
    await expect(dialog.getByRole('region', { name: 'Raid economics' })).toContainText('Delivery not recorded yet');
    await expect(dialog.locator('.signed-resources')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Unknown side receipt/ }).click();
    dialog = page.getByRole('dialog', { name: 'Saved battle report', exact: true });
    await expect(dialog.getByRole('region', { name: 'Attacking forces' })).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Defending forces' })).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Raid economics' })).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('camp inspector and reviewed party show land route, stock limits and selected-role pace', async ({ page }, info) => {
    const f = fixture(), errors = await start(page, f.world), army = f.world.armies[0];
    await page.getByRole('navigation', { name: 'Game navigation' }).getByRole('button', { name: 'Rally Point', exact: true }).click();
    await page.getByRole('tab', { name: 'Reports', exact: true }).click();
    await page.getByRole('region', { name: `Reports: ${f.camp.name}`, exact: true }).getByRole('button', { name: 'Locate', exact: true }).click();
    const inspector = page.getByRole('region', { name: 'Selected map landmark' });
    await expect(inspector).toContainText(f.camp.name);
    await expect(inspector.locator('.camp-route-info')).toContainText('fields by land');
    await inspector.getByText('Details', { exact: true }).click();
    await expect(inspector.locator('.camp-stock-capacity')).toContainText('Camp storage capacity');
    await inspector.getByText('Your recent reports (2)', { exact: true }).click();
    await expect(inspector.locator('.camp-recent-reports > button')).toHaveCount(2);
    await inspector.locator('.camp-recent-reports > button').first().click();
    await expect(page.getByRole('dialog', { name: 'Saved battle report', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await inspector.getByRole('button', { name: 'March and engage', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Prepare camp raid', exact: true });
    const route = findMarchPath({ x: army.start_x, y: army.start_y }, f.camp)!;
    const party = dialog.getByLabel('Party travel and resources');
    await expect(dialog.locator('.march-review')).toContainText(clock(Math.max(2, route.distance / marchSpeed(f.world, army))));
    await expect(party).toContainText('Out & back estimate');
    await expect(party).toContainText('Party replacement value');
    await dialog.getByLabel(troopName('catapult') + ' to send', { exact: true }).fill('0');
    const scouts = { ...emptyRoster(), scout: 3 };
    await expect(dialog.locator('.march-review')).toContainText(clock(Math.max(2, route.distance / marchSpeed(f.world, army, scouts))));
    await expect(party.locator('dl > div').filter({ hasText: 'Carrying capacity' })).toContainText(String(carryingCapacity(scouts)));
    await party.scrollIntoViewIfNeeded();
    await capture(page, info, 'selected-party-economics');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!).armies[0].status)).toBe('idle');
    expect(errors).toEqual([]);
});

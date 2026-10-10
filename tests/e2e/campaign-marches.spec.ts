import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import type { World } from '../../src/shared/model/world';
import type { Camp } from '../../src/features/map/domain/types';
import { getCell, isWalkable } from '../../src/features/map/domain/worldGrid';
import { beginRaid } from '../../src/features/campaign/domain/raids';

async function start(page: Page, world: World) {
    await page.addInitScript(w => {
        if (!localStorage.getItem('peris-campaign-v6')) localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await expect(page.locator('canvas[aria-label^="Interactive 200 by 200"]')).toBeVisible();
}
async function save(page: Page): Promise<World> {
    return page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!));
}
async function chooseCamp(page: Page, camp: Camp) {
    await page.getByRole('button', { name: /Layers/ }).click();
    await page.getByRole('button', { name: 'Find a field', exact: true }).click();
    await page.getByLabel(/Field X coordinate/).fill(String(Math.floor(camp.x / 128)));
    await page.getByLabel(/Field Y coordinate/).fill(String(Math.floor(camp.y / 128)));
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await page.getByText('Terrain & travel details', { exact: true }).click();
    await page.getByRole('button', { name: new RegExp(camp.name + '.*Bandit camp') }).click();
}
async function openLists(page: Page) {
    await page.getByRole('button', { name: 'Quick access', exact: true }).click();
    await page.getByRole('navigation', { name: 'Quick access shortcuts' }).getByRole('button', { name: /^Farm lists/ }).click();
    await expect(page.getByRole('dialog', { name: 'Farm lists', exact: true })).toBeVisible();
}
async function capture(page: Page, info: TestInfo, name: string) {
    const path = info.outputPath(name + '.png');
    await page.screenshot({ path });
    await info.attach(name, { path, contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('campaign raids require troop review, persist cancellation and leave reusable station troops', async ({ page }, info) => {
    test.setTimeout(120_000);
    const world = createSolo('March QA'), original = world.armies[0];
    const camp = world.camps.filter(c => c.bandit).sort((a, b) => Math.hypot(a.x - original.start_x, a.y - original.start_y) - Math.hypot(b.x - original.start_x, b.y - original.start_y))[0];
    world.armies.push({ ...original, id: 2, name: 'Legio II · The Watch', infantry: 1, archers: 0, cavalry: 0 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await start(page, world); await chooseCamp(page, camp);
    await page.getByRole('button', { name: 'March and engage', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Prepare camp raid', exact: true });
    await dialog.getByLabel('Choose legion', { exact: true }).selectOption('2');
    await expect(dialog.getByLabel('Legionary to send', { exact: true })).toHaveValue('1');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    expect((await save(page)).armies.every(army => army.status === 'idle')).toBe(true);
    await page.getByRole('button', { name: 'March and engage', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Prepare camp raid', exact: true });
    await dialog.getByLabel('Legionary to send', { exact: true }).fill('10');
    await dialog.getByLabel('Sagittarius to send', { exact: true }).fill('0');
    await dialog.getByLabel('Equites to send', { exact: true }).fill('0');
    await capture(page, info, 'campaign-party-review');
    await dialog.getByRole('button', { name: 'Confirm raid', exact: true }).click();
    await expect.poll(async () => (await save(page)).armies[0].status).toBe('moving');
    const sent = await save(page), army = sent.armies[0];
    expect([army.infantry, army.archers, army.cavalry]).toEqual([10, 0, 0]);
    expect(sent.garrisons?.map(g => [g.infantry, g.archers, g.cavalry])).toEqual([[110, 50, 16]]);
    expect(Date.parse(army.march_cancel_until!) - Date.parse(army.march_sent_at!)).toBe(30_000);
    await page.reload(); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    expect((await save(page)).armies[0].march_cancel_until).toBe(army.march_cancel_until);
    await expect(page.getByRole('complementary', { name: 'Cancellable march' })).toBeVisible();
    await capture(page, info, 'campaign-preparing-order');
    await page.getByRole('complementary', { name: 'Cancellable march' }).getByRole('button', { name: /Cancel march/ }).click();
    await expect.poll(async () => (await save(page)).armies[0].infantry).toBe(120);
    expect((await save(page)).garrisons).toEqual([]);
    // Send a subset again, then let a different idle legion collect the leftovers.
    await chooseCamp(page, camp); await page.getByRole('button', { name: 'March and engage', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Prepare camp raid', exact: true });
    await dialog.getByLabel('Legionary to send', { exact: true }).fill('10');
    await dialog.getByLabel('Sagittarius to send', { exact: true }).fill('0');
    await dialog.getByLabel('Equites to send', { exact: true }).fill('0');
    await dialog.getByRole('button', { name: 'Confirm raid', exact: true }).click();
    await page.getByLabel(/Choose army. Active commander/).click();
    await page.getByRole('group', { name: 'Choose army', exact: true }).getByRole('button', { name: /Legio II/ }).click();
    await page.getByRole('button', { name: 'Merge into Legio II · The Watch', exact: true }).click();
    await expect.poll(async () => (await save(page)).armies[1].infantry).toBe(111);
    await page.getByLabel(/Choose army. Active commander/).click();
    await page.getByRole('group', { name: 'Choose army', exact: true }).getByRole('button', { name: /Legio I · The Dawn/ }).click();
    await page.getByRole('complementary', { name: 'Cancellable march' }).getByRole('button', { name: /Cancel march/ }).click();
    const final = await save(page);
    expect(final.armies.map(a => [a.infantry, a.archers, a.cavalry])).toEqual([[10, 0, 0], [111, 50, 16]]);
    expect(final.armies.reduce((sum, a) => sum + a.infantry + a.archers + a.cavalry, 0)).toBe(187);
    expect(final.garrisons).toEqual([]); expect(errors).toEqual([]);
});

test('camp targets save and reload, and Start list reviews a manual batch before launching', async ({ page }, info) => {
    test.setTimeout(120_000);
    const world = createSolo('Farm QA'), camp = world.camps.find(c => c.bandit)!;
    await start(page, world); await chooseCamp(page, camp);
    await page.getByRole('button', { name: 'Add to farm list', exact: true }).click();
    let editor = page.getByRole('dialog', { name: 'Add to farm list', exact: true });
    await editor.getByLabel('New farm list name').fill('Nearby camps');
    await editor.getByRole('button', { name: 'Create list', exact: true }).click();
    await expect(editor.getByLabel('Farm list', { exact: true })).not.toHaveValue('0');
    await editor.getByLabel('Legionary farm quantity', { exact: true }).fill('10');
    await editor.getByLabel('Sagittarius farm quantity', { exact: true }).fill('0');
    await editor.getByLabel('Equites farm quantity', { exact: true }).fill('0');
    await capture(page, info, 'campaign-save-target');
    await editor.getByRole('button', { name: 'Save target', exact: true }).click();
    await page.reload(); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await openLists(page);
    const manager = page.getByRole('dialog', { name: 'Farm lists', exact: true });
    await expect(manager).toContainText('Nearby camps'); await expect(manager).toContainText(camp.name);
    await manager.getByRole('button', { name: 'Start list', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Start farm list: Nearby camps', exact: true });
    await expect(review).toContainText('10 infantry / 0 archers / 0 cavalry');
    expect((await save(page)).armies[0].status).toBe('idle');
    await capture(page, info, 'campaign-batch-review');
    await review.getByRole('button', { name: 'Confirm batch', exact: true }).click();
    await expect.poll(async () => (await save(page)).armies[0].status).toBe('moving');
    await expect(manager.getByRole('button', { name: /Cancel raid/ })).toBeVisible();
    await manager.getByRole('button', { name: /Cancel raid/ }).click();
    await expect.poll(async () => (await save(page)).armies[0].infantry).toBe(120);
    await page.keyboard.press('Escape');
    expect((await save(page)).campaign_farms?.[0].troops).toEqual({ infantry: 10, archers: 0, cavalry: 0 });
});

test('reinforcement review blocks neutral fields and shows saved returning troops merging once', async ({ page }, info) => {
    test.setTimeout(120_000);
    const world = createSolo('Station QA'), origin = { x: world.armies[0].target_x, y: world.armies[0].target_y };
    const field = [[2, 2], [2, 3], [3, 2]].map(([col, row]) => getCell(col, row)).find(cell => isWalkable(cell.col, cell.row))!;
    await start(page, world);
    await page.getByRole('button', { name: /Layers/ }).click();
    await page.getByRole('button', { name: 'Find a field', exact: true }).click();
    await page.getByLabel(/Field X coordinate/).fill(String(field.col)); await page.getByLabel(/Field Y coordinate/).fill(String(field.row));
    await page.getByRole('button', { name: 'Go', exact: true }).click();
    await page.getByRole('button', { name: 'March to this field', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Prepare march', exact: true });
    await expect(dialog).toContainText('Reinforcements can only stop at your village or an owned field.');
    await expect(dialog.getByRole('button', { name: 'Confirm march', exact: true })).toBeDisabled();
    await capture(page, info, 'campaign-neutral-field-blocked');
    expect((await save(page)).armies[0].status).toBe('idle');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    // Load a real persisted return order whose deadline has already passed.
    // This exercises normal reload settlement; no UI clock or simulation hook is changed.
    const returning = createSolo('Return QA'), army = returning.armies[0], at = Date.now();
    Object.assign(army, { infantry: 6, archers: 0, cavalry: 0, start_x: origin.x + 128, start_y: origin.y,
        target_x: origin.x, target_y: origin.y, status: 'moving', departure_at: new Date(at - 5000).toISOString(), arrival_at: new Date(at - 1000).toISOString(),
        march_returning: true, march_origin: { col: Math.floor(origin.x / 128), row: Math.floor(origin.y / 128), ...origin }, march_sent_at: null, march_cancel_until: null,
        march_path: [[origin.x + 128, origin.y], [origin.x, origin.y]], march_distance: 128 });
    returning.garrisons = [{ owner_id: army.owner_id, col: Math.floor(origin.x / 128), row: Math.floor(origin.y / 128), infantry: 110, archers: 50, cavalry: 16 }];
    await page.evaluate(w => localStorage.setItem('peris-campaign-v6', JSON.stringify(w)), returning);
    await page.reload(); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await expect.poll(async () => (await save(page)).armies[0].infantry).toBe(116);
    let settled = await save(page); expect(settled.garrisons).toEqual([]); expect(settled.armies[0].status).toBe('idle');
    expect([settled.armies[0].target_x, settled.armies[0].target_y]).toEqual([origin.x, origin.y]);
    await page.reload(); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    settled = await save(page); expect([settled.armies[0].infantry, settled.armies[0].archers, settled.armies[0].cavalry]).toEqual([116, 50, 16]);
});

test('bandit farming resolves quietly while the global map remains available', async ({ page }, info) => {
    test.setTimeout(120_000);
    const world = createSolo('Quiet QA'), camp = world.camps.find(camp => camp.bandit)!;
    beginRaid(world, world.players[0].id, camp.id, (() => { let id = 500; return () => ++id; })(), world.armies[0].id);
    await start(page, world);
    await expect(page.locator('.realm-topbar')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Battle result', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Quick access', exact: true }).click();
    await page.getByRole('navigation', { name: 'Quick access shortcuts' }).getByRole('button', { name: /^Reports/ }).click();
    await expect(page.locator('.chronicle')).toBeVisible();
    await capture(page, info, 'campaign-quiet-farming');
    await expect.poll(async () => (await save(page)).reports.some(report => report.title === camp.name), { timeout: 90_000 }).toBe(true);
    await expect(page.getByRole('dialog', { name: 'Battle result', exact: true })).toHaveCount(0);
    await expect(page.locator('.report-list')).toContainText(camp.name);
});

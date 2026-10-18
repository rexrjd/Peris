import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { marchArmy, startRaidReturn } from '../../src/features/map/domain/commands';
import { findMarchPath } from '../../src/features/map/domain/pathfinding';
import { cellCenter, isWalkable } from '../../src/features/map/domain/worldGrid';
import { refreshCityEconomy } from '../../src/features/city/domain/slots';
import { validateSave } from '../../src/platform/storage/saves';
import type { World } from '../../src/shared/model/world';
import type { LocalCommandContext } from '../../src/shared/model/commands';

async function start(page: Page, world: World, canvas = false) {
    await page.addInitScript(({ w, fallback }) => {
        if (!localStorage.getItem('peris-campaign-v6')) localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
        if (fallback) {
            const get = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(kind: string, ...args: unknown[]) {
                if (kind.startsWith('webgl')) return null;
                return get.call(this, kind as '2d', ...args);
            } as typeof get;
        }
    }, { w: world, fallback: canvas });
    await page.goto('/'); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await expect(page.locator('canvas[aria-label^="Interactive 200 by 200"]')).toBeVisible();
}
async function showEvents(page: Page) {
    if (await page.getByRole('button', { name: 'Open map activity', exact: true }).isVisible()) await page.getByRole('button', { name: 'Open map activity', exact: true }).click();
}
const saved = async (page: Page): Promise<World> => page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!));
async function capture(page: Page, info: TestInfo, name: string) {
    const path = info.outputPath(name + '.png'); await page.screenshot({ path }); await info.attach(name, { path, contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const bounds = await page.locator('canvas[aria-label^="Interactive 200 by 200"]').boundingBox();
    const viewport = page.viewportSize()!;
    expect(bounds!.width).toBeGreaterThanOrEqual(viewport.width - 2);
    expect(bounds!.height).toBeGreaterThan(viewport.height * .6);
    const panel = await page.locator('.map-operations').boundingBox();
    expect(panel!.width).toBeLessThanOrEqual(266);
    expect(panel!.height).toBeLessThan(viewport.height * .42);
}
function richWorld() {
    const world = createSolo('Aurelian'), army = world.armies[0], city = world.settlements[0], at = Date.parse(world.server_now);
    city.name = 'Stonehaven'; city.faction = 'orc';
    world.buildings.forEach(b => b.level = b.building_type === 'market' ? 3 : 2);
    const second = [[15, 3], [12, 2], [18, 6]].map(([col, row]) => cellCenter(col, row)).find(p => isWalkable(Math.floor(p.x / 128), Math.floor(p.y / 128)) && findMarchPath(city, p))!;
    world.settlements.push({ ...city, id: 2, name: 'Dawnwatch', ...second, faction: 'persian' });
    world.buildings.push(...world.buildings.slice().map(b => ({ ...b, id: b.id + 1000, settlement_id: 2 })));
    world.city_slots = [{ settlement_id: 1, slot_index: 4, building_type: 'smithy', level: 2 }];
    for (const [id, name] of [[200, 'Ashguard'], [300, 'River watch'], [400, 'Eastern patrol']] as const) {
        world.armies.push({ ...army, id, name, infantry: id === 200 ? 76 : 42, archers: 12, cavalry: 4 });
        world.heroes!.push({ ...world.heroes![0], id: id + 1, army_id: id, name: id === 200 ? 'Grak' : id === 300 ? 'Kara' : 'Darius', experience: 450 });
    }
    const camp = world.camps.filter(c => c.bandit && Math.hypot(c.x - city.x, c.y - city.y) > 2500 && Math.hypot(c.x - city.x, c.y - city.y) < 7000).find(c => findMarchPath({ x: army.start_x, y: army.start_y }, c))!;
    let id = 9000;
    const ctx: LocalCommandContext = { world, playerId: army.owner_id, armyId: 200, now: world.server_now, nextId: () => ++id, active: undefined, paused: () => {}, finalize: () => {} };
    marchArmy(ctx, { type: 'raid', campId: camp.id });
    ctx.armyId = 300; marchArmy(ctx, { type: 'raid', campId: camp.id }); startRaidReturn(world, world.armies.find(a => a.id === 300)!, at);
    ctx.armyId = 400; marchArmy(ctx, { type: 'move', ...second });
    const sc = { col: Math.floor(second.x / 128), row: Math.floor(second.y / 128) };
    const field = [[1, 0], [0, 1], [-1, 0]].map(([x, y]) => ({ col: sc.col + x, row: sc.row + y })).find(p => isWalkable(p.col, p.row))!;
    world.map_plots = [{ ...field, owner_id: army.owner_id, settlement_id: 2, building_type: 'farm', level: 1 }];
    const queue = (id: number, kind: World['orders'][0]['kind'], item: string, cityId: number, seconds: number, quantity = 1) => ({ id, owner_id: army.owner_id, kind, item, settlement_id: cityId, army_id: 1, quantity, started_at: world.server_now, finish_at: new Date(at + seconds * 1000).toISOString() });
    world.orders = [queue(101, 'upgrade', 'slot:4:smithy', 1, 210), queue(102, 'recruit', 'cavalry', 1, 270, 12), queue(103, 'field', `field:${field.col}:${field.row}:farm`, 2, 240), queue(104, 'settler', 'settlers', 2, 300, 3)];
    const frontier = [[30, 12], [25, 15], [40, 20]].map(([col, row]) => ({ col, row, route: findMarchPath(second, cellCenter(col, row)) })).find(p => p.route)!;
    world.settler_expeditions = [{ id: 105, owner_id: army.owner_id, origin_settlement_id: 2, col: frontier.col, row: frontier.row, name: 'New frontier', culture_cost: 300, departure_at: world.server_now, arrival_at: new Date(at + 600000).toISOString(), march_path: frontier.route!.path, status: 'travelling' }];
    refreshCityEconomy(world, 1); refreshCityEconomy(world, 2);
    validateSave(world);
    return world;
}

test('realm activity shows every army/city, filters cleanly and selects the correct commander', async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await start(page, richWorld());
    const panel = page.getByRole('complementary', { name: 'Map overview and activity' }), list = panel.locator('.ops-events');
    await showEvents(page);
    await expect(list.locator('li')).toHaveCount(3);
    await expect(list).not.toContainText('Smithy');
    await expect(panel.getByText('Map overview', { exact: true })).toHaveCount(0);
    await capture(page, info, 'map-minimal-movements');
    await panel.getByRole('button', { name: /^All events/ }).click();
    await expect(list.locator('li')).toHaveCount(8);
    await expect(list.getByRole('button', { name: 'View raiding: Ashguard', exact: true })).toHaveCount(1);
    await expect(list.getByRole('button', { name: 'View returning: River watch', exact: true })).toHaveCount(1);
    await expect(list).toContainText('Smithy · Lv. 3'); await expect(list).toContainText('12 cavalry'); await expect(list).toContainText('New frontier');
    await panel.getByRole('button', { name: /^Cities/ }).click(); await expect(list.locator('li')).toHaveCount(5);
    await capture(page, info, 'map-minimal-city-events');
    await panel.getByRole('button', { name: /^Armies/ }).click(); await expect(list.locator('li')).toHaveCount(3);
    await panel.getByRole('button', { name: 'View returning: River watch', exact: true }).click();
    await expect(panel.locator('.ops-army-details')).toContainText('River watch'); await expect(panel.locator('.ops-army-details')).toContainText('Returning');
    await expect(panel.locator('.ops-army-details')).toContainText('Kara');
    await expect(panel.locator('.ops-identity h2')).toBeInViewport();
    await expect(panel.locator('.ops-activity')).toHaveCount(0);
    await expect(page.locator('.army-map-dock')).toBeVisible();
    await capture(page, info, 'map-minimal-returning-army');
    await showEvents(page);
    await panel.getByRole('button', { name: 'View marching: Eastern patrol', exact: true }).click();
    await expect(panel.locator('.ops-identity h2')).toHaveText('Eastern patrol');
    await expect(panel.locator('.ops-identity h2')).toBeInViewport();
    await showEvents(page);
    await panel.getByRole('button', { name: 'View returning: River watch', exact: true }).click();
    await expect(panel.locator('.ops-identity h2')).toBeInViewport();
    await panel.getByRole('button', { name: 'Manage troops', exact: true }).click();
    await expect(page.getByRole('group',{name:'Your armies',exact:true}).getByRole('button',{name:/^River watch,/})).toHaveAttribute('aria-pressed','true');
    expect((await saved(page)).armies.find(a => a.id === 300)!.march_returning).toBe(true);
    expect(errors).toEqual([]);
});

test('a listed staged raid can be cancelled once with its real persisted order token', async ({ page }, info) => {
    const world = createSolo('Cancel QA'), army = world.armies[0]; let id = 9000;
    const ctx: LocalCommandContext = { world, playerId: army.owner_id, armyId: army.id, now: world.server_now, nextId: () => ++id, active: undefined, paused: () => {}, finalize: () => {} };
    marchArmy(ctx, { type: 'raid', campId: 1, troops: { infantry: 7, archers: 2, cavalry: 1 } });
    await start(page, world, true);
    await showEvents(page);
    const panel = page.getByRole('complementary', { name: 'Map overview and activity' });
    await expect(panel.getByRole('button', { name: /^Cancel departure/ })).toBeVisible();
    await capture(page, info, 'map-activity-staged-raid');
    await panel.getByRole('button', { name: /^Cancel departure/ }).click();
    await expect(panel.getByText('No ongoing events', { exact: true })).toBeVisible();
    const result = await saved(page); expect(result.armies[0].status).toBe('idle');
    expect([result.armies[0].infantry, result.armies[0].archers, result.armies[0].cavalry]).toEqual([120, 50, 16]);
    await page.reload(); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    expect((await saved(page)).armies[0].status).toBe('idle');
});

test('empty activity can fold away, real map clicks open details, and clearing details keeps the activity panel', async ({ page }, info) => {
    await start(page, createSolo('Explore QA'));
    const panel = page.getByRole('complementary', { name: 'Map overview and activity' });
    await expect(panel.getByRole('button', { name: 'Open map activity', exact: true })).toBeVisible();
    await expect(panel.locator('.ops-activity')).toHaveCount(0);
    await capture(page, info, 'map-minimal-idle');
    const canvas = page.locator('canvas[aria-label^="Interactive 200 by 200"]');
    await canvas.click({ position: { x: 90, y: 175 } });
    await expect(panel.getByRole('region', { name: 'Selected map landmark' })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^(March to this field|Sea requires ships|No connected land route)$/ })).toBeInViewport();
    await capture(page, info, 'map-minimal-field');
    await panel.getByRole('button', { name: 'Close map details', exact: true }).click();
    await expect(panel.getByRole('region', { name: 'Selected map landmark' })).toHaveCount(0);
    await showEvents(page);
    await expect(panel.getByText('No ongoing events', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Collapse map panel', exact: true }).click();
    await page.getByRole('button', { name: 'Quick access', exact: true }).click();
    await page.getByRole('navigation', { name: 'Quick access shortcuts' }).getByRole('button', { name: /^Reports/ }).click();
    await expect(page.locator('.chronicle')).toBeVisible();
});

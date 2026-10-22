import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { selectCity } from './helpers/selectCity';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { refreshCityEconomy, type SlotType } from '../../src/features/city/domain/slots';
import { stationCell } from '../../src/features/map/domain/garrisons';
import type { World } from '../../src/shared/model/world';
import { validateSave } from '../../src/platform/storage/saves';

async function start(page: Page, world: World) {
    validateSave(world);
    await page.addInitScript(w => {
        if (!localStorage.getItem('peris-campaign-v6')) localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('button', { name: 'City', exact: true }).click();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.getByRole('region', { name: '3D city workspace', exact: true })).toBeVisible();
}
async function capture(page: Page, info: TestInfo, name: string) {
    await page.screenshot({ path: info.outputPath(`${name}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
const save = (page: Page): Promise<World> => page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!));

test('3D city keeps reports and building interactions reachable without extra overlay panels', async ({ page }, info) => {
    const world = createSolo('City Scene'), town = world.settlements[0], base = world.armies[0];
    world.buildings.forEach(building => { building.level = 5; });
    const types: SlotType[] = ['barracks', 'housing', 'academy', 'warehouse', 'stables', 'smithy', 'granary', 'workshop', 'mage_tower', 'housing', 'academy', 'warehouse', 'barracks', 'housing', 'granary', 'smithy'];
    world.city_slots = types.map((building_type, slot_index) => ({ settlement_id: 1, slot_index, building_type, level: building_type === 'mage_tower' ? 10 : 5 }));
    world.garrisons = [{ owner_id: base.owner_id, ...stationCell(town), infantry: 7, archers: 3, cavalry: 2 }];
    const future = new Date(Date.now() + 3_600_000).toISOString();
    world.armies.push({ ...base, id: 2, name: 'Away army', infantry: 25, archers: 0, cavalry: 0, start_x: 300, start_y: 300, target_x: 300, target_y: 300 });
    world.armies.push({ ...base, id: 3, name: 'Returning army', infantry: 9, archers: 0, cavalry: 0, status: 'moving', start_x: 300, start_y: 300, departure_at: new Date().toISOString(), arrival_at: future, march_returning: true });
    world.orders = [{ id: 501, owner_id: base.owner_id, settlement_id: 1, army_id: 1, kind: 'recruit', item: 'infantry', quantity: 5, started_at: new Date().toISOString(), finish_at: future }];
    refreshCityEconomy(world, 1);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await start(page, world);
    await expect(page.locator('.city-3d-scene.ready canvas')).toBeVisible();
    await expect(page.locator('.city-scene-peek')).toHaveCount(0);
    await expect(page.locator('.village-economy')).toHaveCount(0);
    const frame = await page.locator('.city-scene-surface').boundingBox();
    expect(frame!.width).toBeGreaterThan(page.viewportSize()!.width * .95);
    expect(frame!.height).toBeGreaterThan(page.viewportSize()!.height * .6);
    await expect(page.locator('.city-selector')).toContainText('Army 198');
    await expect(page.locator('.city-scene-dock,.city-scene-status,.city-scene-utilities')).toHaveCount(0);
    await expect(page.locator('[data-building="wall"]')).toBeInViewport();
    await capture(page, info, 'city-scene-clean');
    await page.getByRole('button', {name:'Open city economy report'}).click();
    const report = page.getByRole('dialog', {name:/city report/});
    await report.getByRole('button', {name:'Production',exact:true}).click();
    await expect(report).toContainText('Income & storage');
    await capture(page, info, 'city-scene-production');
    await report.getByRole('button', {name:'Residents',exact:true}).click();
    await expect(report).toContainText('Housing');
    await page.keyboard.press('Escape');
    await page.locator('[data-building="slot:8"]').click();
    const dialog = page.getByRole('dialog', { name: 'Selected building', exact: true });
    await expect(dialog.locator('.city-building-model-preview canvas')).toBeVisible();
    await expect(dialog).toContainText('Level 10');
    await capture(page, info, 'city-scene-mage-dialog');
    await page.keyboard.press('Escape');
    await page.locator('[data-building="market"]').click();
    await expect(page.getByRole('dialog', { name: 'Selected building', exact: true })).toContainText('Main building');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-building="market"]')).toBeFocused();
    await page.setViewportSize({ width: 320, height: 700 });
    await page.locator('.city-3d-scene canvas').click({ position: { x: 2, y: 220 } });
    await capture(page, info, 'city-scene-320');
    await expect(page.getByRole('group',{name:'City camera'})).toBeInViewport();
    await page.getByRole('button',{name:/^Current city:/}).click();
    await page.getByRole('menuitem',{name:'Village',exact:true}).click();
    await expect(page.getByRole('complementary', { name: 'Village resources and population' })).toBeVisible();
    await expect(page.locator('.city-scene-workspace')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('3D plot construction uses the real command and compact queue through reload', async ({ page }, info) => {
    const world = createSolo('Build Scene');
    world.buildings.find(building => building.building_type === 'market')!.level = 1;
    refreshCityEconomy(world, 1);
    await page.clock.setFixedTime(Date.parse(world.server_now));
    await start(page, world);
    await expect(page.locator('.city-3d-scene.ready')).toBeVisible();
    await page.locator('[data-building="slot:0"]').click();
    const dialog = page.getByRole('dialog', { name: 'Selected building', exact: true });
    await expect(dialog).toContainText('Empty plot');
    await dialog.getByRole('radio', { name: /^Academy/ }).check();
    await dialog.getByRole('button', { name: /^Build Academy/ }).click();
    await expect.poll(async () => (await save(page)).orders.filter(order => order.kind === 'upgrade').length).toBe(1);
    await page.keyboard.press('Escape');
    const queue = page.getByRole('region', { name: 'Construction queue', exact: true });
    await expect(queue).toContainText('Academy');
    await expect(queue.getByRole('progressbar')).toBeVisible();
    await capture(page, info, 'city-scene-construction');
    const order = (await save(page)).orders.find(order => order.kind === 'upgrade')!;
    await page.reload(); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('button', { name: 'City', exact: true }).click();
    expect((await save(page)).orders.find(row => row.id === order.id)?.finish_at).toBe(order.finish_at);
    await page.getByRole('region', { name: 'Construction queue', exact: true }).getByRole('button').click();
    await expect(page.getByRole('dialog', { name: 'Academy', exact: true })).toContainText('Builders are working');
});

test('3D UI retains city switching and useful construction when WebGL is unavailable', async ({ page }, info) => {
    await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
            return ['webgl', 'webgl2', 'experimental-webgl'].includes(type) ? null : Reflect.apply(original, this, [type, ...args]);
        } as typeof original;
    });
    const world = createSolo('Fallback Scene'), town = world.settlements[0];
    world.settlements.push({ ...town, id: 2, name: 'Second City', x: 600, y: 600 });
    world.buildings.push(...world.buildings.map(building => ({ ...building, id: building.id + 100, settlement_id: 2 })));
    await start(page, world);
    await expect(page.locator('.city-fallback-grid')).toBeVisible();
    await selectCity(page,2);
    await expect(page.locator('.city-selector')).toContainText('Second City');
    await page.locator('.city-fallback-grid').getByRole('button', { name: /^Main building/ }).click();
    await page.getByRole('button', { name: 'Construct Main building', exact: true }).click();
    await expect.poll(async () => (await save(page)).orders.find(order => order.kind === 'upgrade')?.settlement_id).toBe(2);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Construction queue', exact: true })).toContainText('Main building');
    await capture(page, info, 'city-scene-fallback');
});


test('3D City Events shows queued building and garrison training, links to their buildings and stays compact on mobile', async ({ page }, info) => {
    const world=createSolo('City Events'),city=world.settlements[0], at=Date.parse(world.server_now);
    world.city_slots=[{settlement_id:city.id,slot_index:0,building_type:'barracks',level:1}];
    world.orders=[
        {id:420,owner_id:city.owner_id,settlement_id:city.id,kind:'upgrade',item:'market',quantity:1,
            started_at:world.server_now,finish_at:new Date(at+180000).toISOString()},
        {id:421,owner_id:city.owner_id,settlement_id:city.id,kind:'recruit',item:'infantry',quantity:8,
            recruit_destination:'garrison',started_at:world.server_now,finish_at:new Date(at+240000).toISOString()},
    ];
    await page.clock.setFixedTime(at);
    await start(page,world);
    const events=page.getByRole('complementary',{name:'City events and activity'});
    await expect(events).toBeVisible();
    await expect(events.locator('.ops-events li')).toHaveCount(2);
    await expect(events).toContainText('Main building');
    await expect(events).toContainText('8 infantry');
    await expect(events.getByText('Events',{exact:true})).toBeVisible();
    await capture(page,info,'city-events-desktop');
    await events.getByRole('button',{name:/View building: Main building/}).click();
    await expect(page.getByRole('dialog',{name:'Selected building',exact:true})).toContainText('Main building');
    await page.keyboard.press('Escape');
    await events.getByRole('button',{name:/View recruiting: 8 infantry/}).click();
    await expect(page.getByRole('dialog',{name:'Selected building',exact:true})).toContainText('Barracks');
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});
    await capture(page,info,'city-events-mobile-folded');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:'Map',exact:true}).click();
    await expect(page.getByRole('complementary',{name:'Map overview and activity'})).toBeVisible();
});

test('City Events lists all cities and sends actual timed reinforcements from its own tab', async ({ page }, info) => {
    const { cellCenter, isWalkable } = await import('../../src/features/map/domain/worldGrid');
    const { findMarchPath } = await import('../../src/features/map/domain/pathfinding');
    const { emptyRoster, writeRoster } = await import('../../src/features/army/domain/roster');
    const { homeArmyPosition, stationCell } = await import('../../src/features/map/domain/garrisons');
    const world = createSolo('Empire Events'), source = world.settlements[0], at = Date.parse(world.server_now);
    const startCell = stationCell(source);
    const targetCell = [[1,0],[-1,0],[0,1],[0,-1],[2,0],[0,2]].map(([dx,dy]) => ({col:startCell.col+dx,row:startCell.row+dy}))
        .find(cell => isWalkable(cell.col,cell.row) && findMarchPath(homeArmyPosition(source),homeArmyPosition(cellCenter(cell.col,cell.row))));
    expect(targetCell).toBeDefined();
    const target = { ...source, ...cellCenter(targetCell!.col,targetCell!.row), id: 88, name: 'Northwatch' };
    world.settlements.push(target);
    world.buildings.push(...world.buildings.filter(row => row.settlement_id === source.id).map(row => ({...row,id:row.id+5000,settlement_id:target.id})));
    const garrison = { owner_id: source.owner_id, settlement_id: source.id, ...emptyRoster() };
    writeRoster(garrison, {...emptyRoster(), infantry: 75, spearmen: 30});
    world.city_garrisons = [garrison];
    world.orders = [
        { id: 501, owner_id: source.owner_id, settlement_id: source.id, kind: 'upgrade', item: 'market', quantity: 1,
            started_at: world.server_now, finish_at: new Date(at+180000).toISOString() },
        { id: 502, owner_id: source.owner_id, settlement_id: target.id, kind: 'upgrade', item: 'wall', quantity: 1,
            started_at: world.server_now, finish_at: new Date(at+230000).toISOString() },
    ];
    await page.clock.setFixedTime(at);
    await start(page,world);
    const panel = page.getByRole('complementary',{name:'City events and activity'});
    await expect(panel.locator('.ops-events li')).toHaveCount(2);
    await expect(panel).toContainText(source.name);
    await expect(panel).toContainText(target.name);
    await panel.getByRole('combobox',{name:'Filter events by city'}).selectOption(String(target.id));
    await expect(panel.locator('.ops-events li')).toHaveCount(1);
    await expect(panel).toContainText('Walls');
    await panel.getByRole('combobox',{name:'Filter events by city'}).selectOption('all');
    await panel.getByRole('tab',{name:'Send troops'}).click();
    const editor = panel.getByRole('region',{name:'Move troops between cities'});
    await expect(editor.getByRole('combobox',{name:'Source city'})).toHaveValue(String(source.id));
    await expect(editor.getByRole('combobox',{name:'Destination city'})).toHaveValue(String(target.id));
    await expect(editor.getByRole('slider',{name:'Select infantry reinforcements'})).toBeVisible();
    await editor.getByRole('button',{name:'All',exact:true}).click();
    await expect(editor.getByRole('button',{name:/^Send troops/})).toBeEnabled();
    await editor.getByRole('button',{name:/^Send troops/}).click();
    await expect.poll(async()=> (await save(page)).city_reinforcements?.length).toBe(1);
    await expect(panel.locator('.ops-events li')).toHaveCount(3);
    await expect(panel).toContainText('reinforcements');
    await capture(page,info,'city-empire-events-and-reinforcements');
    const current = await save(page);
    expect(current.city_reinforcements?.[0]?.target_settlement_id).toBe(target.id);
    expect(current.city_reinforcements?.[0]?.source_settlement_id).toBe(source.id);
});

import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import type { World } from '../../src/shared/model/world';
import { buildingCost } from '../../src/features/city/domain/construction';
import { projectSettlement } from '../../src/features/city/domain/economy';
import { refreshCityEconomy, slotCount } from '../../src/features/city/domain/slots';
import { stationCell } from '../../src/features/map/domain/garrisons';
import { RESOURCES } from '../../src/shared/model/resources';
import { validateSave } from '../../src/platform/storage/saves';

async function start(page: Page, world: World, reducedMotion = true) {
    validateSave(world);
    await page.addInitScript(({w,reducedMotion}) => {
        if (!localStorage.getItem('peris-campaign-v6')) localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, {w:world,reducedMotion});
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('button', { name: 'City', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Village resources and population' })).toBeVisible();
    if (page.viewportSize()!.width < 650) {
        const center = await page.locator('.village-center').boundingBox(), economy = await page.locator('.village-economy').boundingBox();
        const frame=await page.locator('.village-scene-frame').boundingBox();
        expect(frame!.width/frame!.height).toBeCloseTo(1200/900,1);
        expect(center!.height).toBeGreaterThan(frame!.height);
        expect(economy!.y).toBeGreaterThanOrEqual(center!.y + center!.height);
        const population = page.getByRole('complementary', { name: 'Village resources and population' }).getByRole('button', { name: /residents$/ });
        await population.scrollIntoViewIfNeeded();
        await expect(population).toBeInViewport();
        await population.click();
        await expect(page.getByRole('dialog', { name: /city report/ })).toBeVisible();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '3D', exact: true }).scrollIntoViewIfNeeded();
    } else {
        await expect(page.getByRole('button', { name: '3D', exact: true })).toBeInViewport();
    }
}
async function save(page: Page): Promise<World> {
    return page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!));
}
async function selectPlot(page: Page, key: string) {
    await page.locator(`[data-building="${key}"]`).click();
    await expect(page.getByRole('dialog', { name: 'Selected building', exact: true })).toBeVisible();
    return page.getByRole('dialog', { name: 'Selected building', exact: true });
}
async function capture(page: Page, info: TestInfo, name: string) {
    const path = info.outputPath(name + '.png');
    await page.screenshot({ path });
    await info.attach(name, { path, contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('city building popup spends once, shows a persisted queue and completes the real level', async ({ page }, info) => {
    test.setTimeout(90_000);
    const world = createSolo('Village QA'), main = world.buildings.find(building => building.building_type === 'market')!;
    main.level = 1; refreshCityEconomy(world, 1);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await start(page, world); await capture(page, info, 'village-workspace');
    let dialog = await selectPlot(page, 'market');
    await expect(dialog.getByRole('heading', { name: 'Main building', exact: true })).toBeVisible();
    await expect(dialog.getByRole('row', { name: /Building plots/ })).toContainText(String(slotCount(2)));
    const button = dialog.getByRole('button', { name: 'Upgrade to level 2', exact: true });
    await expect(button).toBeEnabled();
    await expect(dialog.locator('.city-building-artwork')).toBeVisible();
    await capture(page, info, 'village-building-popup');
    const before = await save(page), cost = buildingCost('market', 1);
    await button.click();
    await expect.poll(async () => (await save(page)).orders.filter(order => order.kind === 'upgrade').length).toBe(1);
    const sent = await save(page), order = sent.orders.find(order => order.kind === 'upgrade')!;
    const projected = projectSettlement(before.settlements[0], Date.parse(order.started_at));
    for (const resource of RESOURCES) projected[resource] -= cost[resource];
    const paid = projectSettlement(projected, Date.parse(sent.settlements[0].resources_updated_at));
    for (const resource of RESOURCES) expect(Math.abs(sent.settlements[0][resource] - paid[resource])).toBeLessThan(.1);
    await expect(dialog.locator('.building-inspector-work-label')).toHaveText('Builders are working');
    await expect(dialog.locator('.building-inspector-primary')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Selected building', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-building="market"]')).toBeFocused();
    await expect(page.getByRole('complementary', { name: 'Village resources and population' }).getByRole('region', { name: 'Construction queue' })).toContainText('Main building');
    await page.reload(); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('button', { name: 'City', exact: true }).click();
    expect((await save(page)).orders.find(row => row.id === order.id)?.finish_at).toBe(order.finish_at);
    await page.getByRole('complementary', { name: 'Village resources and population' }).getByRole('button', { name: /Main building → 2/ }).click();
    dialog = page.getByRole('dialog', { name: 'Selected building', exact: true });
    await expect(dialog.locator('.building-inspector-work-label')).toHaveText('Builders are working');
    await expect(dialog.locator('.building-inspector-primary')).toHaveCount(0);
    await capture(page, info, 'village-building-in-progress');
    await expect.poll(async () => (await save(page)).buildings.find(building => building.building_type === 'market')?.level, { timeout: 35_000 }).toBe(2);
    await expect(dialog.getByRole('button', { name: 'Upgrade to level 3', exact: true })).toBeEnabled();
    await expect(dialog.locator('.city-building-artwork')).toBeVisible();
    expect((await save(page)).orders.filter(row => row.kind === 'upgrade')).toHaveLength(0);
    expect(errors).toEqual([]);
});

test('city ledger counts only home troops and separates garrison, training and journeys', async ({ page }, info) => {
    const world = createSolo('Station QA'), town = world.settlements[0], base = world.armies[0];
    world.buildings.find(building => building.building_type === 'market')!.level = 1;
    world.city_slots = [{ settlement_id: 1, slot_index: 0, building_type: 'barracks', level: 1 }];
    const now = Date.now(), future = new Date(now + 3_600_000).toISOString();
    world.garrisons = [{ owner_id: base.owner_id, ...stationCell(town), infantry: 7, archers: 3, cavalry: 2 }];
    world.map_plots = [{ owner_id: base.owner_id, settlement_id: 1, col: 2, row: 2, building_type: 'lumber', level: 1 }];
    world.armies.push({ ...base, id: 2, name: 'Away at the field', infantry: 25, archers: 0, cavalry: 0, start_x: 300, start_y: 300, target_x: 300, target_y: 300 });
    world.armies.push({ ...base, id: 3, name: 'Returning party', infantry: 9, archers: 0, cavalry: 0, status: 'moving', start_x: 300, start_y: 300, departure_at: new Date(now).toISOString(), arrival_at: future, march_returning: true });
    world.orders = [{ id: 500, owner_id: base.owner_id, settlement_id: 1, army_id: 1, kind: 'recruit', item: 'infantry', quantity: 5, started_at: new Date(now).toISOString(), finish_at: future }];
    refreshCityEconomy(world, 1);
    await start(page, world);
    const troops = page.getByLabel('Troops stationed in this village', { exact: true });
    await expect(troops.locator('[data-troop="infantry"]')).toHaveText('127');
    await expect(troops.locator('[data-troop="archers"]')).toHaveText('53');
    await expect(troops.locator('[data-troop="cavalry"]')).toHaveText('18');
    await expect(page.getByRole('complementary', { name: 'Village troops and movements' })).toContainText('12 troops awaiting a legion');
    await expect(page.locator('.village-training')).toContainText('5 Legionary');
    await expect(page.locator('.village-movements')).toContainText('Returning home');
    await capture(page, info, 'village-garrison-ledger');
    if (page.viewportSize()!.width < 650) {
        for (const resource of ['Timber', 'Stone', 'Food', 'Gold']) {
            await page.getByRole('complementary', { name: 'Village resources and population' }).getByRole('button', { name: new RegExp(`^${resource} .*Open production details`) }).click();
            await expect(page.getByRole('dialog', { name: /city report/ })).toBeVisible();
            await page.keyboard.press('Escape');
        }
        await page.locator('.village-economy').scrollIntoViewIfNeeded();
        await expect(page.locator('.village-food').getByText('Resident upkeep', { exact: true })).toBeInViewport();
        await expect(page.getByRole('region', { name: 'Construction queue', exact: true })).toBeInViewport();
        await capture(page, info, 'village-resource-ledger');
        await page.locator('.village-army').scrollIntoViewIfNeeded();
        await capture(page, info, 'village-army-ledger');
    }
    await page.getByRole('button', { name: 'Open village ledger', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /city report/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Buildings', exact: true }).click();
    await page.getByLabel('Search city buildings', { exact: true }).fill('barracks');
    await page.getByRole('button', { name: /^Barracks/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Selected building', exact: true });
    await expect(dialog.locator('.building-inspector-training-queue')).toContainText('5 Legionary');
    await dialog.getByLabel('Soldiers to train',{exact:true}).fill('10');
    await expect(dialog.locator('.recruit-timing > span').filter({hasText:'Training time'}).locator('b')).toHaveText('0:20');
    await capture(page, info, 'village-barracks-popup');
});

test('riverside fishery queue reopens the correct site and shows its actual next level', async ({ page }, info) => {
    const world = createSolo('Fishery QA'), now = Date.now();
    world.city_slots = [{ settlement_id: 1, slot_index: 16, building_type: 'fishery', level: 2 }];
    world.orders = [{ id: 501, owner_id: world.players[0].id, settlement_id: 1, kind: 'upgrade', item: 'slot:16:fishery', quantity: 1, started_at: new Date(now).toISOString(), finish_at: new Date(now + 3_600_000).toISOString() }];
    refreshCityEconomy(world, 1);
    await start(page, world);
    const queue = page.getByRole('complementary', { name: 'Village resources and population' }).getByRole('region', { name: 'Construction queue' });
    await queue.getByRole('button', { name: 'Fishery → 3', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Selected building', exact: true });
    await expect(dialog.getByRole('heading', { name: 'Fishery', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Fishery → 3', exact: true })).toBeVisible();
    await expect(dialog.locator('.building-inspector-work-label')).toHaveText('Builders are working');
    await expect(dialog.locator('.building-inspector-primary')).toHaveCount(0);
    await capture(page, info, 'village-fishery-queue');
});

test('city popup preserves building choices, shortages, max levels and mage spellbook', async ({ page }, info) => {
    test.setTimeout(90_000);
    const world = createSolo('Building QA');
    world.buildings.find(building => building.building_type === 'market')!.level = 5;
    world.city_slots = [{ settlement_id: 1, slot_index: 1, building_type: 'mage_tower', level: 10 }];
    refreshCityEconomy(world, 1);
    for (const resource of RESOURCES) world.settlements[0][resource] = 0;
    await start(page, world);
    let dialog = await selectPlot(page, 'slot:0');
    await dialog.getByRole('radio', { name: /^Stables/ }).check();
    await expect(dialog.getByRole('button', { name: 'More supplies needed', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('radio', { name: /^Stables/ })).toBeChecked();
    await capture(page, info, 'village-empty-plot-picker');
    await page.keyboard.press('Escape');
    dialog = await selectPlot(page, 'market');
    await expect(dialog.getByRole('columnheader', { name: 'Benefit', exact: true })).toBeVisible();
    await expect(dialog.locator('.building-inspector-complete')).toContainText('Fully developed');
    await expect(dialog.getByRole('button', { name: /Upgrade to level/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    dialog = await selectPlot(page, 'slot:1');
    await dialog.getByRole('tab',{name:'Upgrade',exact:true}).click();
    await expect(dialog.getByRole('row', { name: /Spells available to research/ })).toContainText('20 / 20');
    await dialog.getByRole('tab',{name:'Spells',exact:true}).click();
    await expect(dialog.getByRole('tabpanel',{name:'Spells',exact:true})).toBeVisible();
    await dialog.getByRole('button', { name: /Open spellbook/ }).click();
    const spellbook = page.getByRole('dialog', { name: 'Mage tower · Spellbook', exact: true });
    await expect(spellbook).toBeVisible();
    await expect(spellbook.getByRole('navigation',{name:'Spell levels',exact:true}).getByRole('button')).toHaveCount(10);
    await page.keyboard.press('Escape');
    await expect(spellbook).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect((await save(page)).orders.filter(order => order.kind === 'upgrade')).toHaveLength(0);
});

test('city remains usable when WebGL is unavailable and the same popup accepts construction', async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
            if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null;
            return Reflect.apply(original, this, [type, ...args]);
        } as typeof original;
    });
    await start(page, createSolo('Fallback QA'));
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.locator('.city-fallback-grid')).toBeVisible();
    await page.locator('.city-fallback-grid').getByRole('button', { name: /^Main building/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Selected building', exact: true });
    await expect(dialog.getByRole('button', { name: 'Construct Main building', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Construct Main building', exact: true }).click();
    await expect.poll(async () => (await save(page)).orders.filter(order => order.kind === 'upgrade').length).toBe(1);
    await capture(page, info, 'village-graphics-fallback');
});

test('painted city loads sixteen separate plots and retains progress through reload and view changes', async ({ page }, info) => {
    const world=createSolo('Painted city QA');
    for(const building of world.buildings) building.level=building.building_type==='market'?5:3;
    world.city_slots=Array.from({length:16},(_,slot_index)=>({settlement_id:1,slot_index,building_type:'housing' as const,level:2}));
    world.city_slots.push({settlement_id:1,slot_index:16,building_type:'fishery',level:2});
    refreshCityEconomy(world,1);
    await start(page,world);
    const village=page.locator('.painted-settlement-scene');
    await expect(village).toBeVisible();
    await expect(village.locator('.city-building-artwork')).toHaveCount(21);
    await expect(village.locator('[data-building^="slot:"]')).toHaveCount(16);
    expect(await village.getAttribute('data-city-shape')).toBe('square');
    const overlaps=await village.locator('.city-building-artwork').evaluateAll(els=>{
        const bad:string[][]=[];
        for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){
            const a=els[i].getBoundingClientRect(),b=els[j].getBoundingClientRect();
            if(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)bad.push([els[i].parentElement!.dataset.building!,els[j].parentElement!.dataset.building!]);
        }return bad;
    });expect(overlaps).toEqual([]);
    expect(await village.locator('.painted-city-water').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
    await capture(page,info,'painted-city-sixteen-plots');
    const before=await save(page);
    await selectPlot(page,'slot:15');
    await expect(page.getByRole('dialog',{name:'Selected building',exact:true}).locator('.city-building-artwork')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'3D',exact:true}).click();
    await expect(village).toHaveCount(0);
    await page.getByRole('button',{name:'Village',exact:true}).click();
    await expect(village.locator('.city-building-artwork')).toHaveCount(21);
    await page.reload();await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('button',{name:'City',exact:true}).click();
    await expect(village.locator('.city-building-artwork')).toHaveCount(21);
    const after=await save(page);
    expect(after.city_slots).toEqual(before.city_slots);
    expect(after.buildings).toEqual(before.buildings);
    expect(after.orders).toEqual(before.orders);
});

test('village patrols move, roads use the gate, and decorative residents preserve construction controls', async ({page},info) => {
    const world=createSolo('Village activity QA');
    for(const b of world.buildings) b.level=b.building_type==='market'?5:3;
    world.city_slots=Array.from({length:16},(_,slot_index)=>({settlement_id:1,slot_index,building_type:slot_index===0?'barracks' as const:'housing' as const,level:2}));
    world.city_slots.push({settlement_id:1,slot_index:16,building_type:'fishery',level:2});
    refreshCityEconomy(world,1);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await start(page,world,false);
    const village=page.locator('.painted-settlement-scene');
    await village.scrollIntoViewIfNeeded();
    await expect(village.locator('[data-city-activity=patrol]')).toHaveCount(2);
    await expect(village.locator('[data-city-activity=training]')).toHaveCount(2);
    for(const kind of ['lumbering','mining','harvesting','fishing'])await expect(village.locator(`[data-city-activity=${kind}]`)).toHaveCount(1);
    const wheel=village.locator('.city-work-wheel');
    const angle=()=>wheel.evaluate(el=>getComputedStyle(el).transform);
    const wheelBefore=await angle();await page.waitForTimeout(220);expect(await angle()).not.toEqual(wheelBefore);
    const guard=village.locator('.city-npc-travel').first();
    await expect(guard.locator('ellipse').first()).toBeVisible();
    const position=()=>guard.locator('ellipse').first().evaluate(el=>{const p=el.getBoundingClientRect();return [p.x,p.y]});
    const before=await position();await page.waitForTimeout(300);expect(await position()).not.toEqual(before);
    expect(await village.locator('.painted-city-activity').evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('none');
    const invalidRoads=await village.evaluate(el=>{
        const floor=el.querySelector('clipPath path') as SVGPathElement;
        return Array.from(el.querySelectorAll('[data-city-road=outside]')).filter(road=>{
            const p=road as SVGPathElement,n=p.getTotalLength();
            return Array.from({length:201},(_,i)=>p.getPointAtLength(n*i/200)).some(q=>floor.isPointInFill(q));
        }).length;
    });expect(invalidRoads).toBe(0);
    await capture(page,info,'village-wall-patrols-training');
    await selectPlot(page,'slot:0');
    await expect(page.getByRole('dialog',{name:'Selected building',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
    await expect(village).toHaveAttribute('data-hidden','true');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const stopped=await position();await page.waitForTimeout(180);expect(await position()).toEqual(stopped);
    const stoppedWheel=await angle();await page.waitForTimeout(150);expect(await angle()).toEqual(stoppedWheel);
    await page.emulateMedia({reducedMotion:'reduce'});
    await expect(village.locator('.painted-city-activity')).toBeHidden();
    expect((await save(page)).city_slots).toEqual(world.city_slots);
});

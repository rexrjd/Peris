import { test, expect, type Page } from '@playwright/test';
import { selectCity } from './helpers/selectCity';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { refreshCityEconomy } from '../../src/features/city/domain/slots';
import type { World } from '../../src/shared/model/world';
import type { Faction } from '../../src/features/factions/domain/factions';

async function start(page: Page, world: World, reduced = false) {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.addInitScript(({ world, reduced }) => {
        localStorage.setItem('peris-campaign-v6', JSON.stringify(world));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: reduced }));
        localStorage.setItem(`peris-welcome:${world.players[0].id}:${world.players[0].created_at}`, 'yes');
    }, { world, reduced });
    await page.goto('/'); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('button', { name: 'City', exact: true }).click();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.locator('.city-3d-scene.ready canvas')).toBeVisible();
}
function fixture(faction: Faction = 'roman') {
    const world = createSolo('Drill yard'); world.settlements[0].faction = faction;
    world.buildings.forEach(building => { building.level = building.building_type === 'market' ? 2 : 5; });
    world.city_slots = [{ settlement_id: 1, slot_index: 0, building_type: 'barracks', level: 5 }, { settlement_id: 1, slot_index: 1, building_type: 'housing', level: 5 }];
    refreshCityEconomy(world, 1); return world;
}

test('real recruitment starts battle-rig training, pauses for reduced motion and ends with the queue', async ({ page }, info) => {
    test.setTimeout(100_000);
    const world = fixture(), errors: string[] = [], models: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /THREE|Shader|GL_INVALID/i.test(message.text())) errors.push(message.text()); });
    page.on('response', response => { if (response.url().includes('/models/battle/roman-army.glb') && response.ok()) models.push(response.url()); });
    await start(page, world); const canvas = page.locator('.city-3d-scene.ready canvas');
    await expect(canvas).toHaveAttribute('data-city-training', 'none');
    await page.locator('[data-building="slot:0"]').click();
    const dialog = page.getByRole('dialog', { name: 'Selected building', exact: true });
    await dialog.getByLabel('Soldiers to train', { exact: true }).fill('20');
    await dialog.getByRole('button', { name: /^Train 20 / }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!).orders.filter((order: { kind: string }) => order.kind === 'recruit').length)).toBe(1);
    await page.keyboard.press('Escape');
    await expect(canvas).toHaveAttribute('data-city-training', 'ready', { timeout: 30_000 });
    expect(models.length).toBeGreaterThan(0);
    const phase = Number(await canvas.getAttribute('data-city-training-phase'));
    await expect.poll(async () => Number(await canvas.getAttribute('data-city-training-phase'))).toBeGreaterThan(phase + .15);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(canvas).toHaveAttribute('data-city-training-phase', '0.00');
    await canvas.focus(); await page.mouse.move(5, 150);
    await page.screenshot({ path: info.outputPath('training-active.png') });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(async () => Number(await canvas.getAttribute('data-city-training-phase'))).toBeGreaterThan(phase);
    // The already-built barracks disables a second construction in the real picker.
    await page.locator('[data-building="slot:2"]').click();
    await page.getByRole('radio', { name: /^Barracks/ }).check();
    await expect(page.getByRole('button', { name: 'One barracks per city', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(canvas).toHaveAttribute('data-city-training', 'none', { timeout: 45_000 });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!).armies[0].infantry)).toBe(world.armies[0].infantry + 20);
    expect(errors).toEqual([]);
});

for (const faction of ['elf', 'orc'] as Faction[]) test(`${faction} trainees use their battle models and city switching hides unrelated training`, async ({ page, isMobile }, info) => {
    test.skip(isMobile, 'The real recruitment flow exercises mobile; faction model checks run on desktop.');
    const world = fixture(faction), town = world.settlements[0];
    world.settlements.push({ ...town, id: 2, name: 'Quiet city', x: town.x + 128, y: town.y + 128 });
    world.buildings.push(...world.buildings.map(building => ({ ...building, id: building.id + 100, settlement_id: 2 })));
    world.city_slots!.push({ settlement_id: 2, slot_index: 0, building_type: 'barracks', level: 3 });
    world.orders = [{ id: 1000, kind: 'recruit', owner_id: town.owner_id, settlement_id: 1, army_id: world.armies[0].id, item: faction === 'elf' ? 'archers' : 'spearmen', quantity: 30, started_at: new Date().toISOString(), finish_at: new Date(Date.now() + 600_000).toISOString() }];
    await start(page, world, true); const canvas = page.locator('.city-3d-scene.ready canvas');
    await expect(canvas).toHaveAttribute('data-city-training', 'ready', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Zoom city out', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom city out', exact: true }).click();
    await page.screenshot({ path: info.outputPath(`city-${faction}-wide.png`) });
    await page.getByRole('button', { name: 'Zoom city in', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom city in', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom city in', exact: true }).click();
    const marker = (await page.locator('[data-building="slot:0"]').boundingBox())!;
    await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
    await page.mouse.wheel(0, -300);
    await canvas.focus(); await page.mouse.move(5,150);
    await page.screenshot({ path: info.outputPath(`city-${faction}-training.png`) });
    await selectCity(page,2);
    await expect(canvas).toHaveAttribute('data-city-training', 'none');
    await selectCity(page,1);
    await expect(canvas).toHaveAttribute('data-city-training', 'ready');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('dense scenery remains usable at the widest phone view', async ({ page, isMobile }, info) => {
    test.skip(!isMobile, 'Phone framing is the tighter portrait case.');
    await page.setViewportSize({ width: 320, height: 700 });
    await start(page, fixture(), true);
    await page.getByRole('button', { name: 'Zoom city out', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom city out', exact: true }).click();
    const canvas = page.locator('.city-3d-scene.ready canvas');
    await expect(canvas).toHaveAttribute('data-city-zoom', '0.700');
    await page.screenshot({ path: info.outputPath('city-phone-wide.png') });
    await page.getByRole('button', { name: 'Rotate city right', exact: true }).click();
    await page.screenshot({ path: info.outputPath('city-phone-wide-rotated.png') });
    await page.locator('[data-building="slot:0"]').click();
    await expect(page.getByRole('dialog', { name: 'Selected building', exact: true })).toContainText('Barracks');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

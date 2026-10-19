import { test, expect } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import type { Faction } from '../../src/features/factions/domain/factions';

test('city selection keeps land actions and faction styling together across map and 3D city', async ({ page }, info) => {
    const world = createSolo('Scene HUD'), town = world.settlements[0];
    world.settlements.push({ ...town, id: 2, name: 'Silverwood', faction: 'elf', x: town.x + 1024, y: town.y + 512 });
    world.buildings.push(...world.buildings.map(building => ({ ...building, id: building.id + 100, settlement_id: 2 })));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(w => {
        localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
        sessionStorage.setItem(`peris-city-view:${w.players[0].id}`, '3d');
    }, world);
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    const card = page.locator('.map-city-card .city-selector');
    await expect(card.getByRole('button', { name: /^Choose land:/ })).toBeVisible();
    await card.getByRole('button', { name: /^Choose land:/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Select a highlighted field' })).toBeVisible();
    await page.getByRole('button', { name: 'Close claim mode' }).click();
    await page.getByRole('button', { name: /^Current city:/ }).click();
    await page.getByRole('menuitemradio', { name: /^Silverwood/ }).click();
    await expect(card).toContainText('Land');
    const mapMaterial = await card.locator('.city-selector-card').evaluate(el => getComputedStyle(el).backgroundImage);
    expect(mapMaterial).toContain('elf-texture');
    const view = page.getByRole('group', { name: 'Map view controls' });
    await expect(view).toBeVisible();
    await view.getByRole('button', { name: 'Show field grid' }).click();
    await expect(view.getByRole('button', { name: 'Show field grid' })).toHaveAttribute('aria-pressed', 'false');
    await view.getByRole('button', { name: 'Focus your settlement', exact: true }).click();
    await page.screenshot({ path: info.outputPath('elf-map.png') });
    await page.getByRole('button', { name: 'City', exact: true }).click();
    await expect(page.locator('.city-3d-scene.ready')).toBeVisible();
    const city = page.locator('.city-scene-workspace');
    await expect(city.locator('.city-scene-dock, .city-scene-status, .city-scene-utilities')).toHaveCount(0);
    await expect(city.getByText('Builders ready', { exact: true })).toHaveCount(0);
    expect(await city.locator('.city-selector-card').evaluate(el => getComputedStyle(el).backgroundImage)).toBe(mapMaterial);
    await page.getByRole('button', { name: 'Open city economy report' }).click();
    const report = page.getByRole('dialog', { name: /city report/ });
    await expect(report).toBeVisible();
    expect(await report.evaluate(el => getComputedStyle(el).backgroundImage)).toContain('elf-texture');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: info.outputPath('elf-city.png') });
    await city.getByRole('button', { name: /^Choose land:/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Select a highlighted field' })).toBeVisible();
    await page.getByRole('button', { name: 'Close claim mode' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
});

test('minimap search and campaign rewards stay usable on a short screen', async ({ page }, info) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const world = createSolo('Landscape HUD');
    world.players[0].upgrades = 1;
    await page.addInitScript(w => {
        localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/'); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('button', { name: 'Find a field', exact: true }).click();
    const search = page.getByRole('group', { name: 'Find a field' });
    await search.getByLabel(/Field X coordinate/).fill('1');
    await search.getByLabel(/Field Y coordinate/).fill('1');
    await expect(search.getByRole('button', { name: 'Go', exact: true })).toBeInViewport();
    await search.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close map details' })).toBeInViewport();
    expect((await page.locator('.ops-selection').boundingBox())!.height).toBeGreaterThan(90);
    await page.getByRole('button', { name: 'Close map details' }).click();
    await page.getByRole('button', { name: 'Quick access', exact: true }).click();
    await page.getByRole('button', { name: /^Campaign & rewards/ }).click();
    const campaign = page.getByRole('complementary', { name: 'Starting campaign and world regions' });
    await expect(campaign).toBeVisible();
    await expect(campaign.getByRole('button', { name: 'Close starting campaign' })).toBeInViewport();
    await page.screenshot({ path: info.outputPath('short-map-campaign.png') });
    await campaign.getByRole('button', { name: 'Close starting campaign' }).click();
    await expect(campaign).toHaveCount(0);
});

for (const factions of [
    ['roman', 'orc', 'elf', 'spartan', 'persian', 'egyptian'],
    ['dwarf', 'gnome', 'pandaren', 'undead', 'demon'],
] as Faction[][]) test(`switching city factions updates shared map surfaces: ${factions.join(', ')}`, async ({ page, isMobile }, info) => {
    test.skip(isMobile, 'Faction materials are shared; phone interactions are covered above.');
    test.setTimeout(120_000);
    const world = createSolo('Faction HUD'), town = world.settlements[0], buildings = world.buildings;
    world.settlements = factions.map((faction, index) => ({ ...town, id: index + 1, name: `Theme ${faction}`, faction, x: town.x + index * 512 }));
    world.buildings = factions.flatMap((_, index) => buildings.map(building => ({ ...building, id: index * 100 + building.id, settlement_id: index + 1 })));
    await page.addInitScript(w => {
        localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/'); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    for (const faction of factions) {
        await page.getByRole('button', { name: /^Current city:/ }).click();
        await page.getByRole('menuitemradio', { name: new RegExp(`^Theme ${faction},`) }).click();
        for (const selector of ['.city-selector-card', '.game-navigation', '.game-header-actions', '.army-map-dock', '.map-view-controls', '.scene-minimap', '.ops-widget']) {
            expect(await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundImage)).toContain(`${faction}-texture.webp`);
        }
        if (['roman', 'orc', 'elf'].includes(faction)) await page.screenshot({ path: info.outputPath(`${faction}-materials.png`) });
    }
});

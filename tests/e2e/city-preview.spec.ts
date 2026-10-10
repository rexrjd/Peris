import { test, expect, type Page, type Locator, type TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { refreshCityEconomy } from '../../src/features/city/domain/slots';

async function start(page: Page) {
    const world = createSolo('Preview QA');
    world.settlements[0].faction = 'dwarf';
    world.buildings.find(building => building.building_type === 'market')!.level = 5;
    world.city_slots = [{ settlement_id: 1, slot_index: 0, building_type: 'mage_tower', level: 10 }];
    refreshCityEconomy(world, 1);
    await page.addInitScript(w => {
        localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('button', { name: 'City', exact: true }).click();
    await page.getByRole('button', { name: 'Buildings', exact: true }).click();
}

async function modelPixels(preview: Locator, info: TestInfo, name: string) {
    await expect(preview.locator('canvas')).toBeVisible();
    await expect.poll(async () => preview.locator('canvas').evaluate(canvas => {
        const surface = canvas as HTMLCanvasElement, gl = surface.getContext('webgl2');
        return !!gl && !gl.isContextLost() && surface.width > 20 && surface.height > 20;
    })).toBe(true);
    await expect(preview.locator('.city-building-model-fallback')).toHaveCount(0);
    const pixels = await preview.locator('canvas').screenshot();
    await info.attach(name, { body: pixels, contentType: 'image/png' });
    const { data, info: image } = await sharp(pixels).raw().toBuffer({ resolveWithObject: true });
    let bright = 0;
    // The preview's background is dark green. These brighter pixels must come
    // from the model, preventing a visible-but-blank canvas from passing.
    for (let i = 0; i < data.length; i += image.channels) if (Math.max(data[i], data[i + 1], data[i + 2]) > 120) bright++;
    expect(bright).toBeGreaterThan(100);
    return pixels;
}

test('building popup renders actual models through StrictMode, faction changes and context recovery', async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await start(page);
    await page.getByRole('button', { name: /^Main building/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Selected building', exact: true });
    const preview = dialog.locator('.city-building-model-preview');
    const before = await modelPixels(preview, info, 'dwarf-hall-preview');
    await dialog.getByText('City settings & debug', { exact: true }).click();
    await dialog.getByLabel('CITY FACTION', { exact: true }).selectOption('persian');
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!).settlements[0].faction)).toBe('persian');
    const after = await modelPixels(preview, info, 'persian-hall-preview');
    expect(after.equals(before)).toBe(false);
    await preview.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext());
    await expect(preview.locator('.city-building-model-fallback')).toBeVisible();
    await expect(preview.locator('.city-building-model-fallback')).toContainText('Main building');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Main building/ }).click();
    await modelPixels(page.locator('.village-building-dialog .city-building-model-preview'), info, 'reopened-hall-preview');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Mage tower/ }).click();
    await modelPixels(page.locator('.village-building-dialog .city-building-model-preview'), info, 'level-ten-mage-preview');
    expect(errors).toEqual([]);
});

test('building popup keeps an accessible named icon when WebGL is unavailable', async ({ page }, info) => {
    await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
            if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null;
            return original.call(this, type, ...args);
        } as typeof original;
    });
    await start(page);
    await page.getByRole('button', { name: /^Main building/ }).click();
    const preview = page.getByRole('dialog', { name: 'Selected building', exact: true }).getByRole('img', { name: 'Main building, level 5', exact: true });
    await expect(preview.locator('.city-building-model-fallback')).toBeVisible();
    await expect(preview.locator('.city-building-model-fallback')).toContainText('Main building');
    await expect(preview.locator('canvas')).toBeHidden();
    await info.attach('no-WebGL-building-preview', { body: await preview.screenshot(), contentType: 'image/png' });
});

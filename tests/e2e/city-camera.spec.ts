import { test, expect, type Page } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { refreshCityEconomy, type SlotType } from '../../src/features/city/domain/slots';

async function city(page: Page) {
    const world = createSolo('Camera test');
    world.buildings.forEach(building => { building.level = 5; });
    world.city_slots = ['smithy', 'academy', 'housing', 'mage_tower', 'granary', 'stables'].map((type, i) => ({ settlement_id: 1, slot_index: i, building_type: type as SlotType, level: type === 'mage_tower' ? 10 : 5 }));
    world.city_slots.push({ settlement_id: 1, slot_index: 16, building_type: 'fishery', level: 5 });
    refreshCityEconomy(world, 1);
    await page.addInitScript(w => {
        localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('button', { name: 'City', exact: true }).click();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.locator('.city-3d-scene.ready canvas')).toBeVisible();
    return page.locator('.city-3d-scene canvas');
}

test('wheel and bottom controls rotate and zoom the real 3D city; reset restores framing', async ({ page, isMobile }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const canvas = await city(page);
    await expect(canvas).toHaveAttribute('data-city-zoom', '1.000');
    if (!isMobile) {
        const bounds = (await canvas.boundingBox())!;
        await page.mouse.move(bounds.x + bounds.width * .52, bounds.y + bounds.height * .5);
        await page.mouse.wheel(0, -200);
        await expect.poll(async () => Number(await canvas.getAttribute('data-city-zoom'))).toBeGreaterThan(1.3);
        await page.mouse.wheel(0, 400);
        await expect.poll(async () => Number(await canvas.getAttribute('data-city-zoom'))).toBeLessThan(1);
        await page.keyboard.press('q'); await expect(canvas).toHaveAttribute('data-city-rotation', '-0.393');
        await page.keyboard.press('e'); await expect(canvas).toHaveAttribute('data-city-rotation', '0.000');
    }
    await page.getByRole('button', { name: 'Reset city camera', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-city-zoom', '1.000');
    await page.getByRole('button', { name: 'Rotate city right', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-city-rotation', '0.393');
    await page.getByRole('button', { name: 'Zoom city in', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-city-zoom', '1.200');
    await page.getByRole('button', { name: 'Zoom city out', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-city-zoom', '1.000');
    await page.screenshot({ path: info.outputPath('city-rotated.png') });
    await page.locator('[data-building="market"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const rotation = await canvas.getAttribute('data-city-rotation');
    await page.keyboard.press('q'); await expect(canvas).toHaveAttribute('data-city-rotation', rotation!);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open city building list', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Find a city building' }).fill('qe');
    await page.keyboard.press('q'); await expect(canvas).toHaveAttribute('data-city-rotation', rotation!);
    await page.getByRole('button', { name: 'Close city panel', exact: true }).click();
    await page.getByRole('button', { name: 'Reset city camera', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-city-rotation', '0.000');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('city-default.png') });
    expect(errors).toEqual([]);
});

test('building effects render and city controls resume when reduced motion is toggled', async ({ page, isMobile }, info) => {
    test.skip(isMobile, 'Shared renderer motion is exercised once on desktop; touch camera controls have their own coverage.');
    const canvas = await city(page);
    await page.evaluate(() => document.documentElement.classList.remove('reduced-motion'));
    await page.getByRole('button', { name: 'Zoom city in', exact: true }).click();
    await page.screenshot({ path: info.outputPath('city-working.png') });
    await page.getByRole('button', { name: 'Rotate city right', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-city-rotation', '0.393');
    await page.evaluate(() => document.documentElement.classList.add('reduced-motion'));
    await page.getByRole('button', { name: 'Reset city camera', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-city-rotation', '0.000');
    await page.evaluate(() => document.documentElement.classList.remove('reduced-motion'));
    await page.getByRole('button', { name: 'Rotate city left', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-city-rotation', '-0.393');
    await page.screenshot({ path: info.outputPath('city-working-rotated.png') });
});

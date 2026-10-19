import { test, expect, type Page } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { refreshCityEconomy } from '../../src/features/city/domain/slots';
import { cityEnvironment } from '../../src/features/city/domain/environment';
import { getCell, cellCenter, type FieldTerrain } from '../../src/features/map/domain/worldGrid';

function sample(terrain: FieldTerrain, water?: 'none' | 'coast') {
    for (let row = -100; row < 100; row++) for (let col = -100; col < 100; col++) {
        if (getCell(col, row).terrain !== terrain) continue;
        const point = cellCenter(col, row);
        if (!water || cityEnvironment(point).water === water) return point;
    }
    throw new Error(`Missing ${terrain}/${water} fixture`);
}

function realm() {
    const world = createSolo('City identity'), town = world.settlements[0], buildings = [...world.buildings];
    const locations = [
        { name: 'Forest', ...sample('forest', 'none') }, { name: 'Desert', ...sample('desert', 'none') },
        { name: 'Snow', ...sample('snow', 'none') }, { name: 'River', ...cellCenter(5, 3) },
        { name: 'Shore', ...sample('grassland', 'coast') }, { name: 'Other forest', ...cellCenter(-50, -30) },
    ];
    world.settlements = locations.map((location, i) => ({ ...town, ...location, id: i + 1, faction: 'roman' }));
    world.buildings = locations.flatMap((_, i) => buildings.map(building => ({ ...building, id: i * 100 + building.id, settlement_id: i + 1, level: 3 })));
    world.city_slots = locations.flatMap((_, i) => [
        { settlement_id: i + 1, slot_index: 0, building_type: 'housing' as const, level: 2 },
        { settlement_id: i + 1, slot_index: 1, building_type: 'barracks' as const, level: 2 },
    ]);
    for (const city of world.settlements) refreshCityEconomy(world, city.id);
    return world;
}

async function open(page: Page) {
    const world = realm();
    await page.addInitScript(w => {
        if (!localStorage.getItem('peris-campaign-v6')) localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('button', { name: 'City', exact: true }).click();
    return world;
}

test('city geography, seeded boundaries and fishery access stay consistent in both views', async ({ page }, info) => {
    test.setTimeout(180_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const world = await open(page), outlines = new Set<string>();
    for (const town of world.settlements) {
        await page.getByRole('combobox', { name: 'Current city', exact: true }).selectOption(String(town.id));
        const environment = cityEnvironment(town), village = page.locator('.painted-settlement-scene');
        await expect(village).toHaveAttribute('data-city-terrain', environment.terrain);
        await expect(village).toHaveAttribute('data-city-water', environment.water);
        await expect(village.locator('[data-building="fishery"]')).toHaveCount(environment.water === 'none' ? 0 : 1);
        const boundary = await village.locator('[data-walkable="court"]').getAttribute('d');
        expect(outlines.has(boundary!)).toBe(false); outlines.add(boundary!);
        // Inspect the rendered SVG geometry, rather than the canvas accessibility tree.
        const escapes = await village.evaluate(root => {
            const court = root.querySelector('[data-walkable="court"]') as SVGPathElement;
            return [...root.querySelectorAll('[data-building^="slot:"]')].filter(plot => {
                const r = plot.getBoundingClientRect();
                return [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].some(([x, y]) =>
                    !court.isPointInFill(new DOMPoint(x, y).matrixTransform(court.getScreenCTM()!.inverse())));
            }).map(plot => plot.getAttribute('data-building'));
        });
        expect(escapes).toEqual([]);
        const wetWorksites = await village.evaluate(root => {
            const water = [...root.querySelectorAll('[data-city-water-surface]')] as SVGGeometryElement[];
            return ['lumber', 'quarry', 'farm'].filter(key => {
                const r = root.querySelector(`[data-building="${key}"]`)!.getBoundingClientRect();
                return water.some(surface => [[r.left,r.top],[r.right,r.top],[r.left,r.bottom],[r.right,r.bottom],[(r.left+r.right)/2,(r.top+r.bottom)/2]].some(([x,y]) => {
                    const point = new DOMPoint(x,y).matrixTransform(surface.getScreenCTM()!.inverse());
                    return surface.getAttribute('fill') === 'none' ? surface.isPointInStroke(point) : surface.isPointInFill(point);
                }));
            });
        });
        expect(wetWorksites).toEqual([]);
        await village.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`${town.id}-${town.name}-village.png`) });
        await village.locator('[data-building="slot:2"]').click();
        await expect(page.getByRole('dialog', { name: 'Selected building', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '3D', exact: true }).click();
        const scene = page.locator('.city-3d-scene.ready');
        await expect(scene).toHaveAttribute('data-city-seed', String(environment.seed));
        await expect(scene).toHaveAttribute('data-city-water', environment.water);
        await expect(scene.locator('[data-building="fishery"]')).toHaveCount(environment.water === 'none' ? 0 : 1);
        await page.getByRole('button', { name: 'Rotate city right', exact: true }).click();
        await expect(scene.locator('canvas')).toHaveAttribute('data-city-rotation', '0.393');
        await page.screenshot({ path: info.outputPath(`${town.id}-${town.name}-3d.png`) });
        await page.getByRole('button', { name: 'Village', exact: true }).click();
    }
    // The last city has the same faction and levels as the first, so switching must still rebuild its scene.
    await page.getByRole('combobox', { name: 'Current city', exact: true }).selectOption('1');
    const seed = await page.locator('.painted-settlement-scene').getAttribute('data-city-seed');
    await page.reload();
    await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await page.getByRole('button', { name: 'City', exact: true }).click();
    await expect(page.locator('.painted-settlement-scene')).toHaveAttribute('data-city-seed', seed!);
    expect(errors).toEqual([]);
});

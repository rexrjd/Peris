import { test, expect } from '@playwright/test';

// Keep faction changes in the same page, but give each short sequence its own
// test deadline. Eleven software-rendered armies must not share one four-minute
// clock. Every individual model load retains its existing 60-second limit.
const batches = [
    ['roman', 'spartan', 'persian'],
    ['egyptian', 'orc', 'elf'],
    ['dwarf', 'gnome', 'pandaren'],
    ['undead', 'demon'],
];

test.describe('published faction roster changes', () => {
    // Keep each batch independently shardable with no shared browser state.
    test.describe.configure({ mode: 'parallel' });
    for (const factions of batches) {
        test(`${factions.join(', ')} load meshes or explicit withheld fallbacks and their own portraits`, async ({ page }, testInfo) => {
            test.setTimeout(240000);
            test.skip(testInfo.project.name === 'mobile-chromium');
            const errors: string[] = [], assets = new Map<string, number>();
            page.on('pageerror', error => errors.push(error.message));
            page.on('response', response => {
                const path = new URL(response.url()).pathname;
                if (path.match(/\/models\/battle\/.+-(?:roster|army)(?:-lod)?\.glb$/)) assets.set(path, response.status());
            });
            const report = await (await page.request.get('/models/battle/faction-rosters.json')).json();
            const enabled = (faction: string) => !report.withheld?.[faction] && !!report.factions?.[faction]?.near && !!report.factions?.[faction]?.far;
            const pack = (faction: string) => enabled(faction) && enabled('roman') ? 'textured' : enabled(faction) || enabled('roman') ? 'mixed' : 'earlier';
            await page.goto('/?battle-preview=1');
            await expect(page.locator('.battle-art-preview')).toHaveAttribute('data-model-pack', pack('orc'));
            for (const faction of factions) {
                await page.getByLabel('Your faction').selectOption(faction);
                await expect(page.locator('.battle-art-preview')).toHaveAttribute('data-model-pack', pack(faction));
                await expect(page.locator('.army-loading')).toHaveCount(0, { timeout: 60000 });
                await expect(page.locator('.battle-3d-label.friendly')).toHaveCount(7);
                for (const suffix of ['', '-lod']) {
                    await expect.poll(() => assets.get(`/models/battle/${faction}-${enabled(faction) ? 'roster' : 'army'}${suffix}.glb`), { timeout: 60000 }).toBe(200);
                }
                await expect(page.locator('.unit-card .faction-portrait').first()).toHaveAttribute('style', new RegExp(`/roster/${faction}.png`));
            }
            expect(errors).toEqual([]);
        });
    }
});

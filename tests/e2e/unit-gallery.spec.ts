import { test, expect, type Locator } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function renderedPixels(canvas: Locator) {
    return canvas.evaluate((element: HTMLCanvasElement) => {
        const gl = element.getContext('webgl2');
        if (!gl) throw new Error('Gallery has no WebGL2 context');
        const pixels = new Uint8Array(element.width * element.height * 4);
        gl.readPixels(0, 0, element.width, element.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let hash = 2166136261;
        for (const pixel of pixels) hash = Math.imul(hash ^ pixel, 16777619);
        return hash >>> 0;
    });
}

test('solo gallery renders every published role, plays motion and preserves the campaign', async ({ page }, testInfo) => {
    test.setTimeout(600000);
    if (testInfo.project.name === 'mobile-chromium') test.skip();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('peris-solo-v6', 'gallery-preserves-campaign'));
    const report = await (await page.request.get('/models/battle/faction-rosters.json')).json();
    await page.goto('/?unit-gallery=1&faction=roman');
    const status = page.getByTestId('gallery-status'), canvas = page.locator('.gallery-canvas canvas');
    for (const faction of ['roman', 'spartan', 'persian', 'egyptian', 'orc', 'elf', 'dwarf', 'gnome', 'pandaren', 'undead', 'demon']) {
        await page.getByLabel('Gallery faction', { exact: true }).selectOption(faction);
        await expect(page.getByLabel('Gallery unit', { exact: true }).locator('option')).toHaveCount(9);
        const enabled = !report.withheld?.[faction] && report.factions?.[faction]?.near && report.factions?.[faction]?.far;
        if (!enabled) {
            await expect(status).toContainText('awaiting publication');
            await expect(canvas).toBeHidden();
            continue;
        }
        const captures: object[] = [];
        const modelBytes = await (await page.request.get(`/models/battle/${faction}-roster.glb`)).body();
        const model = JSON.parse(modelBytes.toString('utf8', 20, 20 + modelBytes.readUInt32LE(12)));
        for (const role of ['line_infantry', 'spear_guard', 'archer', 'elite', 'scout', 'light_cavalry', 'heavy_cavalry', 'ram', 'catapult']) {
            await page.getByLabel('Gallery unit', { exact: true }).selectOption(role);
            await expect(status).toContainText(`Ready · ${role} ·`, { timeout: 90000 });
            // GLTFLoader creates one mesh per primitive, including nodes with
            // multiple surfaces. Count the published geometry independently.
            const expectedParts = model.nodes.filter((node: { name: string; mesh?: number; extras?: { peris_role?: string } }) => node.mesh !== undefined && (node.extras?.peris_role === role || !node.extras?.peris_role && node.name.startsWith(role)))
                .reduce((count: number, node: { mesh: number }) => count + model.meshes[node.mesh].primitives.length, 0);
            await expect(status).toContainText(` · ${expectedParts} mesh parts · `);
            await expect(canvas).toBeVisible();
            expect(await renderedPixels(canvas)).not.toBe(0);
            if (report.factions[faction].sourceEdition) await expect(page.locator('main.unit-gallery')).toHaveAttribute('data-model-edition', report.factions[faction].sourceEdition);
            if (report.factions[faction].near.sha256) await expect(page.locator('main.unit-gallery')).toHaveAttribute('data-model-sha256', report.factions[faction].near.sha256);
            const file = `${faction}-${role}-webgl.png`, bounds = (await canvas.boundingBox())!;
            const label = await page.getByLabel('Gallery unit', { exact: true }).locator('option:checked').innerText();
            await page.screenshot({ path: testInfo.outputPath(file), fullPage: true });
            captures.push({ faction, role, label, file, detail: 'near', edition: report.factions[faction].sourceEdition, sha256: report.factions[faction].near.sha256, status: await status.innerText(), stageBounds: [Math.round(bounds.x), Math.round(bounds.y), Math.round(bounds.width), Math.round(bounds.height)] });
        }
        await writeFile(testInfo.outputPath(`${faction}-captures.json`), JSON.stringify({ captures }, null, 2) + '\n');
    }
    await page.getByLabel('Gallery faction', { exact: true }).selectOption('roman');
    await page.getByLabel('Gallery unit', { exact: true }).selectOption('line_infantry');
    await page.getByLabel('Unit animation', { exact: true }).selectOption('walk');
    await expect(status).toContainText('Ready · line_infantry');
    const idle = await renderedPixels(canvas);
    await page.getByRole('button', { name: 'Play motion', exact: true }).click();
    await expect.poll(() => renderedPixels(canvas)).not.toBe(idle);
    await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
    // Damping can settle after the UI action; require successive stable frames.
    let last = await renderedPixels(canvas), stable = 0;
    await expect.poll(async () => { const current = await renderedPixels(canvas); stable = current === last ? stable + 1 : 0; last = current; return stable; }).toBeGreaterThanOrEqual(2);
    await page.getByLabel('Model detail', { exact: true }).selectOption('far');
    await expect(status).toContainText('Ready · line_infantry', { timeout: 90000 });
    await expect(page.locator('.gallery-caption')).toContainText('Distance model');
    expect(await page.evaluate(() => localStorage.getItem('peris-solo-v6'))).toBe('gallery-preserves-campaign');
    expect(errors).toEqual([]);
});

test('switching to a withheld faction hides the previous model', async ({ page }) => {
    test.setTimeout(120000);
    await page.route('**/models/battle/faction-rosters.json', route => route.fulfill({ json: { factions: { roman: { near: {}, far: {} }, orc: { near: {}, far: {} } }, withheld: { orc: { reason: 'Awaiting visual review' } } } }));
    await page.goto('/?unit-gallery=1&faction=roman');
    await expect(page.getByTestId('gallery-status')).toContainText('Ready · line_infantry', { timeout: 90000 });
    await page.getByLabel('Gallery faction', { exact: true }).selectOption('orc');
    await expect(page.getByTestId('gallery-status')).toContainText('awaiting publication');
    await expect(page.locator('.gallery-canvas canvas')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Axe Warrior', exact: true })).toBeVisible();
});

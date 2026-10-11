import { test, expect, type Page, type TestInfo } from '@playwright/test';
import sharp from 'sharp';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
  });
});

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

async function dragMap(page: Page, testInfo: TestInfo, name: string) {
  const field = page.locator('canvas[aria-label^="Interactive 200 by 200"]');
  const box = (await field.boundingBox())!;
  const x = box.x + box.width * .45, y = box.y + box.height * .42;
  const before = await field.screenshot();
  const selections = await page.locator('.atlas-inspector').count();
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 100, y + 60, { steps: 12 }); await page.mouse.up();
  await expect.poll(async () => !(await field.screenshot()).equals(before)).toBe(true);
  await expect(page.locator('.atlas-inspector')).toHaveCount(selections);
  // Drag out and back while choosing a destination: release must never order a march.
  await page.getByRole('button', { name: 'March', exact: true }).click();
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 90, y + 40, { steps: 10 });
  await page.mouse.move(x, y, { steps: 10 }); await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await capture(page, testInfo, name);
}

async function beginCampaign(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Begin your campaign', exact: true }).click();
  await page.getByLabel('RULER NAME').fill('Graphics QA');
  await page.getByRole('button', { name: 'Found your realm' }).click();
  await page.getByRole('button', { name: 'Begin the restoration' }).click();
  await expect(page.locator('canvas[aria-label^="Interactive 200 by 200"]')).toBeVisible();
}

test('quick access opens campaign buildings and links to Frontier farm lists', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await beginCampaign(page);
  const quick = page.getByRole('button', { name: 'Quick access', exact: true });
  const shortcuts = page.getByRole('navigation', { name: 'Quick access shortcuts' });
  await quick.click();
  await expect(shortcuts.getByRole('link', { name: /^Frontier farm lists/ })).toHaveAttribute('href', '/?frontier=1#fw-farms-title');
  await capture(page, testInfo, 'campaign-quick-access');
  await page.keyboard.press('Escape');
  await expect(quick).toBeFocused();
  await quick.click();
  await shortcuts.getByRole('button', { name: /^Farm lists/ }).click();
  await expect(page.getByRole('dialog', { name: 'Farm lists', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  for (const building of ['Barracks', 'Stables', 'Warehouse', 'Granary']) {
    await quick.click();
    await shortcuts.getByRole('button', { name: new RegExp(`^${building}`) }).click();
    await expect(page.getByRole('dialog', { name: 'Selected building' })).toBeVisible();
    await expect(page.getByRole('radio', { name: new RegExp(`^${building}`) })).toBeChecked();
    await expect(page.getByRole('button', { name: `Build ${building}`, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await quick.click();
  await shortcuts.getByRole('button', { name: /^Main building/ }).click();
  await expect(page.getByRole('dialog', { name: 'Selected building' }).getByRole('heading', { name: 'Main building', exact: true })).toBeVisible();
  await capture(page, testInfo, 'campaign-building-shortcut');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('quick battle starts automatically and supports inspection, pause and concession', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');await page.getByRole('button', { name: /Quick battle/ }).click();
  await page.getByRole('button', { name: 'Watch the battle' }).click();
  await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-unit-models', 'published', {timeout:60000});
  await expect(page.locator('.unit-card')).toHaveCount(7);
  await expect(page.locator('.battle-time')).toContainText('AI VS AI');
  await expect(page.getByRole('button', { name: 'Begin battle', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Guard', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Ⅱ Pause/ }).click();
  await expect(page.locator('.pause-banner')).toBeVisible();
  await page.locator('.unit-card').last().click();
  await expect(page.locator('.unit-card.selected')).toHaveCount(1);
  await capture(page,testInfo,'automatic-battle-paused');
  await page.getByRole('button', { name: 'Concede battle', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Concede battle', exact: true }).click();
  await page.getByRole('dialog', { name: 'Battle result' }).getByRole('button', { name: 'Return to main menu', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PERIS', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('campaign map renders in WebGL and its camera controls work', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await beginCampaign(page);
  await expect(page.locator('.scene-compatibility')).toHaveCount(0);
  await expect(page.getByLabel('Rotate camera left')).toBeVisible();
  const field = page.locator('canvas[aria-label^="Interactive 200 by 200"]');
  await expect.poll(() => field.evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(0);
  await expect.poll(() => field.evaluate((canvas: HTMLCanvasElement) => !!canvas.getContext('webgl2'))).toBe(true);
  // A context can exist without drawing. Inspect the actual composited canvas:
  // reduced-motion maps retain their image without continuously redrawing the
  // discarded GL back buffer merely to keep this pixel probe populated.
  await expect.poll(async () => {
    const image = sharp(await field.screenshot()), { width = 0, height = 0 } = await image.metadata();
    if (width < 4 || height < 4) return false;
    const pixels = await image.extract({ left: Math.floor((width - 4) / 2), top: Math.floor((height - 4) / 2), width: 4, height: 4 }).removeAlpha().raw().toBuffer();
    return pixels.some(value => value > 0);
  }).toBe(true);
  await page.getByLabel('Rotate camera left').click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Focus your settlement', exact: true }).click();
  await dragMap(page, testInfo, 'world-map-drag');
  await capture(page, testInfo, 'world-map');
  await page.getByRole('button', { name: 'City', exact: true }).click();
  await expect(page.locator('.scene-canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(field).toBeVisible();
  expect(errors).toEqual([]);
});

test('map remains usable when WebGL is unavailable', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await beginCampaign(page);
  await expect(page.locator('.scene-compatibility')).toContainText('Compatibility map');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Focus your settlement', exact: true }).click();
  await dragMap(page, testInfo, 'world-map-compatibility-drag');
  await capture(page, testInfo, 'world-map-compatibility');
});

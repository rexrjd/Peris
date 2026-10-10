import { test, expect, type Page, type TestInfo } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
  });
});

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

async function beginCampaign(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Begin your campaign', exact: true }).click();
  await page.getByLabel('RULER NAME').fill('Graphics QA');
  await page.getByRole('button', { name: 'Found your realm' }).click();
  await page.getByRole('button', { name: 'Begin the restoration' }).click();
  await expect(page.locator('canvas[aria-label^="Interactive 200 by 200"]')).toBeVisible();
}

test('quick battle supports deployment, commands, pause and withdrawal', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'PERIS', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Quick battle/ }).click();
  await page.getByRole('button', { name: 'Deploy your army' }).click();
  const field = page.locator('.battle-3d-canvas canvas');
  await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-unit-models', 'published', {timeout:60000});
  await expect(page.locator('.unit-card')).toHaveCount(7);
  await expect(field).toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin battle', exact: true })).toBeEnabled();
  await capture(page, testInfo, 'battle-deployment');
  await page.getByRole('button', { name: /^Select all/ }).click();
  await expect(page.locator('.command-selection')).not.toHaveText('0 selected');
  await page.getByRole('button', { name: 'Guard', exact: true }).click();
  await expect(page.locator('.stance-tabs button.selected')).toHaveText('Guard');
  await page.getByRole('button', { name: 'Begin battle', exact: true }).click();
  await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible();
  await page.getByRole('button', { name: /Pause/, exact: false }).click();
  await expect(page.locator('.pause-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  const bounds = await field.boundingBox();
  if (!bounds) throw new Error('Battlefield has no screen bounds.');
  await field.click({ position: { x: bounds.width * .55, y: bounds.height * .65 } });
  await expect(page.locator('.field-order-hint')).toHaveCount(0);
  await page.getByRole('button', { name: /^Halt/ }).click();
  await capture(page, testInfo, 'battle-paused');
  await page.getByRole('button', { name: 'Withdraw from battle', exact: true }).click();
  await page.getByRole('button', { name: 'Withdraw the host', exact: true }).click();
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
  // A context can exist without drawing. Check that WebGL actually produced colored pixels.
  await expect.poll(() => field.evaluate((canvas: HTMLCanvasElement) => new Promise<boolean>(resolve => requestAnimationFrame(() => {
    const gl = canvas.getContext('webgl2');
    if (!gl) { resolve(false); return; }
    const pixels = new Uint8Array(4 * 4 * 4);
    gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    resolve(pixels.some((value, index) => index % 4 !== 3 && value > 0));
  })))).toBe(true);
  await page.getByLabel('Rotate camera left').click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Focus your settlement', exact: true }).click();
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
  await capture(page, testInfo, 'world-map-compatibility');
});

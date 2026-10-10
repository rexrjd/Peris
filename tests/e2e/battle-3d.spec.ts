import { test, expect } from '@playwright/test';

for (const terrain of ['Open country', 'Woodland', 'High country', 'River crossing']) {
  test(`3D ${terrain} preserves automatic combat, inspection and pause through view changes and context loss`, async ({ page }, testInfo) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
    });
    await page.goto('/');
    await page.getByRole('button', { name: /Quick battle/ }).click();
    await page.getByRole('button', { name: terrain, exact: true }).click();
    await page.getByRole('button', { name: 'Watch the battle' }).click();
    const graphics = page.getByRole('group', { name: 'Battle graphics' });
    await expect(graphics.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-unit-models', 'published', {timeout:60000});
    await page.getByRole('button', { name: /Ⅱ Pause/ }).click();
    await page.locator('.unit-card').first().click();
    const selection = await page.locator('.command-selection').innerText();
    await expect(page.getByRole('button', { name: 'Guard', exact: true })).toHaveCount(0);
    const field = page.locator('.battle-3d-canvas canvas');
    const label = page.locator('.battle-3d-label.friendly.selected').first();
    await expect(field).toBeVisible();
    await expect(label).toBeVisible();
    await expect(page.locator('.command-selection')).toHaveText(selection);

    const beforeRotation = await label.getAttribute('style');
    await page.getByRole('button', { name: 'Rotate camera left', exact: true }).click();
    await expect(label).not.toHaveAttribute('style', beforeRotation!);
    await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
    const bounds = await field.boundingBox();
    if (!bounds) throw new Error('3D battlefield has no bounds.');
    const beforePan=await label.getAttribute('style');
    await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.6);
    await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.5+60,bounds.y+bounds.height*.6+30,{steps:8});await page.mouse.up();
    await expect(label).not.toHaveAttribute('style',beforePan!);
    await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
    const hostile=page.locator('.battle-3d-label.hostile').first(),enemyBox=await hostile.boundingBox();
    if(!enemyBox)throw new Error('Missing enemy formation label');
    await page.mouse.click(enemyBox.x+enemyBox.width/2,enemyBox.y+enemyBox.height+8);
    await expect(page.locator('.battle-3d-label.hostile.selected')).toHaveCount(1);
    await page.locator('.unit-card').first().click();
    await expect(page.locator('.field-order-hint')).toHaveCount(0);
    await expect(page.locator('.command-selection')).toHaveText(selection);
    const screenshot = testInfo.outputPath(`3d-${terrain}.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach(`3d-${terrain}`, { path: screenshot, contentType: 'image/png' });

    await expect(page.getByRole('button', { name: 'Begin battle', exact: true })).toHaveCount(0);
    await expect(page.locator('.deployment-banner')).toHaveCount(0);
    await expect(page.locator('.pause-banner')).toBeVisible();
    await graphics.getByRole('button', { name: '2D', exact: true }).click();
    await expect(page.locator('canvas[aria-label^="Tactical battlefield"]')).toBeVisible();
    await graphics.getByRole('button', { name: '3D units' }).click();
    await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-unit-models', 'published', {timeout:60000});
    await expect(label).toBeVisible();
    await expect(page.locator('.pause-banner')).toBeVisible();
    const contextLost = await field.evaluate((canvas: HTMLCanvasElement) => {
      const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
      if (!extension) return false;
      extension.loseContext();
      return true;
    });
    expect(contextLost).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: '3D graphics unavailable' })).toBeVisible();
    await expect(page.locator('canvas[aria-label^="Tactical battlefield"]')).toBeVisible();
    await expect(graphics.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.pause-banner')).toBeVisible();
    await expect(page.locator('.command-selection')).toHaveText(selection);
    expect(errors).toEqual([]);
  });
}

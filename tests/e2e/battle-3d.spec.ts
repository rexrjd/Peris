import { test, expect } from '@playwright/test';

for (const terrain of ['Open country', 'Woodland', 'High country', 'River crossing']) {
  test(`3D ${terrain} preserves orders, selection and pause through view changes and context loss`, async ({ page }, testInfo) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
    });
    await page.goto('/');
    await page.getByRole('button', { name: /Quick battle/ }).click();
    await page.getByRole('button', { name: terrain, exact: true }).click();
    await page.getByRole('button', { name: 'Deploy your army' }).click();
    const graphics = page.getByRole('group', { name: 'Battle graphics' });
    await expect(graphics.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.battle-3d-canvas')).toHaveAttribute('data-unit-models', 'published', {timeout:60000});
    await page.getByRole('button', { name: /^Select all/ }).click();
    const selection = await page.locator('.command-selection').innerText();
    await page.getByRole('button', { name: 'Guard', exact: true }).click();
    await expect(page.locator('.stance-tabs button.selected')).toHaveText('Guard');
    await graphics.getByRole('button', { name: '3D units' }).click();
    const field = page.locator('.battle-3d-canvas canvas');
    const label = page.locator('.battle-3d-label.friendly.selected').first();
    await expect(field).toBeVisible();
    await expect(label).toBeVisible();
    await expect(page.locator('.command-selection')).toHaveText(selection);

    const beforeRotation = await label.getAttribute('style');
    await page.getByRole('button', { name: 'Rotate camera left', exact: true }).click();
    await expect(label).not.toHaveAttribute('style', beforeRotation!);
    await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    const bounds = await field.boundingBox();
    if (!bounds) throw new Error('3D battlefield has no bounds.');
    await field.click({ position: { x: bounds.width * .25, y: bounds.height * .65 } });
    await expect(page.locator('.field-order-hint')).toHaveCount(0);
    await expect(page.locator('.command-selection')).toHaveText(selection);
    const screenshot = testInfo.outputPath(`3d-${terrain}.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach(`3d-${terrain}`, { path: screenshot, contentType: 'image/png' });

    await page.getByRole('button', { name: 'Begin battle', exact: true }).click();
    await expect(page.locator('.deployment-banner')).toHaveCount(0);
    await page.getByRole('button', { name: /Pause/ }).click();
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

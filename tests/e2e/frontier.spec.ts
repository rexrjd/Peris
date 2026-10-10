import { expect, test } from '@playwright/test';

// The ordinary rendering suite does not start the persistent authority server.
// Run this slice with the dedicated Frontier configuration and an isolated database.
test('frontier village recruits, raids, returns, saves farm presets, and survives reload', async ({ page, request }, testInfo) => {
    test.skip(process.env.FRONTIER_E2E !== '1', 'Requires the isolated Frontier server configuration.');
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const health = await request.get('/api/frontier/health');
    expect(health.ok()).toBeTruthy();

    await page.goto('/?frontier=1');
    await page.getByLabel('Village name').fill(`Frontier ${testInfo.project.name.slice(0, 8)}`);
    await page.getByRole('combobox', { name: 'Faction', exact: true }).selectOption('persian');
    await page.getByRole('button', { name: 'Raise your standard' }).click();
    await expect(page.getByRole('heading', { name: /^Frontier /, level: 1 })).toBeVisible();

    const infantry = page.locator('.fw-unit').filter({ has: page.getByRole('heading', { name: 'Infantry', exact: true }) });
    await infantry.getByLabel('Number to recruit').fill('2');
    await infantry.getByRole('button', { name: /^Recruit/ }).click();
    await expect(infantry.locator('.fw-unit-heading strong')).toHaveText('2ready', { timeout: 20_000 });

    await page.getByRole('button', { name: /^low$/i }).click();
    await page.locator('.fw-camp-row').first().click();
    const party = page.getByRole('group', { name: 'Choose your raiding party' });
    await party.getByRole('spinbutton').nth(0).fill('2');
    await page.getByRole('button', { name: 'Send raid', exact: true }).click();
    await expect(infantry.locator('.fw-unit-heading strong')).toHaveText('0ready');
    await expect(page.locator('.fw-march')).toHaveCount(1);

    await page.locator('.fw-save-preset summary').click();
    await page.getByLabel('Repeat interval (minutes)').fill('3');
    await page.getByRole('button', { name: 'Save target & preset' }).click();
    const farm = page.locator('.fw-farm');
    await expect(farm).toHaveCount(1);
    await expect(farm).toContainText('Paused');
    await farm.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(farm.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await farm.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(farm).toContainText('Paused');

    await expect(page.locator('.fw-report-group')).toHaveCount(1, { timeout: 130_000 });
    await page.locator('.fw-report-group>summary').click();
    await expect(page.getByText('Estimated profit', { exact: true })).toBeVisible();
    await expect(page.getByText('Replacement cost', { exact: true })).toBeVisible();
    await expect(page.getByText('Delivered home', { exact: true })).toBeVisible();
    await expect(page.locator('.fw-march')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: /^Frontier /, level: 1 })).toBeVisible();
    await expect(page.locator('.fw-report-group')).toHaveCount(1);
    await expect(page.locator('.fw-farm')).toHaveCount(1);
    await expect(page.getByLabel('Village name')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await testInfo.attach('frontier-playable-loop', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await page.locator('.fw-farm').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('.fw-farm')).toHaveCount(0);
    expect(errors).toEqual([]);
});

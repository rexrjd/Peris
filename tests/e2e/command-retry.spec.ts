import { test, expect } from '@playwright/test';
// @ts-expect-error Plain Node helper runs only against an isolated database.
import { accountServer } from '../helpers/account-server.mjs';

test('accepted order with a lost response survives reload and retries the original request once', async ({ page, context }, info) => {
    test.setTimeout(120000);
    const server = await accountServer(), ids: string[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await context.addInitScript(() => {
            localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
                if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null;
                return Reflect.apply(original, this, [type, ...args]);
            } as typeof original;
        });
        await context.route('**/*.supabase.co/**', async route => {
            const request = route.request(), body = request.postDataJSON() ?? {};
            const response = await server.request(request.url(), request.method(), request.headers(), body);
            if (request.url().includes('/rpc/peris_submit_command')) {
                ids.push(body.p_request_id);
                // The real SQL committed successfully; only the response is lost.
                if (ids.length === 1 && response.status === 200) { await route.abort('failed'); return; }
            }
            await route.fulfill({ status: response.status, headers: response.headers, body: response.data == null ? '' : JSON.stringify(response.data) });
        });
        await page.goto('/'); await page.getByRole('button', { name: 'Shared world', exact: true }).click();
        await page.getByRole('button', { name: 'Create account', exact: true }).click(); await page.getByLabel('Name your ruler').fill('Retry browser ruler');
        await page.locator('.account-create .account-primary').click(); await expect(page.getByLabel('Game menu')).toBeVisible();
        await page.getByRole('navigation', { name: 'Game navigation' }).getByRole('button', { name: 'Rally Point', exact: true }).click();
        await page.getByRole('tab', { name: /^Farm lists/ }).click();
        await page.getByLabel('New farm list name').fill('Lost response farms'); await page.getByRole('button', { name: 'Create list', exact: true }).click();
        await expect(page.locator('.pending-order-warning')).toContainText('Order status unconfirmed');
        await expect(page.getByRole('button', { name: 'Create list', exact: true })).toBeDisabled();
        await page.reload(); await expect(page.locator('.pending-order-warning')).toContainText('Order status unconfirmed');
        await page.getByRole('button', { name: 'Retry same order', exact: true }).click(); await expect(page.locator('.pending-order-warning')).toHaveCount(0);
        expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
        await page.getByRole('navigation', { name: 'Game navigation' }).getByRole('button', { name: 'Rally Point', exact: true }).click();
        await page.getByRole('tab', { name: /^Farm lists/ }).click();
        await expect(page.locator('.campaign-farm-list summary strong').filter({ hasText: 'Lost response farms' })).toHaveCount(1);
        expect(errors).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const path = info.outputPath('safe-command-retry.png'); await page.screenshot({ path, fullPage: true }); await info.attach('safe-command-retry', { path, contentType: 'image/png' });
    } finally { await server.close(); }
});

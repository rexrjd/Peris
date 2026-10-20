import { test, expect } from '@playwright/test';
// @ts-expect-error The isolated SQL HTTP adapter is plain Node JS.
import { accountServer } from '../helpers/account-server.mjs';

// Inputs are ephemeral test credentials; do not retain network trace payloads.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('masked optional password entry routes credentials without persisting or echoing them', async ({ page, context }, testInfo) => {
    test.setTimeout(120000);
    const server = await accountServer(), secret = crypto.randomUUID(), incorrect = crypto.randomUUID();
    const calls: { functionName: string; passwordMatches: boolean; mode: string }[] = [];
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(() => {
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
            if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null;
            return Reflect.apply(original, this, [type, ...args]);
        } as typeof original;
    });
    await context.route('**/*.supabase.co/**', async route => {
        const request = route.request(), payload = request.postDataJSON() ?? {};
        let url = request.url();
        // This test verifies UI transport. Database password enforcement has its own isolated suite.
        if (new URL(url).pathname.endsWith('/peris_enter_password_account')) {
            calls.push({ functionName: 'peris_enter_password_account', passwordMatches: payload.p_password === secret, mode: payload.p_mode });
            if (payload.p_password !== secret) {
                await route.fulfill({ status: 400, json: { code: 'PT401', message: `Rejected ${payload.p_password}` } }); return;
            }
            url = url.replace('/peris_enter_password_account', '/peris_enter_account'); delete payload.p_password;
        }
        const response = await server.request(url, request.method(), request.headers(), payload);
        await route.fulfill({ status: response.status, headers: response.headers, body: response.data == null ? '' : JSON.stringify(response.data) });
    });
    try {
        await page.goto('/'); await expect(page).toHaveTitle(/Peris/i);
        await page.getByRole('button', { name: 'Shared world', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Choose your ruler.' })).toBeVisible();
        await expect(page.locator('#account-login-password')).toHaveAttribute('type', 'password');
        await expect(page.locator('#account-login-password')).toHaveAttribute('autocomplete', 'current-password');
        await page.getByRole('button', { name: 'Create account', exact: true }).click();
        await page.getByLabel('Name your ruler').fill('Guarded Crown');
        await expect(page.locator('#new-account-password')).toHaveAttribute('type', 'password');
        await expect(page.locator('#new-account-password')).toHaveAttribute('autocomplete', 'new-password');
        await page.locator('#new-account-password').fill(secret);
        await page.screenshot({ path: testInfo.outputPath('masked-password-creation.png'), fullPage: true });
        await page.locator('.account-create .account-primary').click();
        await expect(page.getByLabel('Game menu')).toBeVisible();
        expect(calls).toEqual([{ functionName: 'peris_enter_password_account', passwordMatches: true, mode: 'create' }]);
        expect(JSON.stringify(await context.storageState()).includes(secret)).toBe(false);
        expect(await page.evaluate(value => JSON.stringify(sessionStorage).includes(value), secret)).toBe(false);
        await page.getByLabel('Game menu').click(); await page.getByRole('button', { name: 'Switch ruler', exact: true }).click();
        await expect(page.locator('#account-login-password')).toHaveValue('');
        await page.getByRole('button', { name: 'Select Guarded Crown', exact: true }).click();
        await page.locator('#account-login-password').fill(incorrect);
        const enter = () => page.getByRole('button', { name: testInfo.project.name.includes('mobile') ? "Enter Guarded Crown's realm" : 'Log in as Guarded Crown', exact: true });
        await enter().click(); await expect(page.getByRole('alert')).toContainText('password');
        expect((await page.getByRole('alert').textContent())?.includes(incorrect)).toBe(false);
        await page.locator('#account-login-password').fill(secret); await enter().click();
        await expect(page.getByLabel('Game menu')).toBeVisible();
        await page.reload(); await expect(page.getByLabel('Game menu')).toBeVisible();
        expect(calls).toHaveLength(3); expect(errors).toEqual([]);
        await page.getByLabel('Game menu').click(); await page.getByRole('button', { name: 'Switch ruler', exact: true }).click();
        await page.getByRole('button', { name: 'Create account', exact: true }).click();
        await expect(page.locator('#new-account-password')).toHaveValue('');
    } finally { await server.close(); }
});

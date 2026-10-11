import { test, expect, type BrowserContext, type Page } from '@playwright/test';
// @ts-expect-error The isolated database helper is intentionally plain Node JS.
import { accountServer } from '../helpers/account-server.mjs';
let server: Awaited<ReturnType<typeof accountServer>>;
test.beforeAll(async () => { server = await accountServer(); });
test.afterAll(async () => { await server.close(); });
async function connect(context: BrowserContext) {
    await context.addInitScript(() => {
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
            if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null;
            return Reflect.apply(original, this, [type, ...args]);
        } as typeof original;
    });
    await context.route('**/*.supabase.co/**', async route => {
        const request = route.request();
        const response = await server.request(request.url(), request.method(), request.headers(), request.postDataJSON() ?? {});
        await route.fulfill({ status: response.status, headers: response.headers, body: response.data == null ? '' : JSON.stringify(response.data) });
    });
}
async function login(page: Page, name: string) {
    await page.bringToFront();
    await page.goto('/');
    await page.getByRole('button', { name: 'Shared world', exact: true }).click();
    await page.getByLabel('YOUR RULER NAME').fill(name);
    await page.getByRole('button', { name: 'Enter the shared world', exact: true }).click();
    await expect(page.getByLabel('Game menu')).toBeVisible();
}
async function ruler(page: Page, name: string) {
    await page.bringToFront();
    await page.getByLabel('Game menu').click();
    await expect(page.locator('.game-menu-player strong')).toHaveText(name);
}
test('name login, refresh, fresh device, switch and expired session keep the correct account', async ({ page, context, browser }, testInfo) => {
    test.setTimeout(120000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await connect(context); await login(page, 'Account Alpha'); await ruler(page, 'Account Alpha');
    const alpha = server.logins.at(-1); expect(alpha.created).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('name-login.png') });
    await page.reload(); await expect(page.getByLabel('Game menu')).toBeVisible(); await ruler(page, 'Account Alpha');
    expect(server.logins.at(-1).player_id).toBe(alpha.player_id);expect(server.logins.at(-1).auth_id).toBe(alpha.auth_id);
    const other = await browser.newContext({ viewport: { width: 1024, height: 768 } });await connect(other);const second = await other.newPage();
    await login(second, '  account alpha  ');await ruler(second, 'Account Alpha');expect(server.logins.at(-1).player_id).toBe(alpha.player_id);expect(server.logins.at(-1).created).toBe(false);
    await second.getByRole('button', { name: 'Switch ruler', exact: true }).click();
    await second.getByLabel('YOUR RULER NAME').fill('Account Beta');await second.getByRole('button', { name: 'Enter the shared world', exact: true }).click();await ruler(second, 'Account Beta');
    const beta = server.logins.at(-1);expect(beta.player_id).not.toBe(alpha.player_id);
    await page.getByLabel('Game menu').click();await ruler(page, 'Account Alpha');
    server.expire(alpha.auth_id);await expect.poll(() => server.logins.filter((login: {player_id: string}) => login.player_id === alpha.player_id).length, { timeout: 15000 }).toBeGreaterThan(3);
    await expect(page.locator('.connection-warning')).toHaveCount(0);await expect(page.locator('.game-menu-player strong')).toHaveText('Account Alpha');
    const recovered = server.logins.at(-1);expect(recovered.player_id).toBe(alpha.player_id);expect(recovered.auth_id).not.toBe(alpha.auth_id);
    await page.evaluate(() => { for (let i = sessionStorage.length - 1; i >= 0; i--) { const key = sessionStorage.key(i)!; if (key.startsWith('peris-session:')) sessionStorage.removeItem(key); } });
    await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();await ruler(page, 'Account Alpha');expect(server.logins.at(-1).player_id).toBe(alpha.player_id);
    await page.getByRole('button', { name: 'Switch ruler', exact: true }).click();await expect(page.getByLabel('YOUR RULER NAME')).toHaveValue('Account Alpha');
    await page.reload();await expect(page.getByLabel('YOUR RULER NAME')).toBeVisible();await expect(page.getByLabel('Game menu')).toHaveCount(0);
    expect(await server.counts()).toEqual({ players: 2, cities: 2, armies: 2 });expect(errors).toEqual([]);await other.close();
});
test('two tabs can control different names without changing each other', async ({ context }, testInfo) => {
    await connect(context); const first = await context.newPage(), second = await context.newPage();
    await login(first, 'Tab Alpha');await ruler(first, 'Tab Alpha');
    await login(second, 'Tab Beta');await ruler(second, 'Tab Beta');
    await first.bringToFront();
    await first.reload();await expect(first.getByLabel('Game menu')).toBeVisible();await ruler(first, 'Tab Alpha');
    await second.bringToFront();
    await second.getByRole('button', { name: 'Switch ruler', exact: true }).click();await second.getByLabel('YOUR RULER NAME').fill('tab alpha');await second.getByRole('button', { name: 'Enter the shared world', exact: true }).click();await ruler(second, 'Tab Alpha');
    await first.bringToFront();
    await first.getByLabel('Game menu').click();await ruler(first, 'Tab Alpha');
    await first.screenshot({ path: testInfo.outputPath('independent-tabs.png') });
});

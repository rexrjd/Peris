import {test, expect} from '@playwright/test';
// @ts-expect-error Isolated PostgreSQL-backed HTTP harness is plain Node JS.
import {accountServer} from '../helpers/account-server.mjs';

test('shared-world report reads persist in PostgreSQL after browser receipts are cleared', async ({page, context}, info) => {
    test.setTimeout(120000);
    const server = await accountServer(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.stack ?? error.message));
    try {
        await context.addInitScript(() => {
            localStorage.setItem('peris-settings', JSON.stringify({sound:false,music:false,reducedMotion:true}));
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
                if (['webgl','webgl2','experimental-webgl'].includes(type)) return null;
                return Reflect.apply(original, this, [type, ...args]);
            } as typeof original;
        });
        await context.route('**/*.supabase.co/**', async route => {
            const request = route.request();
            const response = await server.request(request.url(), request.method(), request.headers(), request.postDataJSON() ?? {});
            await route.fulfill({status:response.status, headers:response.headers, body:response.data == null ? '' : JSON.stringify(response.data)});
        });
        await page.goto('/'); await page.getByRole('button', {name:'Shared world',exact:true}).click();
        await page.getByRole('button', {name:'Create account',exact:true}).click();
        await page.getByLabel('Name your ruler').fill('Online Reader');
        await page.locator('.account-create .account-primary').click();
        await expect(page.getByLabel('Game menu')).toBeVisible();
        const owner = server.logins.at(-1).player_id;
        await server.seedReports(owner); await page.reload();
        const nav = page.getByRole('navigation', {name:'Game navigation'});
        await nav.getByRole('button', {name:'Reports, 2 unread',exact:true}).click();
        await expect(page.locator('.report-ledger-group>article.is-unread .report-ledger-open')).toHaveCount(2);
        await page.locator('.report-ledger-open').first().click();
        await expect(page.getByRole('dialog', {name:'Battle result'})).toBeVisible();
        await expect.poll(async () => (await server.reports(owner)).filter((r: {read_at:string|null}) => r.read_at).length).toBe(1);
        await expect(nav.getByRole('button', {name:'Reports, 1 unread',exact:true})).toBeVisible();
        await page.getByRole('button', {name:'Back to reports',exact:true}).click();
        await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('peris-read-reports:')) localStorage.removeItem(key); });
        await page.reload(); await nav.getByRole('button', {name:'Reports, 1 unread',exact:true}).click();
        await expect(page.locator('.report-ledger-group>article.is-unread .report-ledger-open')).toHaveCount(1);
        await page.locator('.report-ledger-group>article.is-unread .report-ledger-open').click();
        await expect.poll(async () => (await server.reports(owner)).every((r: {read_at:string|null}) => r.read_at)).toBe(true);
        await expect(nav.locator('button.has-unread')).toHaveCount(0);
        await page.screenshot({path:info.outputPath('server-read-reports.png')});
        expect(errors).toEqual([]);
    } finally { await server.close(); }
});

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
// @ts-expect-error The isolated SQL HTTP adapter is plain Node JS.
import { accountServer } from '../helpers/account-server.mjs';
let server: Awaited<ReturnType<typeof accountServer>>;
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
        const request = route.request(); const response = await server.request(request.url(), request.method(), request.headers(), request.postDataJSON() ?? {});
        await route.fulfill({ status: response.status, headers: response.headers, body: response.data == null ? '' : JSON.stringify(response.data) });
    });
}
async function launcher(page: Page) { await page.goto('/'); await page.getByRole('button', { name: 'Shared world', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Choose your ruler.' })).toBeVisible(); }
async function manual(page: Page) { await page.locator('.account-manual summary').click(); }
test.beforeEach(async ({ context }) => { server = await accountServer(); await connect(context); });
test.afterEach(async () => { await server.close(); });
test('race creation, duplicate protection and existing-name login', async ({ page }, testInfo) => {
    test.setTimeout(120000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await launcher(page); await expect(page.getByRole('heading', { name: 'Be the first ruler' })).toBeVisible();
    await manual(page); await page.getByLabel('YOUR RULER NAME').fill('Unknown ruler'); await page.getByRole('button', { name: 'Enter the shared world', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('No account'); expect((await server.counts()).players).toBe(0);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('radio')).toHaveCount(11); await page.getByLabel('Name your ruler').fill('Copper Crown'); await page.getByRole('radio', { name: 'Human · Persian', exact: true }).check();
    await expect(page.getByLabel('Selected race')).toContainText('Turquoise domes'); await page.screenshot({ path: testInfo.outputPath('create-persian.png'), fullPage: true });
    await page.locator('.account-create .account-primary').click(); await expect(page.getByLabel('Game menu')).toBeVisible();
    const created = server.logins.at(-1); expect(created.created).toBe(true); expect(await server.faction(created.player_id)).toBe('persian');
    // Race selection must reach the new painted village introduced on main.
    await page.getByRole('button', { name: 'City', exact: true }).click();
    const village = page.locator('.painted-settlement-scene');
    await expect(village).toHaveAttribute('data-faction', 'persian');
    await expect(village.locator('[data-building^="slot:"]')).toHaveCount(6);
    await page.screenshot({ path: testInfo.outputPath('created-persian-village.png'), fullPage: true });
    await page.getByRole('button', { name: 'Quick access', exact: true }).click();
    await expect(page.getByRole('button', { name: /Farm lists/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByLabel('Game menu').click(); await page.getByRole('button', { name: 'Switch ruler', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Select Copper Crown' })).toBeVisible();
    await page.getByRole('button', { name: 'Create account', exact: true }).click(); await page.getByLabel('Name your ruler').fill(' copper crown '); await page.getByRole('radio', { name: 'Demons', exact: true }).check();
    await page.locator('.account-create .account-primary').click(); await expect(page.getByRole('alert')).toContainText('already belongs');
    expect((await server.counts()).players).toBe(1); expect(await server.faction(created.player_id)).toBe('persian');
    await page.getByRole('button', { name: 'Log in', exact: true }).click(); await page.getByRole('button', { name: 'Select Copper Crown' }).click();
    await expect(page.getByLabel('Selected ruler')).toContainText('Human · Persian'); await page.getByRole('button', { name: 'Log in as Copper Crown' }).click();
    await expect(page.getByLabel('Game menu')).toBeVisible(); expect(server.logins.at(-1).player_id).toBe(created.player_id); expect(errors).toEqual([]);
});
test('whole roster supports paging, race and activity filters, selected stats and keyboard access', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    for (let index = 0; index < 16; index++) await server.seed('Ruler ' + String(index).padStart(2, '0'), index % 2 ? 'orc' : 'elf');
    await launcher(page); await page.getByLabel('Sort rulers').selectOption('name');
    await expect(page.locator('.account-card')).toHaveCount(12); await expect(page.locator('.account-pagination')).toContainText('Showing 1–12 of 16');
    await page.getByRole('button', { name: 'Select Ruler 02' }).click();
    await expect(page.getByLabel('Selected ruler')).toContainText('Ruler 02'); await expect(page.getByLabel('Selected ruler')).toContainText('Level 1');
    await page.screenshot({ path: testInfo.outputPath('ruler-roster.png'), fullPage: true });
    if (testInfo.project.name.includes('mobile')) {
        await expect(page.getByRole('region', { name: 'Quick account entry' })).toContainText('Ruler 02');
        await page.screenshot({ path: testInfo.outputPath('mobile-entry-bar.png') });
        await page.getByRole('button', { name: 'View ruler details' }).click();
        await expect(page.getByLabel('Selected ruler').getByRole('heading', { name: 'Ruler 02' })).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Next rulers' }).click(); await expect(page.locator('.account-card')).toHaveCount(4); await expect(page.locator('.account-pagination')).toContainText('Showing 13–16 of 16');
    await page.getByLabel('Filter by race').selectOption('orc'); await expect(page.locator('.account-card')).toHaveCount(8);
    await page.getByRole('button', { name: 'Online', exact: true }).click(); await expect(page.locator('.account-card')).toHaveCount(8);
    await page.getByLabel('Search rulers').fill('Ruler 15'); await expect(page.locator('.account-card')).toHaveCount(1);
    await page.getByLabel('Search rulers').fill('Nobody matches'); await expect(page.getByRole('heading', { name: 'No matching rulers' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset filters' }).click(); await expect(page.locator('.account-card')).toHaveCount(12); await page.getByLabel('Sort rulers').selectOption('name'); await expect(page.getByRole('button', { name: 'Select Ruler 01' })).toBeEnabled();
    const card = page.getByRole('button', { name: 'Select Ruler 01' }); await card.focus(); await page.keyboard.press('Enter'); await expect(card).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: testInfo.project.name.includes('mobile') ? "Enter Ruler 01's realm" : 'Log in as Ruler 01' }).click(); await expect(page.getByLabel('Game menu')).toBeVisible();
    expect((await server.counts()).players).toBe(16);
});
test('directory failure keeps name entry usable and supports retry', async ({ page, context }) => {
    test.setTimeout(120000); await server.seed('Fallback ruler', 'dwarf');
    const failure = '**/rest/v1/rpc/peris_account_directory'; await context.route(failure, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"offline"}' }));
    await launcher(page); await expect(page.getByRole('heading', { name: 'World roster unavailable' })).toBeVisible();
    await context.unroute(failure); await page.getByRole('button', { name: 'Retry roster' }).click(); await expect(page.getByRole('button', { name: 'Select Fallback ruler' })).toBeVisible();
    await context.route(failure, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"offline"}' }));
    await page.getByRole('button', { name: 'Create account', exact: true }).click(); await page.getByRole('button', { name: 'Log in', exact: true }).click(); await expect(page.getByRole('heading', { name: 'World roster unavailable' })).toBeVisible();
    await manual(page); await page.getByLabel('YOUR RULER NAME').fill('fallback ruler'); await page.getByRole('button', { name: 'Enter the shared world', exact: true }).click(); await expect(page.getByLabel('Game menu')).toBeVisible();
    expect((await server.counts()).players).toBe(1);
});

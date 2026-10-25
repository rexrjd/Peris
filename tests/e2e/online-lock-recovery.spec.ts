import {test, expect, type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
// @ts-expect-error Existing isolated PostgreSQL HTTP fixture is plain JavaScript.
import {accountServer} from '../helpers/account-server.mjs';

let server: Awaited<ReturnType<typeof accountServer>>;
test.beforeAll(async () => { server = await accountServer(); });
test.afterAll(async () => { await server.close(); });

type Failure = {endpoint: string; remaining: number; code: string; message: string};
async function connect(page: Page, name: string) {
    const calls: string[] = [], failed: string[] = [];
    let pending = 0;
    const failure: Failure = {endpoint: '', remaining: 0, code: '55P03', message: 'lock_not_available'};
    await page.clock.install();
    await page.context().routeWebSocket('**', socket => socket.close());
    await page.addInitScript(() => {
        localStorage.setItem('peris-settings', JSON.stringify({sound: false, music: false, reducedMotion: true}));
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type: string, ...args: unknown[]) {
            return ['webgl', 'webgl2', 'experimental-webgl'].includes(type) ? null : Reflect.apply(original, this, [type, ...args]);
        } as typeof original;
    });
    await page.context().route('**/*.supabase.co/**', async route => {
        const request = route.request(), endpoint = new URL(request.url()).pathname.split('/').at(-1)!;
        calls.push(endpoint); pending++;
        try {
            if (failure.endpoint === endpoint && failure.remaining > 0) {
                failure.remaining--; failed.push(endpoint);
                await route.fulfill({status: 400, json: {code: failure.code, message: failure.message}}); return;
            }
            const response = await server.request(request.url(), request.method(), request.headers(), request.postDataJSON() ?? {});
            await route.fulfill({status: response.status, headers: response.headers, body: response.data == null ? '' : JSON.stringify(response.data)});
        } finally { pending--; }
    });
    await page.goto('/');
    await page.getByRole('button', {name: 'Shared world', exact: true}).click();
    await page.getByRole('button', {name: 'Create account', exact: true}).click();
    await page.getByLabel('Name your ruler').fill(name);
    await page.locator('.account-create .account-primary').click();
    await expect(page.getByLabel('Game menu')).toBeVisible();
    await page.getByRole('navigation', {name: 'Game navigation'}).getByRole('button', {name: 'Map', exact: true}).click();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await expect.poll(() => pending).toBe(0);
    // Poll recovery is independent of rendering; freeze further animation work
    // after the initial map is painted while exercising the real engine timers.
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    calls.length = 0;
    const advance = async (seconds: number) => {
        for (let i = 0; i < seconds; i++) {
            await page.clock.runFor(1000);
            await new Promise(resolve => setTimeout(resolve, 20));
            await expect.poll(() => pending).toBe(0);
        }
    };
    return {calls, failed, failure, advance};
}

for (const endpoint of ['sync_my_state', 'peris_snapshot', 'peris_map_snapshot']) {
    test(`${endpoint} recovers two transient lock conflicts without a raw warning or losing the map`, async ({page}, info) => {
        const probe = await connect(page, `Locks ${endpoint === 'sync_my_state' ? 'sync' : endpoint === 'peris_snapshot' ? 'core' : 'map'}`);
        const city = await page.locator('.city-selector-trigger').getAttribute('aria-label');
        Object.assign(probe.failure, {endpoint, remaining: 2});
        // The initial viewport debounce can fall after the first map timer;
        // allow the next 5s timer to reach its 15s background interval.
        await probe.advance(21);
        expect(probe.failed.length).toBeGreaterThan(0);
        await expect(page.locator('.connection-warning')).toHaveCount(0);
        await expect(page.getByLabel('Game menu')).toBeVisible();
        await expect(page.locator('.city-selector-trigger')).toHaveAttribute('aria-label', city!);
        await page.screenshot({path: info.outputPath('lock-grace.png')});
        await probe.advance(40);
        expect(probe.failed).toHaveLength(2);
        expect(probe.calls.filter(call => call === endpoint).length).toBeGreaterThan(2);
        await expect(page.locator('.connection-warning')).toHaveCount(0);
        await expect(page.getByLabel('Game menu')).toBeVisible();
        await expect(page.locator('.city-selector-trigger')).toHaveAttribute('aria-label', city!);
        await mkdir('artifacts/world-social-polish', {recursive: true});
        await page.screenshot({path: `artifacts/world-social-polish/lock-${endpoint}-${info.project.name}.png`});
    });
}

test('persistent lock contention shows a readable busy warning and recovers on a later poll', async ({page}, info) => {
    // This can advance 113 seconds of the interactive map's render loop. Allow
    // slower shared CI/desktop CPUs to finish the full bounded-backoff probe.
    test.setTimeout(120_000);
    const {failure, failed, calls, advance} = await connect(page, 'Persistent locks');
    Object.assign(failure, {endpoint: 'sync_my_state', remaining: Infinity});
    await advance(48);
    expect(failed.length).toBeGreaterThanOrEqual(3);
    expect(failed.length, 'backoff prevents a request on every 850ms engine tick').toBeLessThanOrEqual(4);
    await expect(page.locator('.connection-warning')).toContainText('The shared world is busy');
    await expect(page.locator('.connection-warning')).not.toContainText('lock_not_available');
    await page.screenshot({path: info.outputPath('lock-persistent-busy.png')});
    failure.remaining = 0; calls.length = 0;
    for (let seconds = 0; seconds < 65 && !calls.includes('peris_snapshot'); seconds++) await advance(1);
    expect(calls).toContain('peris_snapshot');
    await expect(page.locator('.connection-warning')).toHaveCount(0);
});

test('a genuine non-lock failure stays visible immediately and survives a following lock conflict', async ({page}) => {
    const {failure, advance} = await connect(page, 'Visible failure');
    Object.assign(failure, {endpoint: 'sync_my_state', remaining: 1, code: '42501', message: 'Controlled permission failure'});
    await advance(11);
    await expect(page.locator('.connection-warning')).toHaveText('Controlled permission failure');
    Object.assign(failure, {remaining: Infinity, code: '55P03', message: 'lock_not_available'});
    await advance(46);
    await expect(page.locator('.connection-warning')).toHaveText('Controlled permission failure');
});

test('lock recovery preserves private and public snapshots and never resends a pending mutation', async ({page}) => {
    const world = createSolo('Retained world'), calls: string[] = [];
    world.camps = [];
    world.map = {version: 4, cols: 200, rows: 200, cell_size: 128, seed: 1346720329, total_players: 2, total_settlements: 2};
    const rival = {...world.settlements[0], id: 999, owner_id: '22222222-2222-4222-8222-222222222222', name: 'Visible rival'};
    const publicMap = {server_now: world.server_now, players: [{id: rival.owner_id, display_name: 'Rival'}], settlements: [rival], armies: [], map_plots: [], total_players: 2, total_settlements: 2};
    const intent = {requestId: '11111111-1111-4111-8111-111111111111', fn: 'peris_queue_recruit', args: {p_type: 'infantry', p_quantity: 2}};
    let locked = false, pending = 0;
    await page.clock.install();
    await page.context().routeWebSocket('**', socket => socket.close());
    await page.context().route('**/*.supabase.co/**', async route => {
        const endpoint = new URL(route.request().url()).pathname.split('/').at(-1)!;
        calls.push(endpoint); pending++;
        try {
            if (locked && ['sync_my_state', 'peris_snapshot', 'peris_map_snapshot'].includes(endpoint)) {
                await route.fulfill({status: 400, json: {code: '55P03', message: 'lock_not_available'}}); return;
            }
            await route.fulfill({json: endpoint === 'peris_snapshot' ? world : endpoint === 'peris_map_snapshot' ? publicMap : endpoint === 'settlements' || endpoint === 'armies' ? [] : {ok: true}});
        } finally { pending--; }
    });
    await page.goto('/');
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.evaluate(async ({world, intent}) => {
        // @ts-expect-error Browser imports the actual engine through the Vite server.
        const {OnlineEngine} = await import('/src/engine/online/OnlineEngine.ts');
        sessionStorage.setItem(`peris-pending-command:${world.players[0].id}`, JSON.stringify(intent));
        (window as any).lockController = new OnlineEngine(world.players[0].id, world);
    }, {world, intent});
    try {
        await expect.poll(() => page.evaluate(() => (window as any).lockController.snapshot.settlements.some((city: any) => city.id === 999))).toBe(true);
        await expect.poll(() => pending).toBe(0);
        const before = await page.evaluate(() => (window as any).lockController.snapshot);
        locked = true;
        await page.evaluate(async () => { await (window as any).lockController.refresh(false); await (window as any).lockController.refreshMap(); });
        expect(await page.evaluate(() => (window as any).lockController.snapshot)).toEqual(before);
        for (let i = 0; i < 40; i++) {
            await page.clock.runFor(1000); await new Promise(resolve => setTimeout(resolve, 5));
            await expect.poll(() => pending).toBe(0);
        }
        expect(await page.evaluate(() => (window as any).lockController.snapshot)).toEqual(before);
        expect(await page.evaluate(() => (window as any).lockController.pendingCommand)).toEqual(intent);
        expect(calls.filter(call => call === 'peris_submit_command')).toHaveLength(0);
        locked = false;
        await page.evaluate(async () => { await (window as any).lockController.refresh(); });
        expect(await page.evaluate(() => (window as any).lockController.pendingCommand)).toEqual(intent);
        expect(calls.filter(call => call === 'peris_submit_command')).toHaveLength(0);
    } finally { await page.evaluate(() => (window as any).lockController.destroy()); }
});

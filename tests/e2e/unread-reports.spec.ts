import { test, expect } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { beginRaid } from '../../src/features/campaign/domain/raids';
import { finishBattle } from '../../src/features/battle/domain/resolution';
import { settleBattle } from '../../src/features/campaign/domain/battleSettlement';

test('legacy read receipts migrate beyond one RPC batch without reading fresh reports', async ({ page }) => {
    const world = createSolo('Legacy report QA'), owner = world.players[0].id; let id = 90000;
    beginRaid(world, owner, world.camps.find(camp => camp.bandit)!.id, () => ++id);
    const battle = world.battles.at(-1)!, formations = world.formations.filter(row => row.battle_id === battle.id);
    formations.filter(row => row.side === 'defender').forEach(row => { row.soldiers = 0; row.status = 'routed'; });
    finishBattle(battle, formations, 'attacker', 'Army routed'); settleBattle(world, battle.id, owner, () => ++id);
    const source = world.reports[0];
    world.reports = Array.from({ length: 56 }, (_, index) => ({ ...source, id: ++id, battle_id: ++id, title: `Saved report ${index + 1}` }));
    world.battles = []; world.formations = [];
    await page.addInitScript(w => {
        if (!localStorage.getItem('peris-campaign-v6')) {
            localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
            localStorage.setItem(`peris-read-reports:solo:${w.players[0].id}:${w.players[0].created_at}`, JSON.stringify(w.reports.slice(0, 55).map(report => report.battle_id)));
        }
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/'); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Game navigation' });
    await expect(nav.getByRole('button', { name: 'Reports, 1 unread', exact: true })).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!));
    expect(saved.reports.filter((report: { read_at?: string }) => report.read_at)).toHaveLength(55);
    expect(saved.reports[55].read_at).toBeFalsy();
});

test('pruned receipts opened through Reports and Rally clear the same private persisted badge', async ({ page }) => {
    const world = createSolo('Pruned report QA'), owner = world.players[0].id; let id = 70000;
    for (const camp of world.camps.filter(c => c.bandit).slice(0, 2)) {
        beginRaid(world, owner, camp.id, () => ++id);
        const battle = world.battles.at(-1)!, formations = world.formations.filter(f => f.battle_id === battle.id);
        formations.filter(f => f.side === 'defender').forEach(f => { f.soldiers = 0; f.status = 'routed'; });
        finishBattle(battle, formations, 'attacker', 'Army routed'); settleBattle(world, battle.id, owner, () => ++id);
    }
    world.reports[0].title = 'Pruned Chronicle receipt'; world.reports[1].title = 'Pruned Rally receipt';
    world.battles = []; world.formations = [];
    const source = world.reports[0];
    world.campaign_farm_lists = [{ id: 1, owner_id: owner, name: 'Losses only', troops: { infantry: 1, archers: 0, cavalry: 0 }, casualties_only: true }];
    world.reports.push(
        { ...source, id: ++id, battle_id: ++id, title: 'Quiet farm receipt', farm_list_id: 1,
            result: { ...source.result, attacker_losses: 0, attacker_survivors: source.result.attacker_initial, attacker_survivor_roster: source.result.attacker_roster } },
        { ...source, id: ++id, battle_id: ++id, owner_id: 'rival-ruler', title: 'Private rival receipt' },
    );
    await page.addInitScript(w => {
        if (!localStorage.getItem('peris-campaign-v6')) localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({ sound: false, music: false, reducedMotion: true }));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/'); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Game navigation' });
    await nav.getByRole('button', { name: 'Reports, 2 unread', exact: true }).click();
    await expect(page.getByRole('button', { name: /Quiet farm receipt|Private rival receipt/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Pruned Chronicle receipt/ }).click();
    let dialog = page.getByRole('region', { name: 'Report details', exact: true });
    await expect(dialog).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Reports, 1 unread', exact: true })).toHaveClass('has-unread');
    await dialog.getByRole('button', { name: 'Back to reports', exact: true }).click();
    await nav.getByRole('button', { name: 'Rally Point', exact: true }).click();
    await page.getByRole('tab', { name: 'Reports', exact: true }).click();
    await page.getByRole('button', { name: /Pruned Rally receipt/ }).click();
    dialog = page.getByRole('dialog', { name: 'Saved battle report', exact: true });
    await expect(dialog).toBeVisible();
    await expect(nav.getByRole('button', { name: /^Reports/ })).not.toHaveClass('has-unread');
    await dialog.getByRole('button', { name: 'Back to reports', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Reports', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.reload(); await page.getByRole('button', { name: 'Continue campaign', exact: true }).click();
    await expect(nav.locator('button.has-unread')).toHaveCount(0);
    const read = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), `peris-read-reports:solo:${owner}:${world.players[0].created_at}`);
    expect(read.sort()).toEqual(world.reports.slice(0, 2).map(report => report.battle_id).sort());
});

test('unread reports highlight only Reports, decrease when opened and persist after reload', async ({ page }, info) => {
    const world = createSolo('Report QA'); let id = 60000;
    for (const camp of world.camps.filter(c => c.bandit).slice(0, 2)) {
        beginRaid(world, 'solo-ruler', camp.id, () => ++id);
        const battle = world.battles.at(-1)!;
        const formations = world.formations.filter(f => f.battle_id === battle.id);
        formations.filter(f => f.side === 'defender').forEach(f => { f.soldiers = 0; f.status = 'routed'; });
        finishBattle(battle, formations, 'attacker', 'Army routed');
        settleBattle(world, battle.id, 'solo-ruler', () => ++id);
    }
    await page.addInitScript(w => {
        if (!localStorage.getItem('peris-campaign-v6')) localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({sound:false,music:false,reducedMotion:true}));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/'); await page.getByRole('button', { name:'Continue campaign', exact:true }).click();
    const nav = page.getByRole('navigation', { name:'Game navigation' });
    const reports = nav.getByRole('button', { name:'Reports, 2 unread', exact:true });
    await expect(reports).toHaveClass('has-unread');
    await expect(nav.locator('button.has-unread')).toHaveCount(1);
    await reports.click();
    await page.mouse.move(0, 0);
    await expect(reports).toHaveCSS('background-color', 'rgb(232, 198, 108)');
    await page.screenshot({ path:info.outputPath('unread-reports.png') });
    await page.locator('.report-row').first().click();
    await expect(page.getByRole('region', {name:'Report details'})).toContainText('Victory');
    await expect(nav.getByRole('button', { name:'Reports, 1 unread', exact:true })).toHaveClass('has-unread');
    await page.getByRole('button', { name:'Back to reports', exact:true }).click();
    await page.reload(); await page.getByRole('button', { name:'Continue campaign', exact:true }).click();
    await nav.getByRole('button', { name:'Reports, 1 unread', exact:true }).click();
    await page.locator('.report-row').nth(1).click();
    await expect(page.getByRole('region', {name:'Report details'})).toContainText('Victory');
    await expect(nav.getByRole('button', { name:/^Reports/ })).not.toHaveClass('has-unread');
    await page.getByRole('button', { name:'Back to reports', exact:true }).click();
    await page.reload(); await page.getByRole('button', { name:'Continue campaign', exact:true }).click();
    await expect(nav.locator('button.has-unread')).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('peris-campaign-v6')!));
    expect(saved.reports.every((r:{read_at?:string|null}) => r.read_at)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

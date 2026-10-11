import { test, expect } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { beginRaid } from '../../src/features/campaign/domain/raids';
import { finishBattle } from '../../src/features/battle/domain/resolution';
import { settleBattle } from '../../src/features/campaign/domain/battleSettlement';

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
    await page.locator('.report-list>button').first().click();
    await expect(page.getByRole('dialog', { name:'Battle result' })).toBeVisible();
    await expect(nav.getByRole('button', { name:'Reports, 1 unread', exact:true })).toHaveClass('has-unread');
    await page.getByRole('button', { name:'Back to map', exact:true }).click();
    await page.reload(); await page.getByRole('button', { name:'Continue campaign', exact:true }).click();
    await nav.getByRole('button', { name:'Reports, 1 unread', exact:true }).click();
    await page.locator('.report-list>button').nth(1).click();
    await expect(page.getByRole('dialog', { name:'Battle result' })).toBeVisible();
    await expect(nav.getByRole('button', { name:/^Reports/ })).not.toHaveClass('has-unread');
    await page.getByRole('button', { name:'Back to map', exact:true }).click();
    await page.reload(); await page.getByRole('button', { name:'Continue campaign', exact:true }).click();
    await expect(nav.locator('button.has-unread')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

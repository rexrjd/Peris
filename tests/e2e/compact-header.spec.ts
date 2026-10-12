import {test, expect} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';

test('compact command header keeps the scene clear and all controls usable', async ({page}, info) => {
    const world = createSolo('Command QA'), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(w => {
        if (!localStorage.getItem('peris-campaign-v6')) localStorage.setItem('peris-campaign-v6', JSON.stringify(w));
        localStorage.setItem('peris-settings', JSON.stringify({sound:false,music:false,reducedMotion:true}));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`, 'yes');
    }, world);
    await page.goto('/'); await page.getByRole('button', {name:'Continue campaign', exact:true}).click();
    const header = page.locator('.game-header'), nav = page.getByRole('navigation', {name:'Game navigation'});
    await expect(header.locator('.game-brand')).toHaveCount(0);
    await expect(header.locator('.game-menu-player')).not.toBeVisible();
    expect((await header.boundingBox())!.height).toBe(44);
    await expect(header).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    if(info.project.name.includes('desktop')) {
        const left=(await nav.boundingBox())!, right=(await page.locator('.game-header-actions').boundingBox())!;
        expect(right.x-left.x-left.width).toBeGreaterThan(100);
        expect(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName,{x:(left.x+left.width+right.x)/2,y:left.y+left.height/2})).toBe('CANVAS');
    }
    await expect(header.locator('.hud-stock').first()).toHaveCSS('font-size', info.project.name.includes('desktop') ? '12px' : '11px');
    await expect(header.locator('.hud-picture')).toHaveCount(10);
    await expect(page.getByLabel('Game menu')).toBeInViewport();
    for (const button of await nav.getByRole('button').all()) await expect(button).toBeInViewport();
    for (const img of await header.locator('.hud-picture').all())
        await expect.poll(() => img.evaluate((el:HTMLImageElement) => el.complete && el.naturalWidth === 96)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button',{name:'Focus your settlement',exact:true}).click();
    await page.screenshot({path:info.outputPath('compact-map-header.png')});
    await header.getByRole('button', {name:/^Timber:/}).click();
    const supplies = page.getByRole('dialog', {name:'Timber supplies'});
    await expect(supplies).toContainText('per minute'); await expect(supplies).toContainText('stored');
    await page.keyboard.press('Escape'); await expect(supplies).toHaveCount(0);
    await nav.getByRole('button', {name:'City', exact:true}).click();
    await expect(page.locator('.city-toolbar')).toBeVisible();
    await page.screenshot({path:info.outputPath('compact-city-header.png')});
    await nav.getByRole('button', {name:'Rally Point', exact:true}).click();
    await expect(page.locator('.rally-point')).toBeVisible();
    await nav.getByRole('button', {name:'Armies', exact:true}).click();
    await expect(nav.getByRole('button', {name:'Armies', exact:true})).toHaveAttribute('aria-current','page');
    await nav.getByRole('button', {name:'Map', exact:true}).click();
    const quick = page.getByRole('button', {name:'Quick access', exact:true});
    await quick.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('navigation', {name:'Quick access shortcuts'})).toBeVisible();
    await page.keyboard.press('Escape'); await expect(quick).toBeFocused();
    await page.getByLabel('Game menu').focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('button', {name:'Settings', exact:true})).toBeVisible();
    expect(errors).toEqual([]);
});

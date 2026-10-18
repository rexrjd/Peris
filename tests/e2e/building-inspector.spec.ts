import { test, expect, type Page } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { refreshCityEconomy } from '../../src/features/city/domain/slots';
import { BUILDINGS } from '../../src/features/city/domain/buildings';

async function start(page: Page, painted = false) {
    const world = createSolo('Inspector'), town = world.settlements[0];
    world.buildings.forEach(building => { building.level = building.building_type === 'market' ? 2 : 3; });
    world.city_slots = [{settlement_id:town.id,slot_index:0,building_type:'barracks',level:3},{settlement_id:town.id,slot_index:1,building_type:'mage_tower',level:4},{settlement_id:town.id,slot_index:2,building_type:'academy',level:2}];
    refreshCityEconomy(world,town.id);
    await page.addInitScript(w => {
        if(!localStorage.getItem('peris-campaign-v6'))localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
        localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
    },world);
    await page.goto('/'); await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
    await page.getByRole('button',{name:'City',exact:true}).click();
    if(!painted)await page.getByRole('button',{name:'3D',exact:true}).click();
    if(!painted)await expect(page.locator('.city-3d-scene.ready canvas')).toBeVisible();
    return world;
}
const panel = (page: Page) => page.locator('.building-inspector');

test('compact upgrades leave the city visible and allow direct selection of another building', async ({page,isMobile},info) => {
    await start(page); await page.locator('[data-building="market"]').click();
    await expect(panel(page)).toHaveAttribute('aria-modal','false');
    await expect(page.locator('.modal-backdrop')).toHaveCount(0);
    const rect=(await panel(page).boundingBox())!, size=page.viewportSize()!;
    expect(rect.width).toBeLessThanOrEqual(isMobile?size.width-12:390);
    expect(rect.height).toBeLessThan(460);
    expect(rect.width*rect.height/(size.width*size.height)).toBeLessThan(isMobile?.65:.18);
    await expect(panel(page).getByRole('button',{name:'Upgrade to level 3',exact:true})).toBeInViewport();
    await expect(panel(page).getByRole('table')).toContainText('Building plots');
    await page.screenshot({path:info.outputPath('main-building.png')});
    if(isMobile){await panel(page).getByRole('button',{name:'Minimize building panel',exact:true}).click();expect((await panel(page).boundingBox())!.height).toBeLessThan(100);}
    await page.locator('[data-building="lumber"]').click();
    await expect(panel(page).getByRole('heading',{name:BUILDINGS.lumber.name,exact:true})).toBeVisible();
    await expect(page.locator('.building-inspector')).toHaveCount(1);
    await page.keyboard.press('Escape'); await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('[data-building="lumber"]')).toBeFocused();
    await page.locator('[data-building="market"]').click();
    await panel(page).getByRole('button',{name:'Upgrade to level 3',exact:true}).click();
    await expect(panel(page)).toContainText('Builders are working');
    await expect(panel(page).getByRole('progressbar')).toBeVisible();
    const orders=await page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!).orders);
    expect(orders.filter((order:{kind:string;item:string})=>order.kind==='upgrade'&&order.item==='market')).toHaveLength(1);
    await page.screenshot({path:info.outputPath('construction.png')});
});

test('plot picker has a pinned build action and preserves unique building rules', async ({page},info) => {
    await start(page); await page.locator('[data-building="slot:3"]').click();
    await expect(panel(page).getByRole('radio')).toHaveCount(9);
    await panel(page).getByRole('radio',{name:/^Barracks/}).check();
    await expect(panel(page).getByRole('button',{name:'One barracks per city',exact:true})).toBeDisabled();
    await panel(page).getByRole('radio',{name:/^Housing/}).check();
    await expect(panel(page).getByRole('button',{name:'Build Housing',exact:true})).toBeInViewport();
    await page.screenshot({path:info.outputPath('empty-plot.png')});
    await panel(page).getByRole('button',{name:'Build Housing',exact:true}).click();
    await expect(panel(page)).toContainText('Builders are working');
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!).city_slots.find((slot:{slot_index:number})=>slot.slot_index===3)?.building_type)).toBe('housing');
});

test('training keeps its action visible, preserves quantity across tabs and nests the spellbook safely', async ({page,isMobile},info) => {
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await start(page); await page.locator('[data-building="slot:0"]').click();
    await expect(panel(page).getByRole('tab',{name:'Train',exact:true})).toHaveAttribute('aria-selected','true');
    await panel(page).getByLabel('Soldiers to train',{exact:true}).fill('10');
    await panel(page).getByRole('tab',{name:'Upgrade',exact:true}).click();
    await expect(panel(page).getByRole('button',{name:'Upgrade to level 4',exact:true})).toBeInViewport();
    await panel(page).getByRole('tab',{name:'Train',exact:true}).click();
    await expect(panel(page).getByLabel('Soldiers to train',{exact:true})).toHaveValue('10');
    await expect(panel(page).getByRole('button',{name:/^Train 10 /})).toBeInViewport();
    await page.screenshot({path:info.outputPath('barracks.png')});
    await panel(page).getByRole('button',{name:/^Train 10 /}).click();
    await expect(panel(page).locator('.building-inspector-training-queue')).toBeVisible();
    if(isMobile)await panel(page).getByRole('button',{name:'Minimize building panel',exact:true}).click();
    await page.locator('[data-building="slot:1"]').click();
    await panel(page).getByRole('button',{name:/Open spellbook/}).click();
    const spellbook=page.getByRole('dialog',{name:'Mage tower · Spellbook',exact:true});
    await expect(spellbook).toBeVisible(); await page.keyboard.press('Escape');
    await expect(spellbook).toHaveCount(0); await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape'); await expect(panel(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('short screens keep actions above the bottom navigation and painted view shares the inspector',async({page,isMobile},info)=>{
    await page.setViewportSize(isMobile?{width:320,height:640}:{width:1280,height:600});
    await start(page,true);
    await page.getByRole('button',{name:/^Main building,/}).click();
    await expect(panel(page).getByRole('button',{name:'Upgrade to level 3',exact:true})).toBeInViewport();
    await expect(panel(page).getByRole('img')).toBeVisible();
    const rect=(await panel(page).boundingBox())!;expect(rect.y).toBeGreaterThan(50);expect(rect.y+rect.height).toBeLessThan(page.viewportSize()!.height-10);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('painted-small-screen.png')});
});

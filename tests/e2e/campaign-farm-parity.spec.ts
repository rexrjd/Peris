import { test, expect, type Page } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { emptyRoster, readRoster, writeRoster } from '../../src/features/army/domain/roster';
import { findMarchPath } from '../../src/features/map/domain/pathfinding';
import { wrappedWorldDelta } from '../../src/features/map/domain/dimensions';
import type { World } from '../../src/shared/model/world';

const saved = (page: Page): Promise<World> => page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!));
function fixture() {
    const world = createSolo('Farm UI QA'), owner = world.players[0].id, army = world.armies[0];
    writeRoster(army,{...emptyRoster(),infantry:20,scout:6,heavyCavalry:4,catapult:2});
    const camps = world.camps.filter(c=>c.bandit&&Math.hypot(wrappedWorldDelta(army.target_x,c.x),wrappedWorldDelta(army.target_y,c.y))>3000).filter(c=>findMarchPath({x:army.target_x,y:army.target_y},c)).slice(0,3);
    world.campaign_farm_lists = [{id:1,owner_id:owner,name:'Nearby camps',troops:{...emptyRoster(),scout:2,heavyCavalry:3},casualties_only:true},{id:2,owner_id:owner,name:'Reserve farms',troops:{...emptyRoster(),infantry:1},casualties_only:false}];
    world.campaign_farms = camps.map((camp,i)=>({id:i+1,owner_id:owner,list_id:i<2?1:2,camp_id:camp.id,army_id:army.id,troops:{...emptyRoster(),infantry:2,scout:1},created_at:world.server_now,enabled:false,interval_seconds:300,sent:0,skipped:0}));
    world.campaign_farm_stats = camps.slice(0,2).map((camp,i)=>({owner_id:owner,camp_id:camp.id,raids:20,last_raid_at:world.server_now,last_loot:2+i,total_loot:i?100:20,last_result:'attacker',last_losses:0}));
    return { world,camps };
}
async function open(page:Page,world:World) {
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(w=>{if(!localStorage.getItem('peris-campaign-v6'))localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},world);
    await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
    await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:'Rally Point',exact:true}).click();await page.getByRole('tab',{name:'Farm lists',exact:true}).click();
    await expect(page.getByRole('region',{name:'Farm lists',exact:true})).toBeVisible();return errors;
}
const group = (page:Page,name:string) => page.locator('.campaign-farm-list').filter({has:page.locator('summary').filter({hasText:name})});

test('farm selection moves/deletes groups and preserves target identities and history on reload',async({page},info)=>{
    const f=fixture(),errors=await open(page,f.world),near=group(page,'Nearby camps');
    await near.getByLabel('Select all targets in Nearby camps').check();await near.getByLabel('Move selected targets from Nearby camps').selectOption('2');await near.getByRole('button',{name:'Move selected',exact:true}).click();
    await expect.poll(async()=> (await saved(page)).campaign_farms!.filter(f=>f.list_id===2).length).toBe(3);
    const reserve=group(page,'Reserve farms');await expect(reserve.locator('.campaign-farm-target')).toHaveCount(3);await expect(reserve).toContainText('Total delivered 100');
    expect((await saved(page)).campaign_farms!.map(f=>f.id)).toEqual([1,2,3]);
    await reserve.getByLabel(`Select ${f.camps[0].name}`,{exact:true}).check();await reserve.getByLabel(`Select ${f.camps[1].name}`,{exact:true}).check();await reserve.getByRole('button',{name:'Delete selected',exact:true}).click();
    await expect.poll(async()=> (await saved(page)).campaign_farms!.length).toBe(1);expect((await saved(page)).campaign_farm_stats!.map(s=>s.total_loot)).toEqual([20,100]);
    await page.reload();await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:'Rally Point',exact:true}).click();await page.getByRole('tab',{name:'Farm lists',exact:true}).click();
    await expect(group(page,'Reserve farms').locator('.campaign-farm-target')).toHaveCount(1);
    await page.screenshot({path:info.outputPath('farm-bulk-actions.png'),fullPage:true});expect(errors).toEqual([]);
});

test('farm schedules, whole-list presets and reverse sorting use all-time delivered history',async({page},info)=>{
    const f=fixture(),errors=await open(page,f.world),near=group(page,'Nearby camps');
    await near.getByRole('button',{name:'Enable list',exact:true}).click();await expect.poll(async()=> (await saved(page)).campaign_farms!.filter(f=>f.list_id===1&&f.enabled).length).toBe(2);
    const before=(await saved(page)).campaign_farms!.slice(0,2).map(f=>f.next_at);await expect(near).toContainText('Next attack in');
    await near.getByRole('button',{name:'Apply preset to all',exact:true}).click();await expect.poll(async()=> (await saved(page)).campaign_farms![0].troops.heavyCavalry).toBe(3);
    expect((await saved(page)).campaign_farms!.slice(0,2).map(f=>f.next_at)).toEqual(before);
    await page.getByLabel('Sort farm targets').selectOption('totalBounty');await expect(near.locator('.campaign-farm-target').first()).toContainText('Total delivered 100');
    await page.getByRole('button',{name:'Reverse farm sort',exact:true}).click();await expect(near.locator('.campaign-farm-target').first()).toContainText('Total delivered 20');
    await near.getByRole('button',{name:'Pause list',exact:true}).click();await expect.poll(async()=> (await saved(page)).campaign_farms!.filter(f=>f.list_id===1&&f.enabled).length).toBe(0);
    expect((await saved(page)).campaign_farms!.slice(0,2).every(f=>f.next_at===null)).toBe(true);await expect(near).toContainText('No next attack');
    await page.screenshot({path:info.outputPath('farm-history-and-controls.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

test('reviewed batches show sent/skipped counters and bulk edits do not change travelling troops',async({page},info)=>{
    const f=fixture(),errors=await open(page,f.world),near=group(page,'Nearby camps');
    await near.getByRole('button',{name:'Start list',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Start farm list: Nearby camps',exact:true});
    expect((await saved(page)).armies[0].status).toBe('idle');await dialog.getByRole('button',{name:'Confirm batch',exact:true}).click();
    await expect.poll(async()=> (await saved(page)).armies[0].status).toBe('moving');await expect(near).toContainText('1 sent · 0 skipped');await expect(near).toContainText('0 sent · 1 skipped');
    const travelling=readRoster((await saved(page)).armies[0]);await near.getByRole('button',{name:'Apply preset to all',exact:true}).click();await expect.poll(async()=> (await saved(page)).campaign_farms![0].troops.heavyCavalry).toBe(3);expect(readRoster((await saved(page)).armies[0])).toEqual(travelling);
    await near.getByLabel('Select all targets in Nearby camps').check();await near.getByRole('button',{name:'Delete selected',exact:true}).click();await expect.poll(async()=> (await saved(page)).campaign_farms!.filter(f=>f.list_id===1).length).toBe(0);expect((await saved(page)).armies[0].status).toBe('moving');expect(readRoster((await saved(page)).armies[0])).toEqual(travelling);
    await page.getByRole('tab',{name:'Movements',exact:true}).click();await page.getByRole('button',{name:/^Outgoing [0-9]+$/}).click();await expect(page.getByRole('button',{name:'Cancel order',exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath('farm-batch-movement.png'),fullPage:true});expect(errors).toEqual([]);
});

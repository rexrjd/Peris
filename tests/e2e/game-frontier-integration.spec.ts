import { test, expect, type Page } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { readRoster, writeRoster } from '../../src/features/army/domain/roster';
import { readFileSync } from 'node:fs';
import { RECRUIT_RULES, type RecruitUnit } from '../../src/features/army/domain/roster';
const roman=JSON.parse(readFileSync('assets/concepts/faction-sheets-v1/expanded-rosters.json','utf8')).roster.find((f:any)=>f.id==='roman');
const factionTroopName=(_faction:string,unit:RecruitUnit):string=>[...roman.troops,...roman.siege].find((troop:any)=>troop.id===RECRUIT_RULES[unit].role).name;
import { findMarchPath } from '../../src/features/map/domain/pathfinding';
import { refreshCityEconomy } from '../../src/features/city/domain/slots';
import type { World } from '../../src/shared/model/world';

function fixture() {
 const world=createSolo('Integrated Peris'), army=world.armies[0], city=world.settlements[0];
 world.city_slots=[{settlement_id:city.id,slot_index:0,building_type:'barracks',level:1},{settlement_id:city.id,slot_index:1,building_type:'stables',level:1},{settlement_id:city.id,slot_index:2,building_type:'workshop',level:1}];
 refreshCityEconomy(world,city.id); city.wood=city.stone=city.food=city.gold=5000;
 writeRoster(army,{...readRoster(army),scout:4,catapult:1});
 const position={x:army.target_x,y:army.target_y}, camp=world.camps.filter(c=>c.bandit).sort((a,b)=>Math.hypot(a.x-position.x,a.y-position.y)-Math.hypot(b.x-position.x,b.y-position.y)).find(c=>findMarchPath(position,c))!;
 world.campaign_farm_lists=[{id:1,owner_id:army.owner_id,name:'Nearby camps',troops:{infantry:2,archers:0,cavalry:0,scout:3},casualties_only:false},{id:2,owner_id:army.owner_id,name:'Reserve farms',troops:{infantry:1,archers:0,cavalry:0},casualties_only:false}];
 world.campaign_farms=[{id:1,owner_id:army.owner_id,list_id:1,camp_id:camp.id,army_id:army.id,troops:{infantry:2,archers:0,cavalry:0,scout:3},created_at:world.server_now,enabled:false,interval_seconds:300}];
 return {world,camp};
}
async function start(page:Page,world:World) {
 await page.addInitScript(w=>{if(!localStorage.getItem('peris-campaign-v6'))localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},world);
 const requests:string[]=[];page.on('request',request=>{if(request.url().includes('/api/frontier'))requests.push(request.url());});
 await page.goto('/?frontier=1');await expect(page.getByRole('button',{name:'Continue campaign',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:/Frontier Wars/})).toHaveCount(0);expect(new URL(page.url()).searchParams.has('frontier')).toBe(false);
 await page.getByRole('button',{name:'Continue campaign',exact:true}).click();return requests;
}
const saved=(page:Page):Promise<World>=>page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!));
async function lists(page:Page) {await page.getByRole('button',{name:'Quick access',exact:true}).click();await page.getByRole('navigation',{name:'Quick access shortcuts'}).getByRole('button',{name:/^Farm lists/}).click();return page.getByRole('dialog',{name:'Farm lists',exact:true});}

test('Frontier units recruit inside the existing Peris city and legion',async({page},info)=>{
 const {world}=fixture(),requests=await start(page,world),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'Armies',exact:true}).click();

 const buildings=page.getByRole('navigation',{name:'Recruitment buildings'});
 await buildings.getByRole('button',{name:/Stables/}).click();await expect(page.locator('.game-unit-choices button')).toHaveCount(3);
 const scout=factionTroopName('roman','scout');await page.locator('.game-unit-choices button').filter({hasText:scout}).click();await page.getByRole('button',{name:new RegExp('^Research '+scout)}).click();
 await expect.poll(async()=>(await saved(page)).unit_research?.some(r=>r.unit==='scout')).toBe(true);await expect(page.getByRole('status').filter({hasText:'Research completes'})).toBeVisible();
 await buildings.getByRole('button',{name:/Workshop/}).click();await expect(page.locator('.game-unit-choices button')).toHaveCount(2);
 await page.locator('.game-unit-choices button').filter({hasText:factionTroopName('roman','catapult')}).click();await expect(page.getByRole('button',{name:new RegExp('^Research '+factionTroopName('roman','catapult'))})).toBeEnabled();
 await page.screenshot({path:info.outputPath('integrated-workshop.png'),fullPage:true});
 await buildings.getByRole('button',{name:/Barracks/}).click();await page.getByLabel('Soldiers to train').fill('2');await page.getByRole('button',{name:new RegExp('^Train 2 '+factionTroopName('roman','infantry'))}).click();
 await expect.poll(async()=>readRoster((await saved(page)).armies[0]).infantry).toBe(122);
 await page.getByRole('button',{name:'City',exact:true}).click();await expect(page.locator('[data-troop=scout]')).toHaveText('4');await expect(page.locator('[data-troop=catapult]')).toHaveText('1');
 await page.reload();await page.getByRole('button',{name:'Continue campaign',exact:true}).click();expect(readRoster((await saved(page)).armies[0]).catapult).toBe(1);expect(requests).toEqual([]);expect(errors).toEqual([]);
});

test('one game farm lists edit, move, review and cancel nine-role parties',async({page},info)=>{
 const {world,camp}=fixture(),requests=await start(page,world),scout=factionTroopName('roman','scout');let dialog=await lists(page);
 await dialog.getByLabel('Sort farm targets').selectOption('totalBounty');await dialog.getByRole('button',{name:'Edit list',exact:true}).first().click();
 dialog=page.getByRole('dialog',{name:'Edit farm list'});await dialog.getByLabel(scout+' default quantity').fill('2');await dialog.getByRole('button',{name:'Save list',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Farm lists',exact:true});await dialog.getByRole('button',{name:'Edit',exact:true}).click();dialog=page.getByRole('dialog',{name:'Edit farm target'});
 await expect(dialog.getByLabel(scout+' farm quantity')).toHaveValue('3');await dialog.getByLabel('Farm list',{exact:true}).selectOption('2');await dialog.getByLabel('Repeat automatically').check();await dialog.getByLabel('Repeat interval').fill('120');await dialog.getByRole('button',{name:'Save target',exact:true}).click();
 await expect.poll(async()=>(await saved(page)).campaign_farms?.[0].list_id).toBe(2);expect((await saved(page)).campaign_farms?.[0].enabled).toBe(true);
 dialog=page.getByRole('dialog',{name:'Farm lists',exact:true});await dialog.getByRole('button',{name:'Start list',exact:true}).click();dialog=page.getByRole('dialog',{name:'Start farm list: Reserve farms'});await expect(dialog.getByRole('img',{name:scout,exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('integrated-farm-review.png'),fullPage:true});
 expect((await saved(page)).armies[0].status).toBe('idle');await dialog.getByRole('button',{name:'Confirm batch',exact:true}).click();
 await expect.poll(async()=>(await saved(page)).armies[0].status).toBe('moving');let party=await saved(page);expect(readRoster(party.armies[0]).scout).toBe(3);expect(readRoster(party.garrisons![0]).scout).toBe(1);
 dialog=page.getByRole('dialog',{name:'Farm lists',exact:true});await dialog.getByRole('button',{name:/Cancel raid/}).click();await expect.poll(async()=>readRoster((await saved(page)).armies[0]).scout).toBe(4);expect((await saved(page)).garrisons).toEqual([]);
 await dialog.getByRole('button',{name:new RegExp(camp.name)}).click();await expect(page.locator('.atlas-inspector')).toContainText(camp.name);await expect(page.locator('.atlas-inspector')).toContainText('CURRENT CAMP STOCK');await expect(page.locator('.atlas-inspector')).not.toContainText(/Next recruit|Recruitment in/);
 await page.screenshot({path:info.outputPath('integrated-main-map-camp.png')});await page.getByRole('button',{name:'Add to farm list',exact:true}).click();dialog=page.getByRole('dialog',{name:'Add to farm list',exact:true});await expect(dialog.getByLabel(scout+' farm quantity')).toHaveValue('2');await page.keyboard.press('Escape');
 dialog=await lists(page);await dialog.getByRole('button',{name:'Remove',exact:true}).click();await expect.poll(async()=>(await saved(page)).campaign_farms?.length).toBe(0);expect(requests).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

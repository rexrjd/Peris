import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {refreshCityEconomy} from '../../src/features/city/domain/slots';
import {emptyRoster,readRoster,writeRoster,RECRUIT_RULES,type RecruitUnit} from '../../src/features/army/domain/roster';
import {readFileSync} from 'node:fs';
import {validateSave} from '../../src/platform/storage/saves';
import type {World} from '../../src/shared/model/world';
const roman=JSON.parse(readFileSync('assets/concepts/faction-sheets-v1/expanded-rosters.json','utf8')).roster.find((row:{id:string})=>row.id==='roman');
const factionTroopName=(_faction:string,unit:RecruitUnit):string=>[...roman.troops,...roman.siege].find((row:{id:string})=>row.id===RECRUIT_RULES[unit].role).name;
function fixture(){
 const world=createSolo('Army parity'),army=world.armies[0],city=world.settlements[0];city.faction='roman';
 world.buildings.find(row=>row.building_type==='market')!.level=3;
 world.city_slots=[{settlement_id:city.id,slot_index:0,building_type:'barracks',level:1},{settlement_id:city.id,slot_index:1,building_type:'stables',level:1},{settlement_id:city.id,slot_index:2,building_type:'workshop',level:1}];
 writeRoster(army,{...emptyRoster(),infantry:12,spearmen:4,archers:5,elite:3,cavalry:8,scout:6,heavyCavalry:2,ram:1,catapult:2});
 const second={...army,id:99,name:'Receiving legion'};writeRoster(second,emptyRoster());world.armies.push(second);
 world.heroes!.push({...world.heroes![0],id:99,army_id:99,name:'Receiving commander'});
 refreshCityEconomy(world,city.id);Object.assign(city,{wood:5000,stone:5000,food:5000,gold:5000});return world;
}
async function start(page:Page,world:World,view:'City'|'Armies'){
 validateSave(world);await page.addInitScript(w=>{if(!localStorage.getItem('peris-campaign-v6'))localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},world);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('button',{name:view,exact:true}).click();
}
const save=(page:Page):Promise<World>=>page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!));
async function capture(page:Page,info:TestInfo,name:string){const path=info.outputPath(name+'.png');await page.screenshot({path});await info.attach(name,{path,contentType:'image/png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
test('building popup recruits from the actual legion and shows the full selected-building research queue',async({page},info)=>{
 const world=fixture(),city=world.settlements[0],at=Date.parse(world.server_now);
 world.unit_research=[{settlement_id:city.id,unit:'spearmen',started_at:world.server_now,completes_at:new Date(at+600000).toISOString()},{settlement_id:city.id,unit:'elite',started_at:world.server_now,completes_at:new Date(at+700000).toISOString()},{settlement_id:city.id,unit:'scout',started_at:world.server_now,completes_at:new Date(at+800000).toISOString()}];
 await start(page,world,'City');await page.locator('[data-building="slot:0"]').click();let dialog=page.getByRole('dialog',{name:'Selected building',exact:true});
 await expect(dialog.getByRole('combobox',{name:'Recruiting legion'})).toBeVisible();const queue=dialog.getByRole('region',{name:'Building research queue'});
 await expect(queue).toContainText(factionTroopName('romans','spearmen'));await expect(queue).toContainText(factionTroopName('romans','elite'));await expect(queue).not.toContainText(factionTroopName('romans','scout'));
 await dialog.getByRole('combobox',{name:'Recruiting legion'}).selectOption('99');await dialog.getByLabel('Soldiers to train',{exact:true}).fill('2');await dialog.getByRole('button',{name:`Train 2 ${factionTroopName('romans','infantry')}`,exact:true}).click();
 await expect.poll(async()=>(await save(page)).orders.find(order=>order.kind==='recruit')?.army_id).toBe(99);await expect(dialog.locator('.command-training')).toContainText('Receiving legion');await capture(page,info,'building-recruitment');
 await page.keyboard.press('Escape');await page.locator('[data-building="slot:1"]').click();dialog=page.getByRole('dialog',{name:'Selected building',exact:true});await expect(dialog.locator('.game-unit-choices button')).toHaveCount(3);await expect(dialog.locator('.game-unit-choices')).toContainText(factionTroopName('romans','scout'));await expect(dialog.locator('.game-unit-choices')).not.toContainText(factionTroopName('romans','infantry'));
 await page.keyboard.press('Escape');await page.locator('[data-building="slot:2"]').click();dialog=page.getByRole('dialog',{name:'Selected building',exact:true});await expect(dialog.locator('.game-unit-choices button')).toHaveCount(2);await expect(dialog.locator('.game-unit-choices')).toContainText(factionTroopName('romans','catapult'));
});
test('logistics transfers selected scouts and catapults without converting other roles',async({page},info)=>{
 const world=fixture();await start(page,world,'Armies');await page.getByRole('navigation',{name:'Army management'}).getByRole('button',{name:'Logistics',exact:true}).click();
 const table=page.locator('.transfer-table');await expect(table.locator('input')).toHaveCount(9);await table.getByRole('spinbutton',{name:`${factionTroopName('romans','scout')} to transfer`,exact:true}).fill('3');await table.getByRole('spinbutton',{name:`${factionTroopName('romans','catapult')} to transfer`,exact:true}).fill('1');await page.getByRole('button',{name:'Transfer troops',exact:true}).click();
 await expect.poll(async()=>readRoster((await save(page)).armies.find(army=>army.id===99)!).scout).toBe(3);const actual=await save(page),receiving=readRoster(actual.armies.find(army=>army.id===99)!);expect(receiving.catapult).toBe(1);expect(receiving.infantry).toBe(0);expect(receiving.cavalry).toBe(0);expect(readRoster(actual.armies[0]).spearmen).toBe(4);await capture(page,info,'exact-role-transfer');
});
test('building return shortcut reviews exact reinforcement quantities before sending',async({page},info)=>{
 const world=fixture(),army=world.armies[0];Object.assign(army,{start_x:320,start_y:320,target_x:320,target_y:320});world.map_plots=[{col:2,row:2,owner_id:army.owner_id,settlement_id:1,building_type:null,level:0}];
 await start(page,world,'City');await page.locator('[data-building="slot:0"]').click();const dialog=page.getByRole('dialog',{name:'Selected building',exact:true});await dialog.getByRole('combobox',{name:'Recruiting legion'}).selectOption(String(army.id));await dialog.getByRole('button',{name:/^Bring army to /}).click();const review=page.getByRole('dialog',{name:'Prepare march',exact:true});await expect(review).toBeVisible();expect((await save(page)).armies[0].status).toBe('idle');
 for(const input of await review.locator('.march-troops input').all())await input.fill('0');await review.getByRole('spinbutton',{name:`${factionTroopName('romans','scout')} to send`,exact:true}).fill('2');await capture(page,info,'review-reinforcement');await review.getByRole('button',{name:'Confirm march',exact:true}).click();await expect.poll(async()=>(await save(page)).armies[0].status).toBe('moving');const sent=await save(page);expect(readRoster(sent.armies[0]).scout).toBe(2);expect(readRoster(sent.garrisons![0]).catapult).toBe(2);expect(Date.parse(sent.armies[0].march_cancel_until!)-Date.parse(sent.armies[0].march_sent_at!)).toBe(30000);
});

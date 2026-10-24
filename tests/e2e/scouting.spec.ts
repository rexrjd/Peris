import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {readRoster,writeRoster} from '../../src/features/army/domain/roster';
import {findMarchPath} from '../../src/features/map/domain/pathfinding';
import {validateSave} from '../../src/platform/storage/saves';
import type {World} from '../../src/shared/model/world';
import type {Report} from '../../src/features/campaign/domain/types';
import type {ScoutingResult} from '../../src/features/scouting/domain/types';
// @ts-expect-error Isolated SQL/Auth harness never connects to the configured server.
import {accountServer} from '../helpers/account-server.mjs';

async function start(page:Page,world:World){
 validateSave(structuredClone(world));
 await page.addInitScript(w=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},world);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
 await expect(page.locator('canvas[aria-label^="Interactive 200 by 200"]')).toBeVisible();
}
const save=(page:Page):Promise<World>=>page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!));
async function capture(page:Page,info:TestInfo,name:string){const path=info.outputPath(name+'.png');await page.screenshot({path});await info.attach(name,{path,contentType:'image/png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
async function selectCamp(page:Page,camp:World['camps'][number]){
 await page.getByRole('button',{name:'Find a field',exact:true}).click();await page.getByLabel(/Field X coordinate/).fill(String(Math.floor(camp.x/128)));await page.getByLabel(/Field Y coordinate/).fill(String(Math.floor(camp.y/128)));await page.getByRole('button',{name:'Go',exact:true}).click();await page.getByText('Terrain & travel details',{exact:true}).click();await page.getByRole('button',{name:new RegExp(camp.name+'.*Bandit camp')}).click();
}
test('reviewed scout party detaches without its commander and cancels from Events and Rally',async({page},info)=>{
 test.setTimeout(120000);const world=createSolo('Scout Watch'),army=world.armies[0],owner=world.players[0].id;
 world.scouting_version=1;writeRoster(army,{infantry:120,archers:50,cavalry:16,scout:25});
 const original=readRoster(army),camp=world.camps.filter(c=>c.bandit).sort((a,b)=>Math.hypot(a.x-army.target_x,a.y-army.target_y)-Math.hypot(b.x-army.target_x,b.y-army.target_y)).find(c=>findMarchPath({x:army.target_x,y:army.target_y},c))!;
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await start(page,world);await selectCamp(page,camp);
 await page.getByRole('button',{name:'Scout camp',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Prepare scouting mission',exact:true});
 await expect(dialog.getByRole('img',{name:'Speculator',exact:true})).toBeVisible();await dialog.getByLabel('Scouts to send',{exact:true}).fill('0');await expect(dialog.getByRole('button',{name:'Confirm scouting',exact:true})).toBeDisabled();
 await dialog.getByLabel('Scouts to send',{exact:true}).fill('8');await dialog.getByRole('radio',{name:/Defences and troops/}).check();await expect(dialog).toContainText('camps have no wall or Main building');
 for(const radio of await dialog.getByRole('radio').all())expect((await radio.boundingBox())!.width).toBeLessThanOrEqual(20);
 await capture(page,info,'scouting-camp-review');await dialog.getByRole('button',{name:'Confirm scouting',exact:true}).click();
 await expect.poll(async()=>(await save(page)).scouting_missions?.length).toBe(1);let current=await save(page);
 expect(readRoster(current.armies[0])).toEqual({...original,scout:17});expect(current.armies[0].status).toBe('idle');expect(current.heroes).toEqual(world.heroes);expect(current.scouting_missions![0].mode).toBe('defences');
 await page.getByRole('button',{name:'Open map activity',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel scouting: 8 scouts',exact:true})).toBeVisible();await capture(page,info,'scouting-owned-events');
 await page.getByRole('button',{name:'Cancel scouting: 8 scouts',exact:true}).click();await expect.poll(async()=>readRoster((await save(page)).armies[0]).scout).toBe(25);
 await page.getByRole('button',{name:'Collapse map panel',exact:true}).click();await selectCamp(page,camp);await page.getByRole('button',{name:'March and engage',exact:true}).click();dialog=page.locator('.march-dialog');await dialog.getByRole('button',{name:'Clear troops',exact:true}).click();await dialog.getByLabel('Speculator to send',{exact:true}).fill('6');await expect(dialog.getByRole('region',{name:'Scouting mission',exact:true})).toContainText('Resources and troops');await capture(page,info,'scouting-scout-only-raid-review');await dialog.getByRole('button',{name:'Confirm scouting',exact:true}).click();
 await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:'Rally Point',exact:true}).click();await page.getByRole('tab',{name:'Movements',exact:true}).click();await expect(page.getByRole('article',{name:'Scouting: 6 scouts',exact:true})).toBeVisible();await page.getByRole('article',{name:'Scouting: 6 scouts',exact:true}).scrollIntoViewIfNeeded();await capture(page,info,'scouting-rally-movement');await page.getByRole('button',{name:'Cancel scouting',exact:true}).click();await expect.poll(async()=>readRoster((await save(page)).armies[0]).scout).toBe(25);
 current=await save(page);expect(current.scouting_missions?.filter(m=>m.status==='outbound')).toHaveLength(0);expect(current.armies[0].owner_id).toBe(owner);expect(errors).toEqual([]);
});

test('shared-world city scouting sends only selected scouts and old servers hide its action',async({page,context},info)=>{
 test.setTimeout(240000);const server=await accountServer();let oldServer=false;const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await context.addInitScript(()=>localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true})));
  await context.route('**/*.supabase.co/**',async route=>{const request=route.request(),reply=await server.request(request.url(),request.method(),request.headers(),request.postDataJSON()??{});if(oldServer&&request.url().includes('/rpc/peris_snapshot')&&reply.status===200)delete reply.data.scouting_version;await route.fulfill({status:reply.status,headers:reply.headers,body:reply.data==null?'':JSON.stringify(reply.data)});});
  await page.goto('/');await page.getByRole('button',{name:'Shared world',exact:true}).click();await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByLabel('Name your ruler').fill('City Scout Browser');await page.locator('.account-create .account-primary').click();await expect(page.getByLabel('Game menu')).toBeVisible();
  const owner=server.logins[0].player_id,rival=await server.seed('Scout Rival','persian'),fixture=await server.cityRaidFixture(owner,rival.player_id);
  const city=async()=>{await page.getByRole('button',{name:'Find a field',exact:true}).click();await page.getByLabel(/Field X coordinate/).fill(String(Math.floor(fixture.city.x/128)));await page.getByLabel(/Field Y coordinate/).fill(String(Math.floor(fixture.city.y/128)));await page.getByRole('button',{name:'Go',exact:true}).click();await page.getByText('Terrain & travel details',{exact:true}).click();await page.getByRole('button',{name:new RegExp(fixture.city.name+'.*Rival settlement')}).click();};
  await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();await city();await expect(page.getByRole('button',{name:'Raid city',exact:true})).toBeVisible();await page.getByRole('button',{name:'Scout city',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Prepare scouting mission',exact:true});await dialog.getByLabel('Scouts to send',{exact:true}).fill('5');await capture(page,info,'scouting-shared-city-review');await dialog.getByRole('button',{name:'Confirm scouting',exact:true}).click();
  await expect.poll(async()=>(await server.raidArmy(fixture.armyId)).unit_roster.scout).toBe(5);const party=await server.raidArmy(fixture.armyId);expect(party.status).toBe('idle');expect(party.unit_roster.infantry).toBe(100);expect(party.raid_city_id).toBeNull();
  await page.getByRole('button',{name:'Open map activity',exact:true}).click();await page.getByRole('button',{name:'Cancel scouting: 5 scouts',exact:true}).click();await expect.poll(async()=>(await server.raidArmy(fixture.armyId)).unit_roster.scout).toBe(10);
  oldServer=true;await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();await city();await expect(page.getByRole('button',{name:'Raid city',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Scout city',exact:true})).toHaveCount(0);await capture(page,info,'scouting-old-server-gate');expect(errors).toEqual([]);
 }finally{await server.close();}
});

test('Reports preserve observed snapshots and separate successful intel from failed or detected missions',async({page},info)=>{
 const world=createSolo('Scout Archive'),owner=world.players[0].id,stamp=world.server_now;
 const scouting:ScoutingResult={mission_id:1,mode:'resources',target:{kind:'city',id:900,name:'Azure Gate',owner_id:'former-ruler',faction:'persian',x:400,y:400},observed_at:stamp,scouts_sent:12,scouts_lost:2,scouts_survived:10,detected:true,success:true,troops:{infantry:47,archers:18,cavalry:9,scout:3},resources:{wood:4321,stone:3210,food:2109,gold:1098}};
 const report=(id:number,intel:ScoutingResult,side:'attacker'|'defender'='attacker'):Report=>({id,owner_id:owner,battle_id:100+id,title:(side==='defender'?'Detected scouts: ':'Scouting: ')+intel.target.name,won:intel.success,created_at:new Date(Date.parse(stamp)-id*1000).toISOString(),result:{attacker_initial:12,attacker_survivors:10,attacker_losses:2,defender_initial:0,defender_survivors:0,defender_losses:0,loot:{wood:0,stone:0,food:0,gold:0},duration:0,reason:'Scouting',report_side:side,scouting:intel}});
 world.reports=[report(1,scouting),report(2,{...scouting,target:{...scouting.target,name:'Bronze Gate'},mode:'defences',resources:undefined,defences:{wall:4,main:3}}),report(3,{...scouting,target:{...scouting.target,name:'Lost Watch'},success:false,scouts_survived:0,scouts_lost:12,troops:undefined,resources:undefined,reason:'All scouts lost'}),report(4,{...scouting,target:{...scouting.target,name:'Home watch'},success:false,troops:undefined,resources:undefined,sender_name:'Other ruler'},'defender')];
 await start(page,world);await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:/^Reports/}).click();
 await page.locator('.report-row').filter({hasText:'Azure Gate'}).click();let detail=page.getByRole('region',{name:'Report details',exact:true});await expect(detail).toContainText('Scouting successful');await expect(detail.getByRole('region',{name:'Observed resources',exact:true})).toContainText('4,321');await expect(detail.getByRole('region',{name:'Observed troops',exact:true})).toBeVisible();await expect(detail).toContainText('Observed at');await expect(detail).not.toContainText('Hero XP');await expect(detail).not.toContainText('Recorded spoils');await capture(page,info,'scouting-resource-report');
 await detail.getByRole('button',{name:'Back to reports',exact:true}).click();await page.locator('.report-row').filter({hasText:'Bronze Gate'}).click();detail=page.getByRole('region',{name:'Report details',exact:true});await expect(detail.getByRole('region',{name:'Observed defences',exact:true})).toContainText('Level 4');await expect(detail).toContainText('Main building');await expect(detail.getByRole('region',{name:'Observed resources',exact:true})).toHaveCount(0);await detail.getByRole('region',{name:'Observed defences',exact:true}).scrollIntoViewIfNeeded();await capture(page,info,'scouting-defence-report');
 for(const [name,title]of [['Lost Watch','Scouting failed'],['Home watch','Scouts detected']]){await detail.getByRole('button',{name:'Back to reports',exact:true}).click();await page.locator('.report-row').filter({hasText:name}).click();await expect(detail).toContainText(title);await expect(detail.getByRole('region',{name:/Observed troops|Observed resources|Observed defences/})).toHaveCount(0);await expect(detail).not.toContainText('4,321');await capture(page,info,name==='Lost Watch'?'scouting-failed-report':'scouting-detection-report');}
});

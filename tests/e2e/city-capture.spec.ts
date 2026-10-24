import {test,expect,type Page} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {refreshCityEconomy} from '../../src/features/city/domain/slots';
import {TECHNOLOGY_BY_ID} from '../../src/features/research/domain/catalog';
import {ensureScience} from '../../src/features/research/domain/science';
import {validateSave} from '../../src/platform/storage/saves';
import {writeRoster} from '../../src/features/army/domain/roster';
import {newBattle} from '../../src/features/battle/domain/creation';
// @ts-expect-error Isolated SQL/Auth harness never connects to the configured server.
import {accountServer} from '../helpers/account-server.mjs';

async function localCity(page:Page,unlocked:boolean){
 const world=createSolo('Envoy Court'),city=world.settlements[0];
 ensureScience(world,city.owner_id,Date.parse(world.server_now));
 world.conquest_version=1;city.loyalty=60;city.loyalty_updated_at=world.server_now;
 world.buildings.find(row=>row.building_type==='market')!.level=2;
 if(unlocked)world.research_progress=['command','logistics','diplomacy'].map(id=>({owner_id:city.owner_id,technology_id:id,seconds:TECHNOLOGY_BY_ID.get(id)!.seconds,completed_at:world.server_now}));
 Object.assign(city,{wood:5000,stone:5000,food:5000,gold:5000});refreshCityEconomy(world,city.id);
 validateSave(structuredClone(world));
 await page.addInitScript(world=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(world));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${world.players[0].id}:${world.players[0].created_at}`,'yes');sessionStorage.setItem(`peris-city-view:${world.players[0].id}`,'3d');},world);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
 await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:'City',exact:true}).click();
 await expect(page.locator('.city-3d-scene.ready canvas')).toBeVisible();return world;
}

test('live 3D main building links Diplomacy research and trains a named diplomat',async({page},info)=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await localCity(page,true);await expect(page.getByRole('region',{name:'City loyalty',exact:true})).toContainText('+25 / game hour');
 const canvas=page.locator('.city-3d-scene.ready canvas');await canvas.focus();await page.keyboard.press('e');await page.getByRole('button',{name:'Reset city camera',exact:true}).click();
 await page.locator('[data-building="market"]').click();const dialog=page.getByRole('dialog',{name:'Selected building',exact:true});
 await dialog.getByRole('tab',{name:'Train',exact:true}).click();await expect(dialog).toContainText('Main building level 2 and Diplomacy');
 await dialog.getByLabel('Soldiers to train',{exact:true}).fill('1');await dialog.getByRole('button',{name:'Train 1 Senator',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!).orders.filter((order:{kind:string;item:string})=>order.kind==='recruit'&&order.item==='diplomat').length)).toBe(1);
 await page.screenshot({path:info.outputPath('main-building-diplomat-recruitment.png')});await page.keyboard.press('Escape');
 await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:'Armies',exact:true}).click();await page.locator('.army-troop-inspect[data-unit="diplomat"]').click();
 const stats=page.getByRole('dialog',{name:/Senator stats/});await expect(stats).toContainText('Main building');await expect(stats.locator('svg[data-diplomat-faction="roman"]')).toBeVisible();
 await page.screenshot({path:info.outputPath('diplomat-dossier.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('locked main-building diplomat opens the existing Diplomacy research node',async({page},info)=>{
 test.setTimeout(120000);await localCity(page,false);await page.locator('[data-building="market"]').click();
 const dialog=page.getByRole('dialog',{name:'Selected building',exact:true});await dialog.getByRole('tab',{name:'Train',exact:true}).click();await dialog.getByRole('button',{name:/Unlock in Research/}).click();
 await expect(page.getByRole('complementary',{name:'Selected technology'})).toContainText('Diplomacy');await page.screenshot({path:info.outputPath('diplomacy-unlock-link.png')});
});

test('capture review sends an exact party through city raids and shows the finalized capture',async({page,context},info)=>{
 test.setTimeout(240000);const server=await accountServer(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 let oldServer=false;
 try{
  await context.addInitScript(()=>{localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));});
  await context.route('**/*.supabase.co/**',async route=>{
   const request=route.request(),reply=await server.request(request.url(),request.method(),request.headers(),request.postDataJSON()??{});
   if(oldServer&&request.url().includes('/rpc/peris_snapshot')&&reply.status===200)delete reply.data.conquest_version;
   await route.fulfill({status:reply.status,headers:reply.headers,body:reply.data==null?'':JSON.stringify(reply.data)});
  });
  await page.goto('/');await page.getByRole('button',{name:'Shared world',exact:true}).click();await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByLabel('Name your ruler').fill('Capture Browser');await page.locator('.account-create .account-primary').click();await expect(page.getByLabel('Game menu')).toBeVisible();
  const owner=server.logins[0].player_id,rival=await server.seed('Envoy Rival','persian'),fixture=await server.captureFixture(owner,rival.player_id);
  await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();await page.getByRole('button',{name:'Find a field',exact:true}).click();await page.getByLabel(/Field X coordinate/).fill(String(Math.floor(fixture.city.x/128)));await page.getByLabel(/Field Y coordinate/).fill(String(Math.floor(fixture.city.y/128)));await page.getByRole('button',{name:'Go',exact:true}).click();
  await page.getByText('Terrain & travel details',{exact:true}).click();await page.getByRole('button',{name:new RegExp(fixture.city.name+'.*Rival settlement')}).click();
  await page.getByRole('button',{name:'Capture city',exact:true}).click();let review=page.getByRole('dialog',{name:'Prepare city capture',exact:true});
  await expect(review.getByRole('region',{name:'Capture review'})).toContainText('Loyalty is private');await expect(review.getByRole('region',{name:'Capture review'})).not.toContainText('5 / 100');
  await review.getByRole('button',{name:'Clear troops',exact:true}).click();await review.getByRole('button',{name:'Show unavailable troop types'}).click();
  const confirm=review.getByRole('button',{name:'Confirm capture',exact:true});await expect(confirm).toBeDisabled();await review.locator('[data-unit="infantry"] input').fill('40');await review.locator('[data-unit="diplomat"] input').fill('10');await expect(confirm).toBeEnabled();
  await page.screenshot({path:info.outputPath('city-capture-review.png')});await confirm.click();await expect.poll(async()=>(await server.raidArmy(fixture.armyId)).raid_city_id).toBe(fixture.city.id);
  const party=await server.raidArmy(fixture.armyId);expect(party.unit_roster.infantry).toBe(40);expect(party.unit_roster.diplomat).toBe(10);expect(party.unit_roster.catapult).toBe(0);
  await server.resolveCityRaid(fixture.armyId);await expect.poll(async()=>(await server.captureCity(fixture.city.id)).owner_id).toBe(owner);
  await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:/^Reports/}).click();await page.locator('.report-row').first().click();
  const receipt=page.getByRole('region',{name:'City capture',exact:true});await expect(receipt).toContainText('City captured');await expect(receipt).toContainText('300');await expect(receipt).toContainText('occupies the captured city');await page.screenshot({path:info.outputPath('city-capture-report.png')});
  oldServer=true;await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:'Armies',exact:true}).click();await expect(page.locator('.army-troop-inspect[data-unit="diplomat"]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 }finally{await server.close();}
});

test('original diplomat geometry appears in automatic 3D battles and Canvas keeps its identity',async({page},info)=>{
 test.setTimeout(120000);const world=createSolo('Envoy Battle'),army=world.armies[0],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 writeRoster(army,{infantry:120,archers:30,cavalry:10,diplomat:20});
 const created=newBattle(123,army.owner_id,army,world.camps[0],'plains','normal','Envoy training','pve',1,{version:2,attackerFaction:'persian',defenderFaction:'roman',now:world.server_now});
 world.settlements[0].faction='persian';army.faction='persian';army.raid_target_id=1;world.battles.push(created.battle);world.formations.push(...created.formations);validateSave(structuredClone(world));
 await page.addInitScript(world=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(world));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${world.players[0].id}:${world.players[0].created_at}`,'yes');},world);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await expect(page.locator('.battle-3d-canvas')).not.toHaveAttribute('data-unit-models','loading',{timeout:45000});
 const envoys=page.getByRole('button',{name:'Inspect Shah’s Envoy',exact:true});await envoys.first().click();await page.getByRole('button',{name:'Inspect selected troops',exact:true}).click();
 await page.screenshot({path:info.outputPath('diplomats-in-automatic-battle.png')});await page.getByRole('button',{name:'2D',exact:true}).click();await expect(page.locator('.unit-card.selected [data-diplomat-faction="persian"]')).toBeVisible();await page.screenshot({path:info.outputPath('canvas-diplomat-identity.png')});expect(errors).toEqual([]);
});

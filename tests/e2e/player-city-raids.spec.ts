import {test,expect} from '@playwright/test';
// @ts-expect-error Isolated PostgreSQL-backed HTTP harness is plain Node JS.
import {accountServer} from '../helpers/account-server.mjs';

test('compact city raid sends an exact party, cancels safely and shows siege damage in the owned report',async({page,context},info)=>{
 test.setTimeout(150000);const server=await accountServer(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await context.addInitScript(()=>{
   localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
   const original=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type:string,...args:unknown[]){if(['webgl','webgl2','experimental-webgl'].includes(type))return null;return Reflect.apply(original,this,[type,...args]);}as typeof original;
  });
  await context.route('**/*.supabase.co/**',async route=>{
   const request=route.request(),reply=await server.request(request.url(),request.method(),request.headers(),request.postDataJSON()??{});
   await route.fulfill({status:reply.status,headers:reply.headers,body:reply.data==null?'':JSON.stringify(reply.data)});
  });
  await page.goto('/');await page.getByRole('button',{name:'Shared world',exact:true}).click();await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByLabel('Name your ruler').fill('Raid Sender');await page.locator('.account-create .account-primary').click();await expect(page.getByLabel('Game menu')).toBeVisible();
  const owner=server.logins[0].player_id,rival=await server.seed('Raid Defender','orc'),fixture=await server.cityRaidFixture(owner,rival.player_id);
  await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();await page.getByRole('button',{name:'Find a field',exact:true}).click();
  await page.getByLabel(/Field X coordinate/).fill(String(Math.floor(fixture.city.x/128)));await page.getByLabel(/Field Y coordinate/).fill(String(Math.floor(fixture.city.y/128)));await page.getByRole('button',{name:'Go',exact:true}).click();
  await page.getByText('Terrain & travel details',{exact:true}).click();
  await page.getByRole('button',{name:new RegExp(fixture.city.name+'.*Rival settlement')}).click();
  await page.getByRole('button',{name:'Raid city',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Prepare city raid',exact:true});await expect(dialog).toBeVisible();await expect(dialog.locator('.march-troop-grid input')).toHaveCount(9);
  const box=(await dialog.boundingBox())!,send=dialog.getByRole('button',{name:'Confirm raid',exact:true});
  expect(box.width).toBeLessThanOrEqual(510);const sendBox=(await send.boundingBox())!;expect(sendBox.y+sendBox.height).toBeLessThanOrEqual(box.y+box.height);
  await page.screenshot({path:info.outputPath('compact-city-raid-all-troops.png')});
  await dialog.getByRole('button',{name:'Clear troops',exact:true}).click();
  const troop=(unit:string)=>dialog.locator(`.march-troop-grid [data-unit="${unit}"] input`);
  await troop('infantry').fill('101');await expect(send).toBeDisabled();await troop('infantry').fill('40');
  await troop('ram').fill('20');await troop('catapult').fill('20');await dialog.getByLabel('Catapult target',{exact:true}).selectOption('smithy');
  await page.screenshot({path:info.outputPath('compact-city-raid-selected.png')});await send.click();
  await expect.poll(async()=>(await server.raidArmy(fixture.armyId)).raid_city_id).toBe(fixture.city.id);
  const army=await server.raidArmy(fixture.armyId);expect(army.unit_roster.infantry).toBe(40);expect(army.unit_roster.ram).toBe(20);expect(army.unit_roster.catapult).toBe(20);expect(army.unit_roster.scout).toBe(0);
  const cancel=page.getByRole('complementary',{name:'Cancellable march'}).getByRole('button',{name:/Cancel march/});await cancel.click();await expect.poll(async()=>(await server.raidArmy(fixture.armyId)).raid_city_id).toBeNull();
  await page.getByRole('button',{name:'Raid city',exact:true}).click();dialog=page.getByRole('dialog',{name:'Prepare city raid',exact:true});await dialog.getByRole('button',{name:'Clear troops',exact:true}).click();
  await troop('infantry').fill('40');await troop('ram').fill('20');await troop('catapult').fill('20');await dialog.getByLabel('Catapult target').selectOption('smithy');await dialog.getByRole('button',{name:'Confirm raid',exact:true}).click();
  await expect.poll(async()=>(await server.raidArmy(fixture.armyId)).raid_city_id).toBe(fixture.city.id);await server.resolveCityRaid(fixture.armyId);await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();
  await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:'Reports, 1 unread',exact:true}).click();await page.locator('.report-row').first().click();
  const damage=page.getByRole('region',{name:'Siege damage',exact:true});await expect(damage).toContainText('Walls');await expect(damage).toContainText('Smithy');await expect(page.getByRole('region',{name:'Report details'})).toContainText('Returning loot');await page.screenshot({path:info.outputPath('city-raid-siege-report.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 }finally{await server.close();}
});

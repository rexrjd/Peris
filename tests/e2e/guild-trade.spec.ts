import {test,expect} from '@playwright/test';
// @ts-expect-error PostgreSQL-backed HTTP adapter is plain Node JS.
import {accountServer} from '../helpers/account-server.mjs';

test('guild member actions send a caravan and create, manage and recover automatic support routes',async({page,context},info)=>{
 test.setTimeout(180000);const server=await accountServer(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let loseRouteAcknowledgement=true;
 try{
  await context.addInitScript(()=>localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true})));
  await context.route('**/*.supabase.co/**',async route=>{const req=route.request(),body=req.postDataJSON()??{},res=await server.request(req.url(),req.method(),req.headers(),body);if(loseRouteAcknowledgement&&body.p_function==='peris_trade_route_command'&&body.p_args?.p_command?.type==='saveTradeRoute'){loseRouteAcknowledgement=false;await route.abort('connectionfailed');return;}await route.fulfill({status:res.status,headers:res.headers,body:res.data==null?'':JSON.stringify(res.data)});});
  await page.goto('/');await page.getByRole('button',{name:'Shared world',exact:true}).click();await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByLabel('Name your ruler').fill('Caravan Sender');await page.locator('.account-create .account-primary').click();await expect(page.getByLabel('Game menu')).toBeVisible();
  const owner=server.logins[0].player_id,ally=await server.seed('Caravan Ally','persian');await server.guildSupportFixture(owner,ally.player_id);
  await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();
  const openGuild=async()=>{await page.getByRole('navigation',{name:'Community navigation'}).getByRole('button',{name:/^Guilds/}).click();await page.getByRole('dialog',{name:'Guilds',exact:true}).getByRole('button',{name:'Members',exact:true}).click();};await openGuild();
  const guild=page.getByRole('dialog',{name:'Guilds',exact:true});await expect(guild.getByRole('button',{name:'Send caravan to Caravan Sender',exact:true})).toHaveCount(0);
  await guild.getByRole('button',{name:'Send caravan to Caravan Ally',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Send caravan',exact:true});await expect(dialog).toContainText('No completed Markets');await page.keyboard.press('Escape');
  await server.marketFixture(owner);await guild.getByRole('button',{name:'Close',exact:true}).click();await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();await openGuild();await page.screenshot({path:info.outputPath('guild-trade-actions.png')});
  await guild.getByRole('button',{name:'Send caravan to Caravan Ally',exact:true}).click();dialog=page.getByRole('dialog',{name:'Send caravan',exact:true});
  await expect(dialog.getByLabel('Trade destination city')).toContainText('Dawnwatch');await expect(dialog.getByLabel('Trade destination city').locator('option')).toHaveCount(1);
  await dialog.getByLabel('Wood to send').fill('100');await dialog.getByRole('button',{name:'Review shipment',exact:true}).click();await dialog.getByRole('button',{name:'Confirm shipment',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Caravan dispatched');expect(await server.caravans(owner)).toHaveLength(1);
  await page.keyboard.press('Escape');await guild.getByRole('button',{name:'Create automatic route to Caravan Ally',exact:true}).click();dialog=page.getByRole('dialog',{name:'Create automatic route',exact:true});
  await dialog.getByLabel('Food to send').fill('150');await dialog.getByLabel('First delivery delay (game minutes)').fill('10');await dialog.getByLabel('Repeat every (game minutes)').fill('30');await dialog.getByLabel('Deliveries per run').selectOption('3');
  await page.screenshot({path:info.outputPath('guild-route-editor.png')});const bounds=(await dialog.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await dialog.getByRole('button',{name:'Review automatic route',exact:true}).click();await dialog.getByRole('button',{name:'Save automatic route',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Retry order',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Retry order',exact:true}).click();
  const card=dialog.getByRole('article',{name:'Automatic route to Dawnwatch'});await expect(card).toBeVisible();await expect(dialog.getByRole('button',{name:'Save automatic route',exact:true})).toHaveCount(0);expect(await server.tradeRoutes(owner)).toHaveLength(1);
  await card.getByRole('button',{name:'Pause',exact:true}).click();await expect(card.getByRole('button',{name:'Resume',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('guild-route-manager.png')});
  await card.getByRole('button',{name:'Delete',exact:true}).click();await card.getByRole('button',{name:'Confirm delete',exact:true}).click();await expect(card).toHaveCount(0);expect(await server.tradeRoutes(owner)).toHaveLength(0);expect(errors).toEqual([]);
 }finally{await server.close();}
});

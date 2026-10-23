import {test,expect} from '@playwright/test';
// @ts-expect-error Isolated PostgreSQL-backed adapter is plain Node JS.
import {accountServer} from '../helpers/account-server.mjs';

test('stale sources require explicit selection and a lost send response retries once before appearing in live City Events',async({page,context},info)=>{
 test.setTimeout(150000);const server=await accountServer();let loseReply=false;
 try{
  await context.addInitScript(()=>localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true})));
  await context.route('**/*.supabase.co/**',async route=>{const req=route.request(),body=req.postDataJSON()??{},res=await server.request(req.url(),req.method(),req.headers(),body);
   if(loseReply&&body.p_function==='peris_send_guild_reinforcements'&&res.status===200){loseReply=false;await route.abort('failed');return;}
   await route.fulfill({status:res.status,headers:res.headers,body:res.data==null?'':JSON.stringify(res.data)});
  });
  await page.goto('/');await page.getByRole('button',{name:'Shared world',exact:true}).click();await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByLabel('Name your ruler').fill('Retry Sender');await page.locator('.account-create .account-primary').click();await expect(page.getByLabel('Game menu')).toBeVisible();
  const owner=server.logins[0].player_id,ally=await server.seed('Retry Ally','persian');await server.guildSupportFixture(owner,ally.player_id);await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();
  await page.getByRole('navigation',{name:'Community navigation'}).getByRole('button',{name:/^Guilds/}).click();
  const guild=page.getByRole('dialog',{name:'Guilds',exact:true});await guild.getByRole('button',{name:'Members',exact:true}).click();await guild.getByRole('button',{name:'Send reinforcements to Retry Ally',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Send reinforcements',exact:true}),source=dialog.getByLabel('Reinforcement troop source'),send=dialog.getByRole('button',{name:'Send reinforcements',exact:true});
  await expect(dialog).toContainText('Dawnwatch');await dialog.getByLabel('infantry reinforcements',{exact:true}).fill('5');
  const armyKey=await source.locator('option').evaluateAll(nodes=>(nodes.find(n=>(n as HTMLOptionElement).value.startsWith('army:'))as HTMLOptionElement).value);
  await server.clearSupportGarrison(owner);await expect(source).toHaveValue('',{timeout:20000});await expect(send).toBeDisabled();expect(await server.guildSupport()).toHaveLength(0);
  await source.selectOption(armyKey);await expect(dialog.getByLabel('infantry reinforcements',{exact:true})).toHaveValue('0');await dialog.getByLabel('infantry reinforcements',{exact:true}).fill('2');
  loseReply=true;await send.click();await expect(dialog.getByRole('button',{name:'Retry order',exact:true})).toBeEnabled();await expect(dialog).toContainText('Order status is unconfirmed');
  await page.screenshot({path:info.outputPath('guild-retry-order.png')});
  await dialog.getByRole('button',{name:'Retry order',exact:true}).click();await expect(dialog).not.toBeVisible();expect(await server.guildSupport()).toHaveLength(1);
  await guild.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'City',exact:true}).click();await page.getByRole('button',{name:'3D',exact:true}).click();
  await expect(page.getByRole('region',{name:'3D city workspace',exact:true})).toBeVisible();
  const open=page.getByRole('button',{name:'Open city activity',exact:true});if(await open.isVisible())await open.click();
  const events=page.getByRole('complementary',{name:'City events and activity'});await expect(events.getByRole('button',{name:/^Reinforcement details:/})).toContainText('2 reinforcements');
  await page.screenshot({path:info.outputPath('guild-live-city-events.png')});
 }finally{await server.close();}
});

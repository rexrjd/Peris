import {test,expect} from '@playwright/test';
// @ts-expect-error PostgreSQL-backed HTTP adapter is plain Node JS.
import {accountServer} from '../helpers/account-server.mjs';

test('member reinforcement picker dispatches exact source troops and tracks support and recall in Events',async({page,context},info)=>{
 test.setTimeout(150000);const server=await accountServer(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await context.addInitScript(()=>localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true})));
  await context.route('**/*.supabase.co/**',async route=>{const req=route.request(),res=await server.request(req.url(),req.method(),req.headers(),req.postDataJSON()??{});await route.fulfill({status:res.status,headers:res.headers,body:res.data==null?'':JSON.stringify(res.data)});});
  await page.goto('/');await page.getByRole('button',{name:'Shared world',exact:true}).click();await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByLabel('Name your ruler').fill('Support Sender');await page.locator('.account-create .account-primary').click();await expect(page.getByLabel('Game menu')).toBeVisible();
  const owner=server.logins[0].player_id,ally=await server.seed('Support Ally','persian');await server.guildSupportFixture(owner,ally.player_id);
  await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();
  await page.getByRole('navigation',{name:'Community navigation'}).getByRole('button',{name:/^Guilds/}).click();
  const guild=page.getByRole('dialog',{name:'Guilds',exact:true});await guild.getByRole('button',{name:'Members',exact:true}).click();
  await expect(guild.getByRole('button',{name:'Send reinforcements to Support Sender',exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('guild-member-actions.png')});
  const open=()=>guild.getByRole('button',{name:'Send reinforcements to Support Ally',exact:true}).click();await open();
  const dialog=page.getByRole('dialog',{name:'Send reinforcements',exact:true}),send=dialog.getByRole('button',{name:'Send reinforcements',exact:true});
  await expect(dialog).toContainText('Dawnwatch');await expect(send).toBeDisabled();
  await dialog.getByLabel('infantry reinforcements',{exact:true}).fill('451');await expect(send).toBeDisabled();
  await dialog.getByLabel('infantry reinforcements',{exact:true}).fill('40');await dialog.getByLabel('archers reinforcements',{exact:true}).fill('10');await expect(dialog).toContainText('Arrives in');
  const source=dialog.getByLabel('Reinforcement troop source'),options=await source.locator('option').evaluateAll(nodes=>nodes.map(n=>({value:(n as HTMLOptionElement).value,label:n.textContent})));
  const army=options.find(o=>o.value.startsWith('army:'))!;expect(army).toBeTruthy();
  await source.selectOption(army.value);await expect(dialog.getByLabel('infantry reinforcements',{exact:true})).toHaveValue('0');
  await source.selectOption(options.find(o=>o.value.startsWith('garrison:'))!.value);
  await dialog.getByLabel('infantry reinforcements',{exact:true}).fill('40');await dialog.getByLabel('archers reinforcements',{exact:true}).fill('10');
  await page.screenshot({path:info.outputPath('guild-reinforcement-picker.png')});
  const bounds=(await dialog.boundingBox())!;expect(bounds.width).toBeLessThanOrEqual(482);expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(guild).toBeVisible();await open();
  await dialog.getByLabel('infantry reinforcements',{exact:true}).fill('40');await dialog.getByLabel('archers reinforcements',{exact:true}).fill('10');await send.click();await expect(dialog).not.toBeVisible();
  const support=await server.guildSupport();expect(support).toHaveLength(1);expect(support[0].troops.infantry).toBe(40);expect(support[0].troops.archers).toBe(10);
  await guild.getByRole('button',{name:'Close',exact:true}).click();
  const toggle=page.getByRole('button',{name:'Open map activity',exact:true});if(await toggle.isVisible())await toggle.click();
  const events=page.getByRole('complementary',{name:'Map overview and activity'});const event=events.getByRole('button',{name:/^Reinforcement details:/});await expect(event).toContainText('Dawnwatch');await expect(event).toContainText('50 reinforcements');
  await event.click();const details=page.getByRole('dialog',{name:'Reinforcements',exact:true});await expect(details).toContainText('Guild support');await expect(details).toContainText('40');await details.getByRole('button',{name:'Close',exact:true}).click();
  await server.advanceGuildSupport();await expect(event).toContainText('Defending',{timeout:20000});await event.click();await details.getByRole('button',{name:'Recall troops',exact:true}).click();await expect(details).toContainText('Returning home');
  await page.screenshot({path:info.outputPath('guild-support-events.png')});
  await details.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('navigation',{name:'Community navigation'}).getByRole('button',{name:/^Guilds/}).click();await guild.getByRole('button',{name:'Members',exact:true}).click();await open();
  await dialog.getByLabel('Reinforcement troop source').selectOption(army.value);await dialog.getByLabel('infantry reinforcements',{exact:true}).fill('2');await send.click();await expect(dialog).not.toBeVisible();
  expect((await server.guildSupport()).length).toBe(2);expect(errors).toEqual([]);
 }finally{await server.close();}
});

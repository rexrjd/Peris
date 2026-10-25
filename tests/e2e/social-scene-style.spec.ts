import {test,expect,type BrowserContext,type Page,type TestInfo} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import type {Faction} from '../../src/features/factions/domain/factions';
// @ts-expect-error The isolated multiplayer database adapter is plain Node JS.
import {accountServer} from '../helpers/account-server.mjs';

const community=(page:Page)=>page.getByRole('navigation',{name:'Community navigation'});
const material=(page:Page,selector:string)=>page.locator(selector).evaluate(element=>({color:getComputedStyle(element).backgroundColor,image:getComputedStyle(element).backgroundImage}));
const capture=(page:Page,info:TestInfo,name:string)=>page.screenshot({path:`artifacts/world-social-polish/social-${name}-${info.project.name}.png`});
async function open(page:Page,name:'Guilds'|'Messages'){
  await community(page).getByRole('button',{name:new RegExp(`^${name}`)}).click();
  return page.getByRole('dialog',{name,exact:true});
}
async function localRealm(page:Page,faction:Faction){
  const world=createSolo('Social Council');world.settlements[0].faction=faction;
  await page.addInitScript(w=>{
    localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
    localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
    localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type:string,...args:unknown[]){if(['webgl','webgl2','experimental-webgl'].includes(type))return null;return Reflect.apply(original,this,[type,...args]);}as typeof original;
  },world);
  await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
}

test('Guilds and Messages share the selected faction material and compact headings for all eleven factions',async({page},info)=>{
  test.setTimeout(180000);
  for(const faction of ['roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'] as Faction[]){
    await localRealm(page,faction);
    const expected=await material(page,'.game-navigation');expect(expected.image).toContain(`${faction}-texture.webp`);
    for(const name of ['Guilds','Messages'] as const){
      const panel=await open(page,name);await expect(panel).toBeVisible();
      expect(await material(page,'.social-panel')).toEqual(expected);
      await expect(panel.locator('.social-heading h2')).toHaveCSS('font-size','19px');
      await expect(panel.locator('.social-heading h2')).toHaveCSS('font-family',/Cinzel/);
      expect((await panel.locator('.social-heading').boundingBox())!.height).toBeLessThanOrEqual(70);
      await expect(panel.getByRole('button',{name:'Close',exact:true})).toBeInViewport();
      if(['persian','elf','orc'].includes(faction))await capture(page,info,`${faction}-${name.toLowerCase()}`);
      await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);
    }
  }
});

test('populated social panels keep support pickers, forms and private message controls reachable at 320px',async({page,context},info)=>{
  test.setTimeout(180000);const server=await accountServer(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    const owner=await server.seed('Style Guildmaster','persian'),member=await server.seed('Style Ally','elf');
    await server.guildSupportFixture(owner.player_id,member.player_id);await server.marketFixture(owner.player_id);
    await connect(context,server);await login(page,'Style Guildmaster');
    const expected=await material(page,'.game-navigation');const guild=await open(page,'Guilds');
    await expect(guild.locator('.guild-banner')).toContainText('Dawn Covenant');
    expect(await material(page,'.social-panel')).toEqual(expected);await capture(page,info,'guild-overview');
    await guild.getByRole('button',{name:'Members',exact:true}).click();
    expect((await guild.locator('.guild-members>.social-search').boundingBox())!.height).toBeLessThanOrEqual(36);
    await page.setViewportSize({width:320,height:740});
    for(const [action,title] of [['Send reinforcements to Style Ally','Send reinforcements'],['Send caravan to Style Ally','Send caravan'],['Create automatic route to Style Ally','Create automatic route']] as const){
      await guild.getByRole('button',{name:action,exact:true}).click();
      const picker=page.getByRole('dialog',{name:title,exact:true});await expect(picker).toBeVisible();
      expect(await material(page,'.guild-reinforcement-dialog')).toEqual(expected);
      await expect(picker.locator('header h2')).toHaveCSS('font-family',/Cinzel/);
      await expect(picker.locator('header button')).toBeInViewport();
      if(title==='Send reinforcements'){
        await picker.getByLabel('infantry reinforcements',{exact:true}).fill('3');
        await picker.getByRole('button',{name:'Send reinforcements',exact:true}).scrollIntoViewIfNeeded();
        await expect(picker.getByRole('button',{name:'Send reinforcements',exact:true})).toBeEnabled();
      }else{
        await picker.getByLabel('Wood to send',{exact:true}).fill('25');
        await picker.getByRole('button',{name:title==='Send caravan'?'Review shipment':'Review automatic route',exact:true}).scrollIntoViewIfNeeded();
      }
      expect(await picker.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
      await capture(page,info,`${title.replaceAll(' ','-').toLowerCase()}-320`);
      await page.keyboard.press('Escape');await expect(picker).toHaveCount(0);
    }
    for(const tab of ['Diplomacy','Ranks','Settings']){
      const button=guild.getByRole('navigation',{name:'Guild sections'}).getByRole('button',{name:tab,exact:true});await button.click();await expect(button).toBeInViewport();
    }
    await guild.getByLabel('Guild member notice').fill('The northern roads are clear.');
    await guild.getByRole('button',{name:'Save guild',exact:true}).click();
    await guild.getByRole('button',{name:'Settings',exact:true}).click();await expect(guild.getByLabel('Guild member notice')).toHaveValue('The northern roads are clear.');
    await guild.getByRole('button',{name:'Save guild',exact:true}).scrollIntoViewIfNeeded();await capture(page,info,'guild-settings-320');
    await page.keyboard.press('Escape');
    const messages=await open(page,'Messages');await messages.getByRole('button',{name:'New message',exact:true}).first().click();
    await messages.getByRole('searchbox',{name:'Find players',exact:true}).fill('Style Ally');
    await messages.locator('.social-player-results').getByRole('button',{name:/Style Ally/}).click();
    await messages.getByLabel('Write a message',{exact:true}).fill('Scouts return at dusk.');await messages.getByRole('button',{name:'Send message',exact:true}).click();
    await expect(messages.getByRole('log',{name:'Message history'})).toContainText('Scouts return at dusk.');
    await messages.getByLabel('Write a reply').focus();await expect(messages.getByLabel('Write a reply')).toBeFocused();
    await expect(messages.getByRole('button',{name:'Send message',exact:true})).toBeInViewport();
    await capture(page,info,'messages-conversation-320');
    await messages.getByLabel('Conversation options').click();await messages.getByRole('button',{name:'Block player',exact:true}).click();
    await expect(messages.locator('.message-blocked-notice')).toContainText('You blocked this player.');await messages.getByRole('button',{name:'Unblock',exact:true}).click();
    await expect(messages.getByLabel('Write a reply')).toBeVisible();
    if(await messages.locator('.message-options').getAttribute('open')===null)await messages.getByLabel('Conversation options').click();
    await messages.getByRole('button',{name:'Archive conversation',exact:true}).click();
    await messages.getByRole('button',{name:'Archived conversations',exact:true}).click();
    await messages.locator('.message-thread').filter({hasText:'Style Ally'}).click();
    await expect(messages.getByRole('log')).toContainText('Scouts return at dusk.');
    await messages.getByLabel('Conversation options').click();await messages.getByRole('button',{name:'Restore conversation',exact:true}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  }finally{await server.close();}
});

async function connect(context:BrowserContext,server:Awaited<ReturnType<typeof accountServer>>){
  await context.addInitScript(()=>{
    localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
    const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type:string,...args:unknown[]){if(['webgl','webgl2','experimental-webgl'].includes(type))return null;return Reflect.apply(original,this,[type,...args]);}as typeof original;
  });
  await context.route('**/*.supabase.co/**',async route=>{const request=route.request(),response=await server.request(request.url(),request.method(),request.headers(),request.postDataJSON()??{});await route.fulfill({status:response.status,headers:response.headers,body:response.data==null?'':JSON.stringify(response.data)});});
}
async function login(page:Page,name:string){
  await page.goto('/');await page.getByRole('button',{name:'Shared world',exact:true}).click();await page.locator('.account-manual summary').click();await page.getByLabel('YOUR RULER NAME').fill(name);await page.getByRole('button',{name:'Enter the shared world',exact:true}).click();await expect(page.getByLabel('Game menu')).toBeVisible();
}

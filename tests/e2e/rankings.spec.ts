import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {ensureRankings} from '../../src/features/rankings/domain/rankings';
// @ts-expect-error The isolated SQL/Auth harness is plain Node JS.
import {accountServer} from '../helpers/account-server.mjs';

async function capture(page:Page,info:TestInfo,name:string){
  const path=info.outputPath(name+'.png');
  await page.screenshot({path});
  await info.attach(name,{path,contentType:'image/png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
async function login(page:Page,name:string){
  await page.goto('/');
  await page.getByRole('button',{name:'Shared world',exact:true}).click();
  await page.locator('.account-manual summary').click();
  await page.getByLabel('YOUR RULER NAME').fill(name);
  await page.getByRole('button',{name:'Enter the shared world',exact:true}).click();
  await expect(page.getByLabel('Game menu')).toBeVisible();
}
const nav=(page:Page)=>page.getByRole('navigation',{name:'Game navigation'});
const growth=(page:Page)=>page.getByRole('table',{name:/^Growth weekly Top 10/});

test('weekly shared-world tables use real scored outcomes and retain your rank outside the Top 10',async({page,context},info)=>{
  test.setTimeout(150000);
  const server=await accountServer(),errors:string[]=[],periods:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    const ruler=await server.seed('Rankings Scribe','persian');
    await server.rankingsFixture(ruler.player_id);
    await context.addInitScript(()=>{
      localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
      const original=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type:string,...args:unknown[]){if(['webgl','webgl2','experimental-webgl'].includes(type))return null;return Reflect.apply(original,this,[type,...args]);}as typeof original;
    });
    await context.route('**/*.supabase.co/**',async route=>{
      const request=route.request(),body=request.postDataJSON()??{};
      if(request.url().includes('/rpc/peris_rankings'))periods.push(body.p_period);
      const response=await server.request(request.url(),request.method(),request.headers(),body);
      await route.fulfill({status:response.status,headers:response.headers,body:response.data==null?'':JSON.stringify(response.data)});
    });
    await login(page,'Rankings Scribe');
    await nav(page).getByRole('button',{name:'Rankings',exact:true}).click();
    await expect(nav(page).getByRole('button',{name:'Rankings',exact:true})).toHaveAttribute('aria-current','page');
    await expect(page.getByRole('heading',{name:'Rankings',exact:true})).toBeVisible();
    for(const category of ['Attack','Defense','Robbers','Camps','Growth']){
      await expect(page.getByRole('table',{name:new RegExp('^'+category+' weekly Top 10')})).toBeAttached();
    }
    await expect(growth(page).locator('tbody').first().getByRole('row')).toHaveCount(10);
    await expect(growth(page).locator('tbody.ranking-personal')).toContainText('Rankings Scribe');
    await expect(growth(page).locator('tbody.ranking-personal td').first()).toHaveText('13');
    await expect(page.locator('.ranking-camps .is-you')).toContainText('Rankings Scribe');
    await expect(page.locator('.ranking-robbers .is-you')).toContainText('Rankings Scribe');
    await expect(page.getByText(/Weeks reset Monday 00:00 UTC/)).toBeVisible();
    await capture(page,info,'rankings-shared-current');
    const categories=page.getByRole('tablist',{name:'Ranking category'});
    await categories.getByRole('tab',{name:'Growth',exact:true}).click();
    await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Growth');
    await expect(page.getByRole('table')).toHaveCount(1);
    await expect(growth(page).locator('tbody.ranking-personal td').first()).toHaveText('13');
    await growth(page).scrollIntoViewIfNeeded();
    await capture(page,info,'rankings-shared-growth');
    await page.getByRole('button',{name:'Last week',exact:true}).click();
    await expect(categories.getByRole('tab',{name:'Growth',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(growth(page).locator('tbody.ranking-personal')).toContainText('Rankings Scribe');
    await categories.getByRole('tab',{name:'Growth',exact:true}).focus();
    await page.keyboard.press('ArrowRight');
    await expect(categories.getByRole('tab',{name:'Top 10',exact:true})).toBeFocused();
    await expect(page.getByRole('table')).toHaveCount(5);
    await page.keyboard.press('End');
    await expect(categories.getByRole('tab',{name:'Growth',exact:true})).toBeFocused();
    await page.keyboard.press('Home');
    await expect(categories.getByRole('tab',{name:'Top 10',exact:true})).toBeFocused();
    await page.keyboard.press('Tab');
    const currentWeek=page.getByRole('button',{name:'This week',exact:true});
    await expect(currentWeek).toBeFocused();
    expect(await currentWeek.evaluate(element=>{
      const style=getComputedStyle(element),parent=element.parentElement!,clip=getComputedStyle(parent);
      const width=parseFloat(style.outlineWidth),outward=Math.max(0,width+parseFloat(style.outlineOffset));
      if(style.outlineStyle==='none'||width===0)return false;
      const buttonBounds=element.getBoundingClientRect(),clipBounds=parent.getBoundingClientRect();
      return !['hidden','clip'].includes(clip.overflowX)||buttonBounds.left-outward>=clipBounds.left&&buttonBounds.right+outward<=clipBounds.right&&buttonBounds.top-outward>=clipBounds.top&&buttonBounds.bottom+outward<=clipBounds.bottom;
    })).toBe(true);
    await page.getByRole('button',{name:'Last week',exact:true}).click();
    await expect(page.getByRole('button',{name:'Last week',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.ranking-camps')).toContainText('No ranked activity this week.');
    await expect(growth(page).locator('.ranking-personal')).toContainText('Rankings Scribe');
    await capture(page,info,'rankings-shared-previous');
    await page.getByText('Scoring & weekly reset',{exact:false}).click();
    await expect(page.getByText(/Weeks begin Monday 00:00 UTC/)).toBeVisible();
    await expect(page.getByText(/Tracking since/)).toBeVisible();
    await page.getByText('Scoring & weekly reset',{exact:false}).click();
    await page.getByRole('button',{name:'This week',exact:true}).focus();
    await page.keyboard.press('Enter');
    await expect(growth(page).locator('tbody.ranking-personal td').first()).toHaveText('13');
    await nav(page).getByRole('button',{name:/^Reports/}).click();
    await expect(page.getByRole('dialog',{name:/Reports/})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading',{name:'Rankings',exact:true})).toBeVisible();
    expect(periods).toContain('current');expect(periods).toContain('previous');
    expect(errors).toEqual([]);
  }finally{await context.unroute('**/*.supabase.co/**');await server.close();}
});

test('compact rankings fit a 320px screen with long player names and large scores',async({page},info)=>{
  await page.setViewportSize({width:320,height:740});
  const world=createSolo('AlexandertheGreatestRuler');
  // Keep this visual fixture's signed total stable while the real engine runs.
  world.settlements[0].population=world.settlements[0].population_capacity;
  ensureRankings(world,Date.now());
  world.rankings!.weeks[0].totals=[{player_id:'solo-ruler',attack:999999999999,defense:0,robbers:123456789012,camps:0,growth:-1234}];
  await page.addInitScript(w=>{
    localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
    localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
    localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
  },world);
  await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
  await nav(page).getByRole('button',{name:'Rankings',exact:true}).click();
  const tabs=page.getByRole('tablist',{name:'Ranking category'});
  for(const tab of await tabs.getByRole('tab').all())await expect(tab).toBeInViewport();
  await tabs.getByRole('tab',{name:'Attack',exact:true}).click();
  const attack=page.getByRole('table',{name:/^Attack weekly Top 10/});
  await expect(attack).toContainText('AlexandertheGreatestRuler');
  await expect(attack.locator('.ranking-score')).toHaveText('999,999,999,999');
  const contrast=await page.locator('.rankings-heading h1').evaluate(element=>{
    const rgb=(color:string)=>color.match(/[\d.]+/g)!.slice(0,3).map(Number);
    const luminance=(color:string)=>rgb(color).map(value=>{const channel=value/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;}).reduce((sum,channel,index)=>sum+channel*[.2126,.7152,.0722][index],0);
    const text=luminance(getComputedStyle(element).color),paper=luminance(getComputedStyle(element.closest('.rankings-page')!).backgroundColor);
    return (Math.max(text,paper)+.05)/(Math.min(text,paper)+.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  expect(await page.locator('.rankings-page').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await capture(page,info,'rankings-320-long-name');
  await tabs.getByRole('tab',{name:'Growth',exact:true}).click();
  await expect(growth(page).locator('.ranking-score')).toHaveText('-1,234');
  await expect(page.locator('.ranking-growth footer')).toContainText('Unranked');
});

test('ranking reads recover from network failure and explain an older world without the RPC',async({page,context},info)=>{
  test.setTimeout(120000);
  const server=await accountServer();let state:'offline'|'ready'|'older'='offline';
  try{
    await server.seed('Rankings Retry','elf');
    await context.addInitScript(()=>localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true})));
    await context.route('**/*.supabase.co/**',async route=>{
      const request=route.request();
      if(request.url().includes('/rpc/peris_rankings')&&state!=='ready'){
        await route.fulfill({status:state==='offline'?503:404,contentType:'application/json',body:JSON.stringify(state==='offline'?{code:'PGRST000',message:'Connection interrupted. Try again.'}:{code:'PGRST202',message:'Missing rankings RPC'})});return;
      }
      const response=await server.request(request.url(),request.method(),request.headers(),request.postDataJSON()??{});
      await route.fulfill({status:response.status,headers:response.headers,body:response.data==null?'':JSON.stringify(response.data)});
    });
    await login(page,'Rankings Retry');
    await nav(page).getByRole('button',{name:'Rankings',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('Standings could not be refreshed');
    await capture(page,info,'rankings-connection-retry');
    state='ready';await page.getByRole('button',{name:'Retry',exact:true}).click();
    await expect(growth(page)).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
    await nav(page).getByRole('button',{name:'Map',exact:true}).click();
    state='older';await nav(page).getByRole('button',{name:'Rankings',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('Rankings are not available in this world yet');
    await expect(nav(page).getByRole('button',{name:'Map',exact:true})).toBeEnabled();
    await capture(page,info,'rankings-older-world');
  }finally{await context.unroute('**/*.supabase.co/**');await server.close();}
});

test('solo Rankings opens from the top navigation and preserves campaign scope after reload',async({page},info)=>{
  const world=createSolo('Solo Standings'),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(w=>{
    if(!localStorage.getItem('peris-campaign-v6'))localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
    localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
    localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
  },world);
  await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
  await nav(page).getByRole('button',{name:'Rankings',exact:true}).click();
  await expect(growth(page)).toBeVisible();
  await expect(page.getByText(/Solo campaign standings/)).toBeVisible();
  await expect(growth(page)).toContainText('Solo Standings');
  await expect(page.locator('.ranking-growth footer')).toContainText('Unranked');
  await capture(page,info,'rankings-solo');
  await page.reload();await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
  await nav(page).getByRole('button',{name:'Rankings',exact:true}).click();
  await expect(growth(page)).toContainText('Solo Standings');
  expect(errors).toEqual([]);
});

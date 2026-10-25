import {test,expect,type Page} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {beginRaid} from '../../src/features/campaign/domain/raids';
import {finishBattle} from '../../src/features/battle/domain/resolution';
import {settleBattle} from '../../src/features/campaign/domain/battleSettlement';
import type {ScoutingResult} from '../../src/features/scouting/domain/types';

const nav=(page:Page)=>page.getByRole('navigation',{name:'Game navigation'});
const material=(page:Page,selector:string)=>page.locator(selector).evaluate(element=>({color:getComputedStyle(element).backgroundColor,image:getComputedStyle(element).backgroundImage}));
async function enter(page:Page,faction:'roman'|'persian'|'elf'){
  const world=createSolo('Report Council');world.settlements[0].faction=faction;let id=99000;
  beginRaid(world,'solo-ruler',world.camps.find(camp=>camp.bandit)!.id,()=>++id);
  const battle=world.battles.at(-1)!,formations=world.formations.filter(row=>row.battle_id===battle.id);
  formations.filter(row=>row.side==='defender').forEach(row=>{row.soldiers=0;row.status='routed';});
  finishBattle(battle,formations,'attacker','Army routed');settleBattle(world,battle.id,'solo-ruler',()=>++id);
  const source=world.reports[0];
  world.reports=Array.from({length:8},(_,index)=>({...source,id:++id,battle_id:++id,title:`Saved raid ${index+1}`,created_at:new Date(Date.parse(world.server_now)-index*60000).toISOString(),read_at:null,...(index===1?{won:false,result:{...source.result,attacker_losses:3,attacker_survivors:source.result.attacker_initial-3,delivered:{wood:0,stone:0,food:0,gold:0},replacement_cost:{wood:33,stone:25,food:27,gold:13}}}:{})}));
  const scouting:ScoutingResult={mission_id:1,mode:'resources',target:{kind:'city',id:900,name:'Azure Gate',owner_id:'former-ruler',faction:'persian',x:400,y:400},observed_at:world.server_now,scouts_sent:12,scouts_lost:2,scouts_survived:10,detected:true,success:true,troops:{infantry:47,archers:18,cavalry:9,scout:3},resources:{wood:4321,stone:3210,food:2109,gold:1098}};
  world.reports.push({...source,id:++id,battle_id:++id,camp_id:undefined,title:'Scouting: Azure Gate',created_at:new Date(Date.parse(world.server_now)-600000).toISOString(),result:{...source.result,report_side:'attacker',scouting}});
  world.battles=[];world.formations=[];
  await page.addInitScript(w=>{
    localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
    localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
    localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
  },world);
  await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
}

for(const faction of ['roman','persian','elf'] as const)test(`${faction} Reports matches scene materials over every management screen`,async({page},info)=>{
  test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await enter(page,faction);await nav(page).getByRole('button',{name:'Map',exact:true}).click();
  const expected=await material(page,'.game-navigation');expect(expected.image).toContain(`${faction}-texture.webp`);
  for(const screen of ['Map','City','Rally Point','Armies','Research','Rankings']){
    await nav(page).getByRole('button',{name:screen,exact:true}).click();
    await nav(page).getByRole('button',{name:/^Reports/}).click();
    const popup=page.getByRole('dialog',{name:'Reports',exact:true});await expect(popup).toBeVisible();
    expect(await material(page,'.reports-popup')).toEqual(expected);
    expect(await material(page,'.report-inbox-detail')).toEqual(expected);
    const rows=await popup.locator('.report-row').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().height));
    expect(Math.max(...rows)).toBeLessThanOrEqual(68);
    const controls=popup.locator('.report-inbox-toolbar .report-control');
    for(const control of await controls.all())await expect(control).toBeInViewport();
    await popup.getByLabel('Report outcome',{exact:true}).selectOption('victory');
    await popup.getByLabel('Report outcome',{exact:true}).selectOption('defeat');
    await expect(popup.locator('.report-outcome-control')).toHaveCSS('color','rgb(255, 171, 165)');
    await expect(popup.locator('.report-row')).toHaveCount(1);
    await popup.getByLabel('Report outcome',{exact:true}).selectOption('all');
    await expect(popup.locator('.report-row')).toHaveCount(9);
    if(screen==='Map'||screen==='Rally Point')await page.screenshot({path:info.outputPath(`${faction}-reports-${screen.replaceAll(' ','-')}.png`)});
    if(screen==='Map'){
      await expect(popup.locator('.report-row-net b.has-losses')).toHaveCSS('color','rgb(255, 171, 165)');
      await popup.locator('.report-row').nth(1).click();
      await expect(popup.locator('.report-detail-kicker')).toContainText('Defeat');
      await expect(popup.locator('.signed-resources .negative').first()).toHaveCSS('color','rgb(255, 171, 165)');
      await page.screenshot({path:info.outputPath(`${faction}-report-losses.png`)});
      await popup.getByRole('button',{name:'Back to reports',exact:true}).click();
    }
    await popup.locator('.report-row').first().click();await expect(popup.getByRole('region',{name:'Report details',exact:true})).toContainText('Victory');
    if(screen==='Map')await page.screenshot({path:info.outputPath(`${faction}-report-detail.png`)});
    await page.keyboard.press('Escape');await expect(popup).toHaveCount(0);
    await expect(nav(page).getByRole('button',{name:/^Reports/})).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('Reports keeps every compact control, scouting receipt and milestones reachable at 320px',async({page},info)=>{
  await page.setViewportSize({width:320,height:740});await enter(page,'persian');
  await nav(page).getByRole('button',{name:'Rally Point',exact:true}).click();
  await nav(page).getByRole('button',{name:/^Reports/}).click();
  const popup=page.getByRole('dialog',{name:'Reports',exact:true});await expect(popup).toBeVisible();
  for(const control of await popup.locator('.report-inbox-toolbar .report-control').all())await expect(control).toBeInViewport();
  await popup.getByRole('button',{name:'Search',exact:true}).click();await popup.getByLabel('Search reports',{exact:true}).fill('Azure');
  await expect(popup.locator('.report-inbox-searchbar>label')).toHaveCSS('outline-width','2px');
  await expect(popup.locator('.report-inbox-searchbar>label')).toHaveCSS('border-top-color','rgb(240, 211, 140)');
  await expect(popup.locator('.report-row')).toHaveCount(1);await page.screenshot({path:info.outputPath('reports-search-320.png')});
  await popup.locator('.report-row').first().click();
  const detail=popup.getByRole('region',{name:'Report details',exact:true});await expect(detail).toContainText('Azure Gate');
  await expect(detail.getByRole('region',{name:'Observed resources'})).toContainText('4,321');
  expect(await detail.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('reports-scouting-320.png')});
  await popup.getByRole('button',{name:'Back to reports',exact:true}).click();
  await popup.getByRole('tab',{name:'Milestones',exact:true}).click();
  await expect(popup.getByRole('heading',{name:'Rewards for your realm'})).toBeVisible();
  await expect(popup.getByRole('button',{name:'Close',exact:true})).toBeInViewport();
  const heights=await popup.locator('.milestone-grid article:not(.claimable)').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().height));
  expect(Math.max(...heights)).toBeLessThanOrEqual(120);
  expect(await popup.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('reports-milestones-320.png')});
});

import {test,expect,type Page} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {ensureScience} from '../../src/features/research/domain/science';

const nav=(page:Page)=>page.getByRole('navigation',{name:'Game navigation'});
const material=(page:Page,selector:string)=>page.locator(selector).evaluate(element=>({color:getComputedStyle(element).backgroundColor,image:getComputedStyle(element).backgroundImage}));
async function enter(page:Page,faction:'roman'|'persian'|'elf'='roman',otherCity=false){
  const world=createSolo('Council QA');
  world.settlements[0].faction=faction;
  world.city_slots=[{settlement_id:world.settlements[0].id,slot_index:0,building_type:'barracks',level:1}];
  if(otherCity){
    world.settlements.push({...world.settlements[0],id:2,name:'Roman Outpost',faction:'roman',x:world.settlements[0].x+512});
    world.buildings.push(...world.buildings.map(building=>({...building,id:building.id+100,settlement_id:2})));
  }
  ensureScience(world,'solo-ruler',Date.parse(world.server_now));world.account_science![0].points=2000;
  await page.addInitScript(w=>{
    localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
    localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
    localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
    sessionStorage.setItem(`peris-city-view:${w.players[0].id}`,'3d');
  },world);
  await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
}

for(const faction of ['roman','persian','elf'] as const)test(`${faction} management screens share Map materials and compact controls`,async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await enter(page,faction);
  await nav(page).getByRole('button',{name:'Map',exact:true}).click();
  const expected=await material(page,'.game-navigation');
  expect(expected.image).toContain(`${faction}-texture.webp`);
  for(const [name,surface,heading] of [['Armies','.army-management-workspace','.armies-toolbar'],['Rally Point','.rp-army-details','.rally-heading'],['Research','.tech-board-panel','.technology-heading']] as const){
    await nav(page).getByRole('button',{name,exact:true}).click();
    await expect(page.locator(surface)).toBeVisible();
    expect(await material(page,'.game-navigation')).toEqual(expected);
    expect(await material(page,surface)).toEqual(expected);
    expect((await page.locator(heading).boundingBox())!.height).toBeLessThanOrEqual(70);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`${faction}-${name.replaceAll(' ','-')}.png`)});
  }
  await page.getByRole('button',{name:'Begin research',exact:true}).click();
  await expect(page.getByRole('progressbar',{name:'Research progress',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Pause research',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Resume research',exact:true})).toBeEnabled();
  expect(errors).toEqual([]);
});

test('management screens fit 320px and keep army tabs, portal stats and Rally sections reachable',async({page},info)=>{
  await page.setViewportSize({width:320,height:740});await enter(page,'persian');
  await nav(page).getByRole('button',{name:'Armies',exact:true}).click();
  await page.locator('.army-troop-inspect').first().click();
  const stats=page.getByRole('dialog',{name:/ stats$/});await expect(stats).toBeVisible();
  expect((await material(page,'.army-troop-modal')).image).toContain('persian-texture.webp');
  await expect(stats.getByRole('button',{name:'Close',exact:true})).toBeInViewport();
  await page.screenshot({path:info.outputPath('army-stats-320.png')});await page.keyboard.press('Escape');
  for(const tab of ['Commander','Equipment','Logistics','Army']){
    await page.getByRole('navigation',{name:'Army management'}).getByRole('button',{name:tab,exact:true}).click();
    await expect(page.getByRole('region',{name:`${tab.toLowerCase()} management`})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await nav(page).getByRole('button',{name:'Rally Point',exact:true}).click();
  for(const section of ['Movements','Farm lists','Reports','Overview']){
    const tab=page.getByRole('tab',{name:new RegExp(`^${section}`)});await tab.click();
    await expect(tab).toHaveAttribute('aria-selected','true');await expect(tab).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  const cards=page.locator('.rp-unit-card');
  for(const card of await cards.all())expect(await card.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('rally-320.png')});
  await nav(page).getByRole('button',{name:'Research',exact:true}).click();
  await page.getByLabel('Technology branch').selectOption('knowledge');
  await expect(page.locator('.tech-card')).toHaveCount(10);await page.getByRole('button',{name:'Zoom out',exact:true}).click();
  await page.getByRole('button',{name:'Reset zoom',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('research-320.png')});
});

test('recruitment and nested bonus tooltips retain faction materials and execute real commands',async({page},info)=>{
  await enter(page,'elf',true);await nav(page).getByRole('button',{name:'Armies',exact:true}).click();
  const expected=await material(page,'.game-navigation');
  await page.getByRole('button',{name:'Raise army',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Raise a new army',exact:true})).toBeVisible();
  expect(await material(page,'.raise-army-modal')).toEqual(expected);
  await page.getByLabel('City for new army').selectOption('2');
  expect((await material(page,'.raise-army-modal')).image).toContain('roman-texture.webp');
  await page.getByLabel('City for new army').selectOption('1');
  expect(await material(page,'.raise-army-modal')).toEqual(expected);
  await page.screenshot({path:info.outputPath('elf-raise-army.png')});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Recruitment',exact:true}).click();
  const recruit=page.getByRole('dialog',{name:'Recruit troops',exact:true});await expect(recruit).toBeVisible();
  expect(await material(page,'.army-recruit-modal')).toEqual(expected);
  await recruit.getByLabel('Soldiers to train',{exact:true}).fill('2');
  await recruit.getByRole('button',{name:/^Train 2 /}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!).orders.some((order:{kind:string;quantity:number})=>order.kind==='recruit'&&order.quantity===2))).toBe(true);
  await page.screenshot({path:info.outputPath('elf-recruitment.png')});await page.keyboard.press('Escape');
  await page.locator('.army-troop-inspect').first().click();
  const stats=page.getByRole('dialog',{name:/ stats$/});await expect(stats).toBeVisible();
  await stats.getByRole('button',{name:'Explain Attack bonuses and penalties',exact:true}).click();
  await expect(page.getByRole('tooltip')).toContainText('Attack bonus breakdown');
  expect(await material(page,'.troop-stat-tooltip')).toEqual(expected);
  await page.screenshot({path:info.outputPath('elf-troop-tooltip.png')});
  await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0);await expect(stats).toBeVisible();
  await page.keyboard.press('Escape');await expect(stats).toHaveCount(0);
  await nav(page).getByRole('button',{name:'Rally Point',exact:true}).click();
  const rallyCard=page.locator('.rp-unit-card').first();await rallyCard.scrollIntoViewIfNeeded();
  await rallyCard.screenshot({path:info.outputPath('elf-rally-stat-card.png')});
  await rallyCard.getByRole('button',{name:'Explain Attack bonuses and penalties',exact:true}).click();
  const tooltip=page.getByRole('tooltip');await expect(tooltip).toBeVisible();
  expect(await material(page,'.troop-stat-tooltip')).toEqual(expected);
  await expect(tooltip).toHaveAttribute('data-theme','dark');
  await expect(tooltip.locator('[data-change=positive]').first()).toHaveCSS('color','rgb(166, 214, 154)');
  await page.screenshot({path:info.outputPath('elf-rally-tooltip.png')});
});

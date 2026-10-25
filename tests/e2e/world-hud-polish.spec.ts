import {test,expect,type Page} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';

async function enter(page:Page){
  const world=createSolo('HUD Council'),town=world.settlements[0];
  town.name='Willowford';town.loyalty=100;town.loyalty_updated_at=world.server_now;
  world.settlements.push({...town,id:2,name:'Azure Gate',faction:'persian',x:town.x+512,loyalty:42});
  world.buildings.push(...world.buildings.map(building=>({...building,id:building.id+100,settlement_id:2})));
  await page.addInitScript(w=>{
    localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
    localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
    localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
    sessionStorage.setItem(`peris-city-view:${w.players[0].id}`,'3d');
  },world);
  await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
}

test('map rotation sits above the minimap and still rotates the actual scene',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await enter(page);
  await expect(page.locator('.scene-compatibility')).toHaveCount(0);
  const rotation=page.getByRole('group',{name:'Map rotation',exact:true}),minimap=page.locator('.scene-minimap');
  await expect(rotation).toBeVisible();
  const check=async()=>{
    const r=(await rotation.boundingBox())!,m=(await minimap.boundingBox())!;
    expect(r.y+r.height).toBeLessThanOrEqual(m.y);expect(r.x).toBeGreaterThanOrEqual(m.x-1);expect(r.x+r.width).toBeLessThanOrEqual(m.x+m.width+1);
    await expect(rotation).toBeInViewport();await expect(minimap).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  };
  await check();
  const marker=page.locator('.scene-label.scene-hero-marker.mine').first();await expect(marker).toBeVisible();
  const point=()=>marker.evaluate(element=>`${(element as HTMLElement).style.left}:${(element as HTMLElement).style.top}`);
  const before=await point();await rotation.getByRole('button',{name:'Rotate camera left',exact:true}).click();
  await expect.poll(point).not.toBe(before);
  await page.screenshot({path:info.outputPath('rotation-above-minimap.png')});
  await rotation.getByRole('button',{name:'Rotate camera right',exact:true}).click();
  await page.locator('.scene-minimap canvas').click({position:{x:30,y:30}});
  await page.getByRole('button',{name:'Focus your settlement',exact:true}).click();
  await page.setViewportSize({width:320,height:740});await check();
  await rotation.getByRole('button',{name:'Rotate camera left',exact:true}).click();
  await page.screenshot({path:info.outputPath('rotation-above-minimap-320.png')});expect(errors).toEqual([]);
  await page.setViewportSize({width:740,height:360});await check();
  await page.screenshot({path:info.outputPath('rotation-above-minimap-landscape.png')});
});

test('owned loyalty is inside the city preview near Land and follows selected city on Map and live City',async({page},info)=>{
  await enter(page);
  const nav=page.getByRole('navigation',{name:'Game navigation'}),card=page.locator('.city-selector-card:not(.city-garrison-card)');
  const loyalty=card.getByRole('region',{name:'City loyalty',exact:true});await expect(loyalty).toBeVisible();
  await expect(page.getByRole('region',{name:'City loyalty',exact:true})).toHaveCount(1);
  await expect(card.locator('.city-selector-land')).toContainText('Loyalty');await expect(loyalty).toContainText('100 / 100');
  expect((await loyalty.boundingBox())!.height).toBeLessThanOrEqual(24);
  await loyalty.focus();await expect(loyalty.getByRole('tooltip')).toBeVisible();await expect(loyalty.getByRole('tooltip')).toContainText('+25 / game hour');
  await page.getByRole('button',{name:'Current city: Willowford',exact:true}).click();
  await page.getByRole('menuitemradio',{name:/^Azure Gate,/}).click();
  await expect(loyalty).toBeVisible();expect(parseFloat((await loyalty.locator('strong').textContent())!)).toBeGreaterThanOrEqual(42);
  expect(parseFloat((await loyalty.locator('strong').textContent())!)).toBeLessThan(100);
  await nav.getByRole('button',{name:'City',exact:true}).click();await expect(page.locator('.city-3d-scene.ready')).toBeVisible();
  await expect(card).toContainText('Azure Gate');await expect(loyalty).toBeVisible();
  await page.screenshot({path:info.outputPath('city-preview-loyalty.png')});
  await nav.getByRole('button',{name:'Map',exact:true}).click();await page.setViewportSize({width:320,height:740});
  await expect(card).toContainText('Population');await expect(card).toContainText('Army');await expect(card).toContainText('Land');
  await loyalty.focus();const tooltip=loyalty.getByRole('tooltip');await expect(tooltip).toBeInViewport();
  expect(await card.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('city-preview-loyalty-320.png')});
});

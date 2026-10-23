import {test,expect} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {findMarchPath} from '../../src/features/map/domain/pathfinding';
import {homeArmyPosition} from '../../src/features/map/domain/garrisons';

test('Market reviews exact mixed cargo, holds return capacity and supports city Events',async({page},info)=>{
 test.setTimeout(120000);
 const w=createSolo('Market review'),s=w.settlements[0];s.name='Origin city';s.wood=s.stone=s.food=s.gold=3000;
 let t={...s,id:2,name:'Destination city',x:s.x+128};for(const [dx,dy]of [[128,0],[-128,0],[0,128],[0,-128]]){t={...t,x:s.x+dx,y:s.y+dy};if(findMarchPath(homeArmyPosition(s),homeArmyPosition(t)))break;}
 w.settlements.push(t);w.buildings.push(...w.buildings.map(b=>({...b,id:b.id+100,settlement_id:2})));
 w.city_slots=[{settlement_id:s.id,slot_index:0,building_type:'bazaar',level:2}];
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(world=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(world));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${world.players[0].id}:${world.players[0].created_at}`,'yes');sessionStorage.setItem(`peris-city-view:${world.players[0].id}`,'3d');},w);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('button',{name:'City',exact:true}).click();
 await expect(page.locator('.city-3d-scene.ready canvas')).toBeVisible();
 await page.locator('[data-building="slot:0"]').focus();await page.keyboard.press('Enter');
 const panel=page.locator('.building-inspector');await expect(panel.getByRole('heading',{name:'Market',exact:true})).toBeVisible();
 await expect(panel.getByRole('tab',{name:'Trade',exact:true})).toHaveAttribute('aria-selected','true');
 await panel.getByLabel('Wood to send').fill('200');await panel.getByLabel('Food to send').fill('50');
 await panel.getByRole('button',{name:'Review shipment',exact:true}).click();
 await expect(panel.getByRole('heading',{name:'Review shipment',exact:true})).toBeVisible();await expect(panel.getByText('250 resource units', {exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('market-review.png')});
 await panel.getByRole('button',{name:'Edit cargo',exact:true}).click();await expect(panel.getByLabel('Wood to send')).toHaveValue('200');
 await panel.getByRole('button',{name:'Review shipment',exact:true}).click();await panel.getByRole('button',{name:'Confirm shipment',exact:true}).click();
 await expect(panel.getByRole('status')).toContainText('Caravan dispatched');await expect(panel.getByText('250 occupied', {exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('market-outbound.png')});
 await expect(panel.getByText('Merchants returning',{exact:true})).toBeVisible();await expect(panel.getByText('250 occupied',{exact:true})).toBeVisible();
 await expect(panel.getByText('0 occupied',{exact:true})).toBeVisible({timeout:30000});
 await page.keyboard.press('Escape');expect(errors).toEqual([]);
});

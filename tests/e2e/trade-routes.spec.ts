import {test,expect} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {findMarchPath} from '../../src/features/map/domain/pathfinding';
import {homeArmyPosition} from '../../src/features/map/domain/garrisons';

test('Market creates, edits, pauses, resumes and deletes a recurring mixed-cargo route',async({page},info)=>{
 test.setTimeout(120000);
 const world=createSolo('Route keeper'),source=world.settlements[0];source.wood=source.stone=source.food=source.gold=3000;
 const target={...source,id:2,name:'Saffron Gate'};
 for(const [dx,dy]of [[128,0],[-128,0],[0,128],[0,-128]]){target.x=source.x+dx;target.y=source.y+dy;if(findMarchPath(homeArmyPosition(source),homeArmyPosition(target)))break;}
 world.settlements.push(target);world.buildings.push(...world.buildings.map(b=>({...b,id:b.id+100,settlement_id:2})));
 world.city_slots=[{settlement_id:source.id,slot_index:0,building_type:'bazaar',level:2}];
 await page.addInitScript(w=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');sessionStorage.setItem(`peris-city-view:${w.players[0].id}`,'3d');},world);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('button',{name:'City',exact:true}).click();
 await expect(page.locator('.city-3d-scene.ready canvas')).toBeVisible();await page.locator('[data-building="slot:0"]').focus();await page.keyboard.press('Enter');
 const panel=page.locator('.building-inspector');await panel.getByRole('button',{name:'Automatic route',exact:true}).click();
 await panel.getByLabel('Wood to send').fill('100');await panel.getByLabel('Food to send').fill('50');
 await panel.getByLabel('First delivery timing').selectOption('arrival');await panel.getByLabel('First delivery delay (game minutes)').fill('60');
 await panel.getByLabel('Repeat every (game minutes)').fill('120');await panel.getByLabel('Deliveries per run').selectOption('2');
 await panel.getByRole('button',{name:'Review automatic route',exact:true}).click();await expect(panel).toContainText('150 resource units');await expect(panel).toContainText('2 deliveries per run');
 await page.screenshot({path:info.outputPath('trade-route-review.png')});await panel.getByRole('button',{name:'Save automatic route',exact:true}).click();
 const card=panel.getByRole('article',{name:'Automatic route to Saffron Gate'});await expect(card).toContainText('Scheduled');await expect(card).toContainText('120 game minutes');
 await card.getByRole('button',{name:'Pause',exact:true}).click();await expect(card).toContainText('Paused by you');await card.getByRole('button',{name:'Resume',exact:true}).click();
 await expect(card).toContainText('Caravan dispatched');await card.getByRole('button',{name:'Edit',exact:true}).click();await expect(panel.getByLabel('Wood to send')).toHaveValue('100');
 await panel.getByLabel('Wood to send').fill('120');await panel.getByLabel('First delivery delay (game minutes)').fill('10');await panel.getByRole('button',{name:'Review automatic route',exact:true}).click();await panel.getByRole('button',{name:'Save automatic route',exact:true}).click();
 await expect(card).toContainText('120 wood');await page.screenshot({path:info.outputPath('trade-route-manager.png')});
 await card.getByRole('button',{name:'Delete',exact:true}).click();await card.getByRole('button',{name:'Confirm delete',exact:true}).click();await expect(card).toHaveCount(0);
 await expect(panel).toContainText('No automatic routes');
});

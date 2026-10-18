import {test,expect} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {beginRaid} from '../../src/features/campaign/domain/raids';
import {finishBattle} from '../../src/features/battle/domain/resolution';
import {settleBattle} from '../../src/features/campaign/domain/battleSettlement';

test('reports popup preserves every background view and dismisses by keyboard, outside click and close',async({page},info)=>{
 const world=createSolo('Popup QA');let id=93000;
 beginRaid(world,'solo-ruler',world.camps.find(camp=>camp.bandit)!.id,()=>++id);
 const battle=world.battles.at(-1)!,formations=world.formations.filter(row=>row.battle_id===battle.id);
 formations.filter(row=>row.side==='defender').forEach(row=>{row.soldiers=0;row.status='routed'});
 finishBattle(battle,formations,'attacker','Army routed');settleBattle(world,battle.id,'solo-ruler',()=>++id);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(w=>{
  if(!localStorage.getItem('peris-campaign-v6'))localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
  localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
  localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
 },world);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
 const nav=page.getByRole('navigation',{name:'Game navigation'});
 for(const [index,name] of ['Map','City','Rally Point','Armies'].entries()){
  await nav.getByRole('button',{name,exact:true}).click();
  const background=page.locator('.realm-content > *').first();
  await background.evaluate((element,index)=>{(element as HTMLElement).dataset.popupMarker=String(index)},index);
  const trigger=nav.getByRole('button',{name:/^Reports/});await trigger.click();
  const popup=page.getByRole('dialog',{name:'Reports',exact:true});await expect(popup).toBeVisible();
  await expect(page.locator('.reports-popup-backdrop')).toHaveCSS('backdrop-filter','none');
  await expect(trigger).toHaveAttribute('aria-expanded','true');
  await expect(nav.getByRole('button',{name,exact:true})).toHaveAttribute('aria-current','page');
  await expect(background).toHaveAttribute('data-popup-marker',String(index));
  const box=(await popup.boundingBox())!;expect(box.width).toBeLessThanOrEqual(560);expect(box.height).toBeLessThanOrEqual(540);
  await expect(popup.locator('.report-inbox-list')).toBeVisible();
  await expect(popup.locator('.report-inbox-detail')).not.toBeVisible();
  if(index===2)await page.screenshot({path:info.outputPath('reports-popup-rally.png')});
  if(index===0){
   await page.screenshot({path:info.outputPath('reports-popup-map.png')});
   await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  }else if(index===1){
   await popup.locator('.report-row').first().click();
   await expect(popup.getByRole('region',{name:'Report details'})).toContainText('Victory');
   await expect(popup.locator('.report-inbox-list')).not.toBeVisible();
   await page.screenshot({path:info.outputPath('reports-popup-city-detail.png')});
   await popup.getByRole('button',{name:'Back to reports',exact:true}).click();
   await page.locator('.reports-popup-backdrop').click({position:{x:3,y:3}});
  }else await popup.getByRole('button',{name:'Close',exact:true}).click();
  await expect(popup).toHaveCount(0);
  await expect(background).toHaveAttribute('data-popup-marker',String(index));
  await expect(nav.getByRole('button',{name,exact:true})).toHaveAttribute('aria-current','page');
 }
 expect(errors).toEqual([]);
});

import {test,expect} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {emptyRoster,writeRoster} from '../../src/features/army/domain/roster';

test('compact raid keeps troop selection, travel and send usable with nine roles',async({page},info)=>{
 const world=createSolo('Compact raid'),army=world.armies[0];
 writeRoster(army,{...emptyRoster(),infantry:100,spearmen:80,archers:90,elite:60,cavalry:20,scout:10,heavyCavalry:25,ram:30,catapult:40});
 const camp=world.camps.filter(row=>row.bandit).sort((a,b)=>Math.hypot(a.x-army.start_x,a.y-army.start_y)-Math.hypot(b.x-army.start_x,b.y-army.start_y))[0];
 await page.addInitScript(w=>{
  localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
 },world);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('button',{name:'Find a field',exact:true}).click();
 await page.getByLabel(/Field X coordinate/).fill(String(Math.floor(camp.x/128)));await page.getByLabel(/Field Y coordinate/).fill(String(Math.floor(camp.y/128)));await page.getByRole('button',{name:'Go',exact:true}).click();await page.getByText('Terrain & travel details',{exact:true}).click();await page.getByRole('button',{name:new RegExp(camp.name+'.*Bandit camp')}).click();await page.getByRole('button',{name:'March and engage',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Prepare camp raid',exact:true}),send=dialog.getByRole('button',{name:'Confirm raid',exact:true});
 await expect(dialog.locator('.march-troop-grid input')).toHaveCount(9);await expect(dialog.locator('.march-review')).toContainText('455');
 const bounds=(await dialog.boundingBox())!,stats=(await dialog.locator('.march-review').boundingBox())!,action=(await send.boundingBox())!;
 expect(bounds.width).toBeLessThanOrEqual(510);expect(stats.y+stats.height).toBeLessThanOrEqual(bounds.y+bounds.height);expect(action.y+action.height).toBeLessThanOrEqual(bounds.y+bounds.height);
 await page.screenshot({path:info.outputPath('compact-raid-final.png')});
 await dialog.getByRole('button',{name:'Clear troops',exact:true}).click();await expect(send).toBeDisabled();await dialog.getByRole('button',{name:'Use all legion troops',exact:true}).click();await expect(send).toBeEnabled();
 await dialog.locator('.march-troop-grid [data-unit="catapult"] input').fill('0');await expect(dialog.locator('.march-review')).toContainText('415');
 await dialog.getByRole('button',{name:'Back',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

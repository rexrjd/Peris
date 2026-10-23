import {test,expect} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {emptyRoster,writeRoster} from '../../src/features/army/domain/roster';
import {refreshTroopUpkeep} from '../../src/features/city/domain/troopSupply';

test('city report and troop inspection explain hourly upkeep and starvation losses',async({page},info)=>{
 const w=createSolo('Crop keeper'),s=w.settlements[0];
 s.population=s.population_capacity=40;s.food=30;s.starvation_losses=17;s.starvation_last_at=w.server_now;
 writeRoster(w.armies[0],{...emptyRoster(),infantry:1000});refreshTroopUpkeep(w,Date.parse(w.server_now));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(world=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(world));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${world.players[0].id}:${world.players[0].created_at}`,'yes');sessionStorage.setItem(`peris-city-view:${world.players[0].id}`,'3d');},w);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('button',{name:'City',exact:true}).click();
 await expect(page.locator('.city-3d-scene.ready canvas')).toBeVisible();
 await page.getByRole('button',{name:/Food declining. Open city economy report|Open city economy report/}).click();
 const report=page.getByRole('dialog',{name:/city report/});
 await expect(report.getByLabel('Crop supply status')).toContainText('17 soldiers lost to starvation');
 await expect(report.getByLabel('Crop supply status')).toContainText('Crop reserves last');
 await report.getByRole('button',{name:'Production',exact:true}).click();
 await expect(report).toContainText('Troop upkeep');await expect(report).toContainText('1,000 crop / game hour');
 await page.screenshot({path:info.outputPath('crop-balance.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Armies',exact:true}).click();
 await expect(page.getByLabel('Army crop upkeep')).toContainText('1,000 / game hour');
 await page.locator('.army-troop-inspect[data-unit="catapult"]').click();
 const dossier=page.getByRole('dialog',{name:/stats/});await expect(dossier).toContainText('Crop upkeep');await expect(dossier).toContainText('4 / hour');
 await page.screenshot({path:info.outputPath('catapult-upkeep.png')});expect(errors).toEqual([]);
});

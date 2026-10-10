import {test,expect}from'@playwright/test';
import {createSolo}from'../../src/features/campaign/domain/newRealm';
test('world camp inspection and army face markers work together',async({page},info)=>{
 test.setTimeout(120000);const world=createSolo('Hero QA'),camp=world.camps.filter(c=>c.bandit).sort((a,b)=>Math.hypot(a.x-155,a.y-285)-Math.hypot(b.x-155,b.y-285))[0];
 await page.addInitScript(w=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},world);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
 const marker=page.locator('.scene-hero-marker.mine').first();await expect(marker).toBeVisible();await expect(marker.locator('img')).toHaveAttribute('src',/art\/heroes\/portraits\/roman\/\d{2}\.webp/);await marker.click();await expect(page.locator('.atlas-inspector')).toContainText('YOUR LEGION');
 await page.getByRole('button',{name:/Layers/}).click();await page.getByRole('button',{name:'Find a field',exact:true}).click();await page.getByLabel(/Field X coordinate/).fill(String(Math.floor(camp.x/128)));await page.getByLabel(/Field Y coordinate/).fill(String(Math.floor(camp.y/128)));await page.getByRole('button',{name:'Go',exact:true}).click();
 await page.getByText('Terrain & travel details',{exact:true}).click();await page.getByRole('button',{name:new RegExp(camp.name+'.*Bandit camp')}).click();
 await expect(page.locator('.atlas-inspector')).toContainText('BANDIT CAMP');await expect(page.locator('.atlas-inspector')).toContainText('2 XP');await expect(page.getByRole('button',{name:'Read the campaign briefing'})).toHaveCount(0);await page.getByRole('button',{name:'Toggle starting campaign',exact:true}).click();await expect(page.locator('.campaign-trail>button')).toHaveCount(6);await page.screenshot({path:info.outputPath('bandit-inspector.png')});
});

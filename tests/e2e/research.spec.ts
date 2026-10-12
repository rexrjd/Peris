import {test,expect,type Page} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {ensureScience} from '../../src/features/research/domain/science';
import {refreshCityEconomy} from '../../src/features/city/domain/slots';
async function enter(page:Page,academy=false){
 const w=createSolo('Research UI'),now=Date.parse(w.server_now);ensureScience(w,'solo-ruler',now);w.account_science![0].points=2000;
 if(academy){w.city_slots!.push({settlement_id:w.settlements[0].id,slot_index:4,building_type:'academy',level:1});refreshCityEconomy(w,w.settlements[0].id);}
 await page.addInitScript(w=>{if(!localStorage.getItem('peris-campaign-v6'))localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},w);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();return w;
}
test('research tree artwork, switching, pause/resume, discovery and save reload',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);
 await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:'Research',exact:true}).click();await expect(page.locator('.tech-card')).toHaveCount(110);await expect(page.getByRole('complementary',{name:'Selected technology'})).toContainText('Writing');
 await expect.poll(()=>page.locator('.tech-detail-art img').evaluate((i:HTMLImageElement)=>i.complete&&i.naturalWidth===192)).toBe(true);
 await page.screenshot({path:info.outputPath('technology-tree.png'),fullPage:true});
 await page.getByRole('button',{name:'Begin research',exact:true}).click();await expect(page.getByRole('progressbar',{name:'Research progress',exact:true})).toBeVisible();await expect(page.locator('.nav-research-progress')).toBeVisible();
 await page.getByRole('button',{name:'Pause research',exact:true}).first().click();await expect(page.getByRole('button',{name:'Resume research',exact:true})).toBeVisible();await page.getByRole('button',{name:'Resume research',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search technologies'}).fill('Drill Grounds');await page.locator('[data-technology="drill-grounds"]').click();await page.getByRole('button',{name:'Switch research',exact:true}).click();await expect(page.locator('.research-active-strip')).toContainText('Drill Grounds');
 await page.locator('.research-debug summary').click();await page.getByRole('button',{name:'Complete current',exact:true}).click();await expect(page.locator('[data-technology="drill-grounds"]')).toHaveClass(/is-complete/);
 await page.getByRole('searchbox',{name:'Search technologies'}).fill('');await page.locator('[data-technology="spear-formations"]').click();await expect(page.getByRole('button',{name:'Begin research',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Begin research',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:'Research',exact:true}).click();await expect(page.locator('[data-technology="spear-formations"]')).toHaveClass(/is-active|is-complete/);await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!).research_progress.some((r:any)=>r.technology_id==='spear-formations'))).toBe(true);
 await page.getByLabel('Technology branch').selectOption('knowledge');await expect(page.locator('.tech-card')).toHaveCount(10);await page.getByRole('button',{name:'Zoom out',exact:true}).click();await page.getByRole('button',{name:'Reset zoom',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('Academy art, science sources, five-level upgrade and repeatable build',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page,true);const nav=page.getByRole('navigation',{name:'Game navigation'});
 await nav.getByRole('button',{name:'Research',exact:true}).click();await page.locator('.science-wallet').click();await expect(page.getByRole('region',{name:'Science production'})).toContainText('Academy');await page.getByRole('button',{name:'Build an Academy',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Academy',exact:true});await expect(dialog).toBeVisible();await expect(dialog).toContainText('12');await expect(dialog).toContainText('28');await expect(dialog.locator('.city-building-artwork')).toBeVisible();await page.screenshot({path:info.outputPath('academy.png')});await dialog.getByRole('button',{name:'Open technology tree',exact:true}).click();await expect(page.locator('.technology-page')).toBeVisible();
 await nav.getByRole('button',{name:'City',exact:true}).click();await page.getByRole('button',{name:'Build',exact:true}).click();const picker=page.getByRole('dialog',{name:'Selected building',exact:true});await picker.getByRole('radio',{name:/Academy/}).check();await expect(picker.getByRole('button',{name:'Build Academy',exact:true})).toBeEnabled();await picker.getByRole('button',{name:'Build Academy',exact:true}).click();await expect(page.getByLabel('Construction queue').first()).toBeVisible();await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!).city_slots.filter((s:any)=>s.building_type==='academy').length)).toBe(2);expect(errors).toEqual([]);
});

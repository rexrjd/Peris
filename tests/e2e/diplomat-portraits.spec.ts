import {test,expect,type Locator,type Page,type TestInfo} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import type {Faction} from '../../src/features/factions/domain/factions';
import {writeRoster} from '../../src/features/army/domain/roster';
import {validateSave} from '../../src/platform/storage/saves';

const cases:[Faction,string][]=[['roman','Senator'],['spartan','Ephor'],['persian','Shah’s Envoy'],['egyptian','Vizier'],['orc','Oathspeaker'],['elf','Grove Emissary'],['dwarf','Clan Lawkeeper'],['gnome','Charter Minister'],['pandaren','Jade Mandarin'],['undead','Sepulchral Legate'],['demon','Infernal Chancellor']];
const nav=(page:Page)=>page.getByRole('navigation',{name:'Game navigation'});

async function enter(page:Page,faction:Faction){
 const world=createSolo('Portrait Court'),city=world.settlements[0],army=world.armies[0];
 city.faction=faction;army.faction=faction;world.conquest_version=1;
 writeRoster(army,{infantry:96,archers:24,cavalry:8,diplomat:7});
 validateSave(structuredClone(world));
 await page.addInitScript(w=>{
  localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
  localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
  localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
 },world);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
 await nav(page).getByRole('button',{name:'Armies',exact:true}).click();
}

async function paintedPortrait(host:Locator,faction:Faction,name:string){
 const image=host.locator(`img[data-diplomat-faction="${faction}"]`);
 await expect(image).toBeVisible();await expect(image).toHaveAttribute('src',`/art/battle/diplomats-v2/${faction}.webp`);
 await expect(image).toHaveAttribute('alt','');await expect(image).toHaveAttribute('aria-hidden','true');
 await expect(host.getByRole('img',{name,exact:true})).toHaveCount(1);
 await expect.poll(()=>image.evaluate(el=>{const img=el as HTMLImageElement;return [img.complete,img.naturalWidth,img.naturalHeight];})).toEqual([true,512,512]);
 const fit=await image.evaluate(el=>{
  const image=el.getBoundingClientRect(),parent=el.parentElement!;
  return {fit:getComputedStyle(el).objectFit,width:image.width,height:image.height,parentWidth:parent.clientWidth,parentHeight:parent.clientHeight};
 });
 expect(fit.fit).toBe('contain');expect(Math.abs(fit.width-fit.parentWidth)).toBeLessThanOrEqual(1);expect(Math.abs(fit.height-fit.parentHeight)).toBeLessThanOrEqual(1);
 await expect(host.locator('svg[data-diplomat-faction]')).toHaveCount(0);
 return image;
}

async function capture(target:Page|Locator,info:TestInfo,faction:Faction,part:string){
 const directory=resolve('artifacts/diplomat-portraits');mkdirSync(directory,{recursive:true});
 await target.screenshot({path:resolve(directory,`ui-${info.project.name}-${faction}-${part}.png`),scale:'css'});
}

for(const [faction,name] of cases)test(`${faction} painted diplomat loads in Army, stats and Rally beside existing units`,async({page,isMobile},info)=>{
 test.setTimeout(120000);if(isMobile)await page.setViewportSize({width:320,height:740});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await enter(page,faction);
 const card=page.locator('.army-troop-inspect[data-unit="diplomat"]');await card.scrollIntoViewIfNeeded();
 await paintedPortrait(card,faction,name);
 const infantry=page.locator('.army-troop-inspect[data-unit="infantry"]');
 await expect(infantry.locator('.fw-troop-icon')).toHaveCSS('background-image',new RegExp(`roster/${faction}\\.png`));
 await capture(page.locator('.army-troop-grid'),info,faction,'army-roster');
 await infantry.click();
 let stats=page.getByRole('dialog',{name:/ stats$/});await expect(stats).toBeVisible();
 await capture(stats.locator('.troop-dossier-heading'),info,faction,'reference-heading');
 await capture(stats.locator('.troop-dossier-heading > .fw-troop-icon'),info,faction,'reference-portrait');await page.keyboard.press('Escape');
 await card.click();stats=page.getByRole('dialog',{name:`${name} stats`,exact:true});
 await paintedPortrait(stats,faction,name);await expect(stats.getByRole('button',{name:'Close',exact:true})).toBeInViewport();
 await capture(stats.locator('.troop-dossier-heading'),info,faction,'diplomat-heading');
 await capture(stats.locator('.troop-dossier-heading > .fw-troop-icon'),info,faction,'diplomat-portrait');
 await capture(page,info,faction,'diplomat-stats');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');await expect(stats).toHaveCount(0);
 await nav(page).getByRole('button',{name:'Rally Point',exact:true}).click();
 const rally=page.getByRole('button',{name:`Inspect ${name}, 7 in this legion`,exact:true});await rally.scrollIntoViewIfNeeded();
 await paintedPortrait(rally,faction,name);await rally.click();await expect(rally).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.rp-unit-inspector')).toContainText(name);
 await capture(page.locator('.rp-unit-cards'),info,faction,'rally-roster');
 await capture(page,info,faction,'rally-selected');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

import { test, expect } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { ARTIFACTS } from '../../src/features/heroes/domain/artifacts';
import { EQUIPMENT_SLOTS } from '../../src/features/heroes/domain/heroes';

test('every artifact painting loads, rarity is visible, and legendary gear equips and persists', async ({page},info) => {
    const world=createSolo('Artifact gallery QA');
    world.hero_artifacts=Object.keys(ARTIFACTS).map((artifact_id,i)=>({id:50000+i,owner_id:'solo-ruler',artifact_id,hero_id:null}));
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(w=>{if(!localStorage.getItem('peris-campaign-v6'))localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},world);
    await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
    await page.getByRole('button',{name:'Armies',exact:true}).click();await page.getByRole('button',{name:/^Equipment/}).click();
    const seen=new Set<string>();
    for (let i=0;i<EQUIPMENT_SLOTS.length;i++) {
        await page.locator('.command-equipment-slots>button').nth(i).click();
        const paintings=page.locator('.command-artifact-grid .artifact-art img');
        await expect(paintings).toHaveCount(Object.values(ARTIFACTS).filter(a=>a.slot===EQUIPMENT_SLOTS[i]).length);
        for (const img of await paintings.all()) {
            await img.scrollIntoViewIfNeeded();
            await expect.poll(()=>img.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth===384)).toBe(true);
            seen.add((await img.getAttribute('src'))!);
        }
        await expect(page.locator('.command-artifact-grid')).toContainText('Tier 4 · Legendary');
    }
    expect(seen.size).toBe(24);
    await page.locator('.command-equipment-slots>button').first().click();
    await page.locator('.command-artifact-grid>button').filter({hasText:'Lionheart'}).click();
    await page.getByRole('button',{name:'Equip Lionheart',exact:true}).click();
    await expect(page.locator('.command-equipment-slots>button').first()).toContainText('Lionheart');
    await expect(page.locator('.command-artifact-detail img')).toHaveAttribute('src',ARTIFACTS.lionheart_blade.image);
    await page.locator('.command-artifact-detail').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('legendary-equipment.png')});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.reload();await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!));
    expect(saved.hero_artifacts.find((a:{artifact_id:string})=>a.artifact_id==='lionheart_blade').hero_id).toBe(world.heroes![0].id);
    expect(errors).toEqual([]);
});

test('highest camp difficulty advertises legendary loot in the map card and raid review', async ({page},info) => {
    const world=createSolo('Camp difficulty QA'),camp=world.camps.find(c=>c.bandit&&c.tier===10)!;
    await page.addInitScript(w=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},world);
    await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('button',{name:/^Find a field/}).click();
    await page.getByRole('spinbutton',{name:/^Field X coordinate/}).fill(String(Math.floor(camp.x/128)));
    await page.getByRole('spinbutton',{name:/^Field Y coordinate/}).fill(String(Math.floor(camp.y/128)));
    await page.getByRole('button',{name:'Go',exact:true}).click();
    const panel=page.locator('.map-operations');await panel.locator('.field-details>summary').click();
    await panel.locator('.atlas-cell-occupants>button').filter({hasText:camp.name}).click();
    await expect(panel).toContainText('Level 10 · Deadly · Legendary loot');
    await expect(panel.getByRole('button',{name:'March and engage',exact:true})).toBeInViewport();
    await page.screenshot({path:info.outputPath('legendary-camp.png')});
    await panel.getByRole('button',{name:'March and engage',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Prepare camp raid'})).toContainText('Level 10 · Deadly · Legendary artifact on victory');
});

import {test,expect} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {beginRaid} from '../../src/features/campaign/domain/raids';
import {finishBattle} from '../../src/features/battle/domain/resolution';
import {settleBattle} from '../../src/features/campaign/domain/battleSettlement';
import {ARTIFACTS} from '../../src/features/heroes/domain/heroes';
import {heroPortraitUrl} from '../../src/features/heroes/domain/portraits';

function receiptWorld(){
 const world=createSolo('Reward QA');world.settlements[0].faction='orc';world.armies.push({...world.armies[0],id:300,name:'River guard'});world.heroes!.push({...world.heroes![0],id:301,army_id:300,name:'Commander Asha',class:'mage',experience:90});
 const camp=world.camps.find(c=>c.bandit)!;let id=20000;beginRaid(world,'solo-ruler',camp.id,()=>++id,300);
 const battle=world.battles.at(-1)!;battle.elapsed=83;
 world.formations.filter(f=>f.battle_id===battle.id&&f.side==='defender').forEach(f=>{f.soldiers=0;f.status='routed';});
 finishBattle(battle,world.formations.filter(f=>f.battle_id===battle.id),'attacker','Army routed');settleBattle(world,battle.id,'solo-ruler',()=>++id);
 return {world,battle};
}

test('victory receipt shows actual rewards and opens the earned item for the correct commander',async({page},info)=>{
 const {world,battle}=receiptWorld(),reward=battle.result!.hero_reward!,item=reward.artifacts[0],meta=ARTIFACTS[item.artifact_id];
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(w=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},world);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
 await page.getByRole('button',{name:/^Reports/}).click();await page.locator('.report-list>button').first().click();
 const modal=page.getByRole('dialog',{name:'Battle result'});await expect(modal.getByRole('heading',{name:'Victory',exact:true})).toBeVisible();
 await expect(modal.locator('.result-xp-gain>b')).toHaveText('+'+reward.experience.toLocaleString('en-US'));
 await expect(modal.locator('.result-level-up')).toHaveText(`Level ${reward.level_before} → ${reward.level_after}`);
 await expect(modal.locator('.result-artifact')).toContainText(meta.name);await expect(modal.locator('.result-artifact')).toContainText(meta.description);
 await expect(modal.locator('img')).toHaveAttribute('src',heroPortraitUrl('orc','knight',reward.hero_id));
 await expect.poll(()=>modal.locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 const bounds=await modal.boundingBox(),size=page.viewportSize()!;expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(size.width+1);
 await modal.locator('summary').click();await expect(modal.locator('.result-units')).toBeVisible();await modal.locator('summary').click();
 await page.screenshot({path:info.outputPath('victory-rewards.png')});await modal.getByRole('button',{name:'Open equipment',exact:true}).click();
 await expect(page.getByRole('region',{name:'Equipment management'})).toBeVisible();await expect(page.locator('.command-backpack')).toContainText(meta.name);
 await expect(page.locator('.command-artifact-grid>button[aria-pressed=true]')).toContainText(meta.name);
 await page.getByRole('button',{name:'Equip '+meta.name,exact:true}).click();
 await expect(page.locator('.command-artifact-grid>button[aria-pressed=true]')).toContainText('Equipped');
 await page.getByRole('button',{name:/^Reports/}).click();await page.locator('.report-list>button').first().click();await page.keyboard.press('Escape');
 await expect(modal).toHaveCount(0);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!));expect(saved.hero_artifacts).toHaveLength(1);expect(saved.heroes.find((h:{id:number})=>h.id===reward.hero_id).experience).toBe(reward.experience_after);expect(saved.hero_artifacts[0].hero_id).toBe(reward.hero_id);expect(errors).toEqual([]);
});

test('finishing an NPC battle automatically opens a real XP and equipment receipt',async({page},info)=>{
 const world=createSolo('Automatic rewards'),camp=world.camps.find(c=>c.bandit)!;let id=30000;
 beginRaid(world,'solo-ruler',camp.id,()=>++id);const battle=world.battles.at(-1)!;
 world.formations.filter(f=>f.battle_id===battle.id&&f.side==='defender').forEach(f=>{f.soldiers=0;f.status='routed';});
 await page.addInitScript(w=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},world);
 await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'Battle result'});await expect(modal.getByRole('heading',{name:'Victory',exact:true})).toBeVisible();
 await expect(modal.locator('.result-artifact')).toHaveCount(1);await expect(modal.locator('.result-xp-gain>b')).toHaveText('+'+((camp.infantry+camp.archers+camp.cavalry)*2+50));
 await page.screenshot({path:info.outputPath('automatic-victory.png')});await modal.getByRole('button',{name:'Back to map',exact:true}).click();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!));expect(saved.hero_artifacts).toHaveLength(1);expect(saved.reports[0].result.hero_reward.artifacts[0].id).toBe(saved.hero_artifacts[0].id);
});

test('practice result uses the compact receipt without campaign XP or equipment',async({page},info)=>{
 await page.addInitScript(()=>localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true})));
 await page.goto('/');await page.getByRole('button',{name:/Quick battle/}).click();await page.getByRole('button',{name:'Watch the battle',exact:true}).click();
 await page.getByRole('button',{name:'2D',exact:true}).click();await page.getByRole('button',{name:'Concede battle',exact:true}).click();
 await page.getByRole('dialog',{name:'Concede the field?'}).getByRole('button',{name:'Concede battle',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'Battle result'});await expect(modal.getByRole('heading',{name:'Defeat',exact:true})).toBeVisible();await expect(modal).toContainText('Practice battle');await expect(modal.locator('.result-hero-reward')).toHaveCount(0);await expect(modal.locator('.result-artifact')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('practice-result.png')});await modal.getByRole('button',{name:'Return to main menu',exact:true}).click();await expect(page.getByRole('heading',{name:'PERIS',exact:true})).toBeVisible();
});

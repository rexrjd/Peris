import {test,expect} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
import {beginRaid} from '../../src/features/campaign/domain/raids';
import {finishBattle} from '../../src/features/battle/domain/resolution';
import {settleBattle} from '../../src/features/campaign/domain/battleSettlement';

test('report inbox searches, filters, opens rewards and reads all without exposing rivals',async({page},info)=>{
    const world=createSolo('Inbox QA'), owner=world.players[0].id, camps=world.camps.filter(camp=>camp.bandit).slice(0,2);let id=98000;
    beginRaid(world,owner,camps[0].id,()=>++id);
    const battle=world.battles.at(-1)!, formations=world.formations.filter(row=>row.battle_id===battle.id);
    formations.filter(row=>row.side==='defender').forEach(row=>{row.soldiers=0;row.status='routed'});
    finishBattle(battle,formations,'attacker','Army routed');settleBattle(world,battle.id,owner,()=>++id);
    const source=world.reports[0];
    world.reports=Array.from({length:12},(_,index)=>({
        ...source,id:++id,battle_id:++id,camp_id:camps[index%2].id,title:`Camp raid ${index+1}`,won:index%4!==2,
        read_at:index>7?world.server_now:null,created_at:new Date(Date.parse(world.server_now)-index*60000).toISOString(),
        result:{...source.result,attacker_faction:index===0?'orc':source.result.attacker_faction,attacker_losses:index%4===2?3:0,attacker_survivors:source.result.attacker_initial-(index%4===2?3:0),
            hero_reward:source.result.hero_reward?{...source.result.hero_reward,artifacts:index%3===0?source.result.hero_reward.artifacts:[]}:undefined},
    }));
    world.reports.push({...source,id:++id,battle_id:++id,owner_id:'rival-ruler',title:'Private rival report'});
    world.battles=[];world.formations=[];
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(w=>{
        if(!localStorage.getItem('peris-campaign-v6'))localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
        localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
    },world);
    await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
    const nav=page.getByRole('navigation',{name:'Game navigation'}), filters=page.getByRole('group',{name:'Filter reports'});
    await nav.getByRole('button',{name:'Reports, 8 unread',exact:true}).click();
    await expect(page.locator('.report-row')).toHaveCount(12);
    const toolbar=(await page.locator('.report-inbox-toolbar').boundingBox())!, inbox=(await page.locator('.report-inbox').boundingBox())!, workspace=(await page.locator('.report-inbox-workspace').boundingBox())!;
    expect(toolbar.height).toBeLessThanOrEqual(46);
    expect(workspace.height/inbox.height).toBeGreaterThan(.85);
    const controls=page.locator('.report-inbox-toolbar .report-control');
    await expect(controls).toHaveCount(8);
    for(const control of await controls.all()){
        const box=(await control.boundingBox())!;
        expect(box.width).toBeLessThanOrEqual(32);
        expect(box.x).toBeGreaterThanOrEqual(inbox.x);
        expect(box.x+box.width).toBeLessThanOrEqual(inbox.x+inbox.width);
        await expect(control.locator('svg')).toBeVisible();
    }
    await expect(page.getByLabel('Search reports',{exact:true})).toHaveCount(0);
    await page.screenshot({path:info.outputPath('report-icons-default.png')});
    await page.getByRole('button',{name:'Newest first',exact:true}).click();
    await expect(page.locator('.report-row').first()).toHaveAttribute('aria-label',/^Camp raid 12,/);
    await page.getByRole('button',{name:'Oldest first',exact:true}).click();
    await expect(page.locator('.report-row').first()).toHaveAttribute('aria-label',/^Camp raid 1,/);
    await expect(page.getByRole('heading',{name:'Rewards for your realm'})).toHaveCount(0);
    await expect(page.getByRole('button',{name:/Private rival report/})).toHaveCount(0);
    await filters.getByRole('button',{name:'Losses',exact:true}).click();await expect(page.locator('.report-row')).toHaveCount(3);
    await filters.getByRole('button',{name:'Equipment',exact:true}).click();await expect(page.locator('.report-row')).toHaveCount(4);
    await filters.getByRole('button',{name:'All',exact:true}).click();
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await expect(page.getByLabel('Search reports',{exact:true})).toBeFocused();
    await page.getByLabel('Search reports',{exact:true}).fill(camps[1].name);await expect(page.locator('.report-row')).toHaveCount(6);
    await page.getByRole('button',{name:'Clear report search',exact:true}).click();
    await page.getByLabel('Search reports',{exact:true}).fill(camps[1].name);
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await expect(page.getByLabel('Search reports',{exact:true})).toHaveCount(0);
    await expect(page.locator('.report-row')).toHaveCount(12);
    await page.getByLabel('Report outcome',{exact:true}).selectOption('victory');await expect(page.locator('.report-row')).toHaveCount(9);
    await page.getByLabel('Report outcome',{exact:true}).selectOption('defeat');await expect(page.locator('.report-row')).toHaveCount(3);
    await expect(page.locator('.report-list-caption')).toContainText('Defeats');
    await page.screenshot({path:info.outputPath('report-icons-defeats.png')});
    await page.getByLabel('Report outcome',{exact:true}).selectOption('draw');await expect(page.locator('.report-row')).toHaveCount(0);
    await page.getByLabel('Report outcome',{exact:true}).selectOption('all');
    await page.screenshot({path:info.outputPath('report-inbox-list.png')});
    const row=page.locator('.report-row').first();await row.focus();await page.keyboard.press('Enter');
    const detail=page.getByRole('region',{name:'Report details',exact:true});
    await expect(detail.getByRole('region',{name:'Hero experience'})).toBeVisible();
    await expect(detail.locator('.report-hero img')).toHaveAttribute('src', /orc/);
    await expect(detail.getByRole('region',{name:'Equipment received'})).toBeVisible();
    await expect(nav.getByRole('button',{name:'Reports, 7 unread',exact:true})).toBeVisible();
    for(const img of await detail.locator('.artifact-art img').all())await expect.poll(()=>img.evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
    await page.screenshot({path:info.outputPath('report-inbox-detail.png')});
    await detail.getByRole('button',{name:'Back to reports',exact:true}).click();
    await page.getByRole('button',{name:'Read all',exact:true}).click();
    await expect(nav.locator('button.has-unread')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Read all',exact:true})).toBeDisabled();
    await filters.getByRole('button',{name:'Unread',exact:true}).click();await expect(page.locator('.report-row')).toHaveCount(0);
    await expect(page.locator('.report-list-empty')).toContainText('All caught up');
    await page.getByRole('tab',{name:'Milestones',exact:true}).click();await expect(page.getByRole('heading',{name:'Rewards for your realm'})).toBeVisible();
    await page.reload();await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
    await expect(nav.locator('button.has-unread')).toHaveCount(0);
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!));
    expect(saved.reports.filter((report:{owner_id:string})=>report.owner_id===owner).every((report:{read_at?:string})=>report.read_at)).toBe(true);
    expect(saved.reports.find((report:{owner_id:string})=>report.owner_id==='rival-ruler').read_at).toBeFalsy();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
});

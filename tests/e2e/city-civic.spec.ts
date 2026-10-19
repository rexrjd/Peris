import { test, expect } from '@playwright/test';
import { createSolo } from '../../src/features/campaign/domain/newRealm';

test('faction landmarks, junction squares and flower exclusions survive city switching',async({page},info)=>{
    test.setTimeout(120_000);
    const world=createSolo('Civic cities'),town=world.settlements[0],buildings=world.buildings;
    const factions=['roman','elf','orc','undead','demon'] as const;
    world.settlements=factions.map((faction,i)=>({...town,id:i+1,name:`Civic ${faction}`,faction,x:town.x+i*512}));
    world.buildings=factions.flatMap((_,i)=>buildings.map(b=>({...b,id:b.id+i*100,settlement_id:i+1,level:3})));
    world.city_slots=factions.flatMap((_,i)=>Array.from({length:6},(_,slot_index)=>({settlement_id:i+1,slot_index,building_type:slot_index===0?'barracks' as const:'housing' as const,level:2})));
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(w=>{
        localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
        localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
        sessionStorage.setItem(`peris-city-view:${w.players[0].id}`,'3d');
    },world);
    await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('button',{name:'City',exact:true}).click();
    for(const faction of factions){
        await page.getByRole('button',{name:/^Current city:/}).click();
        await page.getByRole('menuitemradio',{name:new RegExp(`^Civic ${faction},`)}).click();
        const canvas=page.locator('.city-3d-scene.ready canvas');
        await expect(canvas).toHaveAttribute('data-city-landmark',faction==='roman'?'fountain':faction==='elf'?'grove':faction==='orc'?'fire':'none');
        if(['orc','undead','demon'].includes(faction))await expect(canvas).toHaveAttribute('data-city-flowers','0');
        else expect(Number(await canvas.getAttribute('data-city-flowers'))).toBeGreaterThan(0);
        if(['roman','elf','orc'].includes(faction))expect(Number(await canvas.getAttribute('data-city-squares'))).toBeGreaterThan(0);
        await page.locator('[data-building="slot:1"]').focus();await page.keyboard.press('Enter');
        await expect(page.locator('.building-inspector').getByRole('heading',{name:'Housing',exact:true})).toBeVisible();
        await page.keyboard.press('Escape');await canvas.focus();
        await page.mouse.move(5,880);await page.screenshot({path:info.outputPath(`${faction}-civic.png`)});
    }
    expect(errors).toEqual([]);
});

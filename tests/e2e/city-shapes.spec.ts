import { test, expect } from '@playwright/test';
import { Vector3 } from 'three';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { cityEnvironment } from '../../src/features/city/domain/environment';
import { cityLayout } from '../../src/features/city/rendering/three/layout';
import { CityCamera } from '../../src/features/city/rendering/three/CityCamera';

test('six seeded Roman, Elf and Orc cities keep unique layouts, real picking and reload identity', async ({ page }, info) => {
    test.setTimeout(150_000);
    const world=createSolo('Shaped cities'),original=world.settlements[0],buildings=world.buildings;
    const styles=['roman','roman','elf','elf','orc','orc'] as const;
    world.settlements=styles.map((faction,i)=>({...original,id:i+1,name:`${faction} ${i%2+1}`,faction,x:original.x+i*512}));
    world.buildings=styles.flatMap((_,i)=>buildings.map(b=>({...b,id:b.id+i*100,settlement_id:i+1,level:b.building_type==='market'?5:3})));
    world.city_slots=styles.flatMap((_,i)=>Array.from({length:10},(_,slot_index)=>({settlement_id:i+1,slot_index,building_type:slot_index===0?'barracks' as const:slot_index===3?'academy' as const:'housing' as const,level:3})));
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(w=>{
        localStorage.setItem('peris-campaign-v6',JSON.stringify(w));
        localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
        localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');
        sessionStorage.setItem(`peris-city-view:${w.players[0].id}`,'3d');
    },world);
    await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
    await page.getByRole('button',{name:'City',exact:true}).click();
    for(const town of world.settlements){
        await page.getByRole('button',{name:/^Current city:/}).click();
        await page.getByRole('menuitemradio',{name:new RegExp(`^${town.name},`)}).click();
        const scene=page.locator('.city-3d-scene.ready'),canvas=scene.locator('canvas');
        await expect(scene).toHaveAttribute('data-city-seed',String(cityEnvironment(town).seed));
        await expect(canvas).toHaveAttribute('data-city-zoom','1.000');
        const rect=(await canvas.boundingBox())!,environment=cityEnvironment(town),camera=new CityCamera();
        camera.resize(rect.width,rect.height,5,environment);
        const plot=cityLayout({market:5},world.city_slots.filter(p=>p.settlement_id===town.id),environment).find(p=>p.key==='slot:8')!;
        const p=new Vector3(plot.x,.85,plot.z).project(camera.camera);
        await page.mouse.click(rect.x+(p.x+1)*rect.width/2,rect.y+(1-p.y)*rect.height/2);
        await expect(page.locator('.building-inspector').getByRole('heading',{name:'Housing',exact:true})).toBeVisible();
        await page.keyboard.press('Escape');
        await page.mouse.move(8,rect.y+rect.height-8);
        await canvas.focus();
        await page.screenshot({path:info.outputPath(`${town.name.replace(' ','-')}.png`)});
    }
    await page.reload();await page.getByRole('button',{name:'Continue campaign',exact:true}).click();
    await page.getByRole('button',{name:'City',exact:true}).click();
    await expect(page.locator('.city-3d-scene.ready')).toHaveAttribute('data-city-seed',String(cityEnvironment(world.settlements[0]).seed));
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('peris-campaign-v6')!));
    expect(saved.city_slots).toEqual(world.city_slots);
    expect(errors).toEqual([]);
});

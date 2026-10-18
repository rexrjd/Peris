import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { refreshCityEconomy } from '../../src/features/city/domain/slots';
import { cityLayout } from '../../src/features/city/rendering/three/layout';
import { CityCamera } from '../../src/features/city/rendering/three/CityCamera';

test('civic hall and working silhouettes keep roof selection, compact previews and free building lots',async({page},info)=>{
    const world=createSolo('Stonebridge'),town=world.settlements[0],errors:string[]=[];
    world.buildings.forEach(b=>b.level=3);
    world.city_slots=(['smithy','warehouse','granary','barracks'] as const).map((building_type,slot_index)=>({settlement_id:town.id,slot_index,building_type,level:3}));refreshCityEconomy(world,town.id);
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(w=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},world);
    await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('button',{name:'City',exact:true}).click();await page.getByRole('button',{name:'3D',exact:true}).click();
    const canvas=page.locator('.city-3d-scene.ready canvas');await expect(canvas).toHaveAttribute('data-city-zoom','1.000');
    const rect=(await canvas.boundingBox())!,camera=new CityCamera();camera.resize(rect.width,rect.height,3);
    const plots=cityLayout({market:3},world.city_slots);
    for(const [key,title,dx,y,dz] of [['market','Main building',0,2.5,-.7],['slot:0','Smithy',.4,1.55,-.25],['slot:1','Warehouse',-.57,1.22,-.48],['slot:2','Granary',0,1.5,-.18],['slot:3','Barracks',0,1.25,-1]] as const){
        const plot=plots.find(p=>p.key===key)!,scale=key==='market'?1.2:.98,sy=key==='market'?1.35:1.12,p=new THREE.Vector3(plot.x+dx*scale,y*sy+.015,plot.z+dz*scale).project(camera.camera);
        await page.mouse.click(rect.x+(p.x+1)*rect.width/2,rect.y+(1-p.y)*rect.height/2);
        const panel=page.locator('.building-inspector');await expect(panel.getByRole('heading',{name:title,exact:true})).toBeVisible();await expect(panel.getByRole('img',{name:`${title}, level 3`,exact:true})).toBeVisible();await page.keyboard.press('Escape');
    }
    await page.locator('[data-building="slot:5"]').click();await expect(page.getByRole('radio',{name:/^Housing/})).toBeVisible();await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Rotate city right',exact:true}).click();await expect(canvas).toHaveAttribute('data-city-rotation','0.393');
    await page.screenshot({path:info.outputPath('town-character.png')});expect(errors).toEqual([]);
});

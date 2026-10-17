import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { refreshCityEconomy } from '../../src/features/city/domain/slots';
import { cityLayout } from '../../src/features/city/rendering/three/layout';
import { CityCamera } from '../../src/features/city/rendering/three/CityCamera';

test('working resource yards remain selectable through their actual 3D geometry', async ({page,isMobile},info) => {
    const world=createSolo('Working yards'),town=world.settlements[0],errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    world.buildings.forEach(b=>b.level=3);
    world.city_slots=[{settlement_id:town.id,slot_index:16,building_type:'fishery',level:3}];refreshCityEconomy(world,town.id);
    await page.addInitScript(w=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},world);
    await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('button',{name:'City',exact:true}).click();await page.getByRole('button',{name:'3D',exact:true}).click();
    const canvas=page.locator('.city-3d-scene.ready canvas');await expect(canvas).toHaveAttribute('data-city-zoom','1.000');
    const rect=(await canvas.boundingBox())!,camera=new CityCamera();camera.resize(rect.width,rect.height,3);
    for(const key of ['lumber','quarry','farm','fishery']){
        const plot=cityLayout({market:3},world.city_slots).find(p=>p.key===key)!;
        // Mobile's narrow view can put an outside yard behind its HUD; its marker
        // remains a normal alternative. Desktop clicks use projected roof geometry.
        if(isMobile)await page.locator(`[data-building="${key}"]`).click();
        else{const p=new THREE.Vector3(plot.x, .6, plot.z).project(camera.camera);await page.mouse.click(rect.x+(p.x+1)*rect.width/2,rect.y+(1-p.y)*rect.height/2);}
        const panel=page.locator('.building-inspector');await expect(panel).toBeVisible();
        await expect(panel.getByRole('img')).toHaveAttribute('aria-label',/level 3/);
        await expect(panel.getByRole('button',{name:'Upgrade to level 4',exact:true})).toBeVisible();
        await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);
    }
    await page.getByRole('button',{name:'Rotate city right',exact:true}).click();await expect(canvas).toHaveAttribute('data-city-rotation','0.393');
    await page.screenshot({path:info.outputPath('fortifications-and-resource-yards.png')});
    expect(errors).toEqual([]);
});

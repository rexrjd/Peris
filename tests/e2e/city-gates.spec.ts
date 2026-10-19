import { test, expect } from '@playwright/test';
import * as THREE from 'three';
import { createSolo } from '../../src/features/campaign/domain/newRealm';
import { refreshCityEconomy } from '../../src/features/city/domain/slots';
import { BUILDINGS } from '../../src/features/city/domain/buildings';
import { cityLayout } from '../../src/features/city/rendering/three/layout';
import { CityCamera } from '../../src/features/city/rendering/three/CityCamera';
import { cityEnvironment } from '../../src/features/city/domain/environment';

test('front gatehouse is selectable from its masonry and keeps the compact wall preview',async({page},info)=>{
    const world=createSolo('Gatehouse'),errors:string[]=[];world.buildings.forEach(b=>b.level=3);refreshCityEconomy(world,world.settlements[0].id);
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(w=>{localStorage.setItem('peris-campaign-v6',JSON.stringify(w));localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem(`peris-welcome:${w.players[0].id}:${w.players[0].created_at}`,'yes');},world);
    await page.goto('/');await page.getByRole('button',{name:'Continue campaign',exact:true}).click();await page.getByRole('button',{name:'City',exact:true}).click();await page.getByRole('button',{name:'3D',exact:true}).click();
    const canvas=page.locator('.city-3d-scene.ready canvas');await expect(canvas).toHaveAttribute('data-city-zoom','1.000');
    const rect=(await canvas.boundingBox())!,camera=new CityCamera();camera.resize(rect.width,rect.height,3,cityEnvironment(world.settlements[0]));
    const gate=cityLayout({market:3},[],cityEnvironment(world.settlements[0])).find(p=>p.key==='wall')!;
    const p=new THREE.Vector3(gate.x,1.85,gate.z).project(camera.camera);
    await page.mouse.click(rect.x+(p.x+1)*rect.width/2,rect.y+(1-p.y)*rect.height/2);
    const panel=page.locator('.building-inspector');await expect(panel.getByRole('heading',{name:BUILDINGS.wall.name,exact:true})).toBeVisible();
    await expect(panel.getByRole('img')).toHaveAttribute('aria-label',/level 3/);
    await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);
    await page.getByRole('button',{name:'Rotate city right',exact:true}).click();await expect(canvas).toHaveAttribute('data-city-rotation','0.393');
    await page.screenshot({path:info.outputPath('city-gatehouses.png')});expect(errors).toEqual([]);
});

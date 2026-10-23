import {test,expect} from '@playwright/test';

test('native Market contact sheet contains every faction and completed level',async({page},info)=>{
 test.skip(info.project.name==='mobile-chromium','The complete model contact sheet is captured once at desktop resolution.');test.setTimeout(120000);
 await page.setViewportSize({width:1500,height:1000});await page.goto('/');
 await page.evaluate(async()=>{
  const threePath='/node_modules/.vite/deps/three.js',marketPath='/src/features/city/rendering/three/market.ts',kitPath='/src/features/city/rendering/three/modelKit.ts',factionsPath='/src/features/factions/domain/factions.ts';
  const THREE=await import(threePath),{createMarket}=await import(marketPath),{disposeCityObject}=await import(kitPath),{FACTIONS}=await import(factionsPath);
  document.getElementById('root')!.style.display='none';document.body.style.cssText='margin:0;background:#e6deca;color:#302c25;font:15px Georgia;overflow:auto';
  const sheet=document.createElement('main');sheet.id='market-contact-sheet';sheet.style.cssText='display:grid;grid-template-columns:120px repeat(5,250px);gap:8px;padding:16px;width:1460px;box-sizing:border-box';document.body.append(sheet);
  for(const label of ['Faction','Level 1','Level 2','Level 3','Level 4','Level 5']){const heading=document.createElement('b');heading.textContent=label;heading.style.cssText='padding:12px;text-align:center';sheet.append(heading);}
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(250,210);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  for(const faction of Object.keys(FACTIONS)){
   const label=document.createElement('b');label.textContent=faction;label.style.cssText='display:flex;align-items:center;justify-content:center;text-transform:capitalize';sheet.append(label);
   for(let level=1;level<=5;level++){
    const scene=new THREE.Scene(),model=createMarket(level,faction);scene.add(model,new THREE.HemisphereLight(0xf1f4eb,FACTIONS[faction].earth,1.8));const sun=new THREE.DirectionalLight(0xffedd1,2.7);sun.position.set(-5,10,7);scene.add(sun);
    const camera=new THREE.OrthographicCamera(-2.1,2.1,1.8,-1.8,.1,50);camera.position.set(5,5.5,7);camera.lookAt(0,.65,0);renderer.render(scene,camera);
    const img=document.createElement('img');img.alt=`${faction} Market level ${level}`;img.width=250;img.height=210;img.src=renderer.domElement.toDataURL('image/png');img.style.cssText='background:#d4cbb3;border-radius:6px';sheet.append(img);disposeCityObject(model);
   }
  }
  renderer.dispose();
 });
 await expect(page.locator('#market-contact-sheet img')).toHaveCount(55);await page.screenshot({path:info.outputPath('market-all-factions-levels.png'),fullPage:true});
});

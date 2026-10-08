import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const out='artifacts/battle-preview/unit-prototypes';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=gl','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[],warnings=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
const measurements=[];
async function capture(name){
 await page.waitForTimeout(2000);
 measurements.push({view:name,stats:await page.locator('.army-inspection small').innerText()});
 await page.screenshot({path:`${out}/${name}.png`});console.log(`Captured ${name}`);
}
try{
 await page.addInitScript(()=>{localStorage.setItem('peris-solo-v6','preserve-existing-save');});
 await page.goto('http://127.0.0.1:5173/?battle-preview=1&unit-prototypes=1',{waitUntil:'domcontentloaded',timeout:120000});
 await page.locator('.army-loading').waitFor({state:'hidden',timeout:120000});
 await page.locator('.battle-3d-label').first().waitFor({timeout:30000});
 await capture('battle-overview');
 await page.locator('.unit-card').first().click();
 await page.getByRole('button',{name:'Inspect selected troops',exact:true}).click();await capture('infantry');
 await page.locator('.unit-card').last().click();
 await page.getByRole('button',{name:'Inspect selected troops',exact:true}).click();await capture('cavalry');
 await page.getByRole('button',{name:'Move',exact:true}).click();
 const field=page.locator('.battle-3d-canvas canvas'),box=await field.boundingBox();
 await field.click({position:{x:box.width*.64,y:box.height*.53}});await capture('cavalry-moving');
 await field.hover();await page.keyboard.down('q');await page.waitForTimeout(500);await page.keyboard.up('q');await page.mouse.wheel(0,-150);await capture('cavalry-side');
 await page.getByRole('button',{name:'Battle overview',exact:true}).click();
 await page.getByRole('button',{name:'Begin battle',exact:true}).click();await capture('battle-running');
 await page.getByRole('button',{name:/Ⅱ Pause/}).click();
 await page.getByLabel('Graphics quality').selectOption('balanced');
 await page.locator('.army-loading').waitFor({state:'hidden',timeout:120000});
 if(!await page.locator('.pause-banner').isVisible())throw new Error('Quality setting lost paused battle');
 await field.waitFor({state:'visible',timeout:30000});
 const gpu=await field.evaluate(canvas=>{const gl=canvas.getContext('webgl2');const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
 const save=await page.evaluate(()=>localStorage.getItem('peris-solo-v6'));
 if(save!=='preserve-existing-save')throw new Error('Preview modified campaign');
 await page.getByRole('button',{name:'2D',exact:true}).click();
 await page.locator('canvas[aria-label^="Tactical battlefield"]').waitFor();
 const report={errors,warnings,gpu,viewport:{width:1600,height:1000},soldiers:540,setting:'Ultra',measurements,savePreserved:true,fallback2D:true};
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(errors.length)process.exitCode=1;
}finally{await browser.close();}

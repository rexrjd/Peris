import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out='artifacts/battle-preview'; await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=gl','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try {
await page.goto('http://127.0.0.1:5173/?battle-preview=1',{waitUntil:'domcontentloaded',timeout:120000});
await page.locator('.army-loading').waitFor({state:'hidden',timeout:120000});
await page.locator('.battle-3d-label').first().waitFor({timeout:30000});
await page.waitForTimeout(1500);
await page.screenshot({path:out+'/orc-overview.png'});
await page.getByRole('button',{name:'Inspect selected troops',exact:true}).click();
await page.waitForTimeout(1500);await page.screenshot({path:out+'/orc-infantry.png'});
await page.locator('.unit-card').last().click();await page.getByRole('button',{name:'Inspect selected troops',exact:true}).click();
await page.waitForTimeout(1500);await page.screenshot({path:out+'/orc-mammoths.png'});
await page.getByRole('button',{name:'Inspect stonehurler',exact:true}).click();
await page.waitForTimeout(1000);await page.screenshot({path:out+'/orc-stonehurler.png'});
const gpu=await page.locator('.battle-3d-canvas canvas').evaluate(canvas=>{const gl=canvas.getContext('webgl2');const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
const report={errors,gpu,stats:await page.locator('.army-inspection small').innerText()};
await writeFile(out+'/initial-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
if(errors.length)process.exitCode=1;
} finally { await browser.close(); }

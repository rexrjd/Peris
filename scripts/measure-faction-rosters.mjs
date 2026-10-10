import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {cpus,totalmem} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const names=JSON.parse(await readFile('assets/concepts/faction-sheets-v1/expanded-rosters.json','utf8')).roster.map(r=>r.id);
const faction=process.argv[2]||'roman',enemy=process.argv[3]||'orc';
if(!names.includes(faction)||!names.includes(enemy))throw new Error('Unknown faction');
const base=process.env.PERIS_PREVIEW_URL||'http://127.0.0.1:4173';
const quality=process.env.PERIS_GRAPHICS_QUALITY||'ultra';
if(!['balanced','ultra'].includes(quality))throw new Error('Invalid graphics quality');
const run=new Date().toISOString().replace(/[:.]/g,'-'),out=join('artifacts/battle-preview/faction-performance',run);
const roster=JSON.parse(await readFile('public/models/battle/faction-rosters.json','utf8'));
async function fingerprint(id){
 const pack=roster.factions[id],detail={};
 for(const [name,suffix] of [['near',''],['far','-lod']]){
  const bytes=await readFile(`public/models/battle/${id}-roster${suffix}.glb`);
  detail[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 }
 return {faction:id,sourceEdition:pack.sourceEdition||roster.edition,...detail};
}
const models=await Promise.all([fingerprint(faction),fingerprint(enemy)]);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chromium'});
const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
async function measure(view,renderedSoldiers){
 await page.waitForTimeout(10000);
 const samples=await page.evaluate(()=>new Promise(resolve=>{
  const samples=[];let start=performance.now(),frames=0;
  function frame(time){frames++;if(time-start>=1000){
   const elapsedMs=time-start;samples.push({elapsedMs,frames,fps:frames*1000/elapsedMs,rendererStats:document.querySelector('.army-inspection small')?.textContent});
   if(samples.length===5){resolve(samples);return;}frames=0;start=time;
  }requestAnimationFrame(frame);}requestAnimationFrame(frame);
 }));
 await page.screenshot({path:join(out,view+'.png')});
 return {view,renderedSoldiers,warmupSeconds:10,samples,
  averageFPS:samples.reduce((n,s)=>n+s.frames,0)*1000/samples.reduce((n,s)=>n+s.elapsedMs,0),
  minimumWindowFPS:Math.min(...samples.map(s=>s.fps)),maximumWindowFPS:Math.max(...samples.map(s=>s.fps))};
}
try{
 await page.addInitScript(()=>{localStorage.setItem('peris-solo-v6','preserve-roster-performance-save');localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:false,effects:true}));});
 await page.goto(`${base}/?battle-preview=1&unit-prototypes=1&faction=${faction}&enemy=${enemy}`,{waitUntil:'domcontentloaded',timeout:120000});
 await expect(page.locator('.battle-art-preview')).toHaveAttribute('data-model-pack','textured',{timeout:120000});
 await page.getByLabel('Graphics quality').selectOption(quality);
 await page.locator('.army-loading').waitFor({state:'hidden',timeout:120000});
 await expect(page.locator('.battle-3d-label.friendly')).toHaveCount(7,{timeout:30000});
 const gpu=await page.locator('.battle-3d-canvas canvas').evaluate(canvas=>{const gl=canvas.getContext('webgl2'),extension=gl.getExtension('WEBGL_debug_renderer_info');return extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
 const overview=await measure('overview',540);
 await page.getByLabel('Inspect unit role').selectOption('heavy_cavalry');
 const inspection=await measure('heavy-cavalry',20);
 const save=await page.evaluate(()=>localStorage.getItem('peris-solo-v6'));
 if(save!=='preserve-roster-performance-save')throw new Error('Preview modified campaign save');
 const report={edition:models[0].sourceEdition,models,measuredAtUTC:new Date().toISOString(),cpu:cpus()[0]?.model,memoryGiB:Math.round(totalmem()/1024**3*10)/10,gpu,
  viewport:{width:1600,height:1000},deviceScaleFactor:1,faction,enemy,quality,battlePhase:'deployment',animationsEnabled:true,savePreserved:true,
  totalBattleSoldiers:540,errors,overview,inspection,
  limitations:'Five one-second RAF windows after a ten-second warmup per view. Idle deployment animations; these results do not establish sustained combat or mobile performance. Inspection hides other formations.'};
 await writeFile(join(out,'performance.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({out,overview:overview.averageFPS,inspection:inspection.averageFPS,errors}));
 if(errors.length)process.exitCode=1;
}finally{await browser.close();}

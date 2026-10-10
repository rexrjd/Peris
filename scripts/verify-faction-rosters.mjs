// Capture actual playable renderer output for every upgraded faction/role.
import {chromium,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const rosters=JSON.parse(await readFile('assets/concepts/faction-sheets-v1/expanded-rosters.json','utf8')).roster;
const selected=process.argv.slice(2),factions=selected.length?selected:rosters.map(r=>r.id);
for(const faction of factions)if(!rosters.some(r=>r.id===faction))throw new Error('Unknown faction '+faction);
const run=new Date().toISOString().replace(/[:.]/g,'-');
const out=join('artifacts/battle-preview/faction-rosters',run);await mkdir(out,{recursive:true});
const base=process.env.PERIS_PREVIEW_URL||'http://127.0.0.1:5173';
const browser=await chromium.launch({headless:true,args:['--use-angle=gl','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[],warnings=[],captures=[],assetFingerprints=new Map();
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning')warnings.push(message.text());});
const troopRoles=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry'];
async function ready(){
 await expect(page.locator('.battle-art-preview')).toHaveAttribute('data-model-pack','textured',{timeout:120000});
 await page.locator('.unit-card').first().waitFor({state:'visible',timeout:120000});
 await page.locator('.army-loading').waitFor({state:'hidden',timeout:120000});
 await expect(page.locator('.battle-3d-label.friendly')).toHaveCount(7,{timeout:30000});
 await page.locator('.army-inspection small').filter({hasText:'FPS'}).waitFor({timeout:30000});
 await page.waitForTimeout(2500);
}
async function capture(faction,role){
 await page.waitForTimeout(1200);
 await expect(page.getByLabel('Your faction')).toHaveValue(faction);
 if(role!=='overview')await expect(page.getByLabel('Inspect unit role')).toHaveValue(role);
 const name=`${faction}-${role}.png`,stats=await page.locator('.army-inspection small').innerText();
 await page.screenshot({path:join(out,name)});
 const roster=rosters.find(r=>r.id===faction),label=[...roster.troops,...roster.siege].find(t=>t.id===role)?.name||role;
 if(!assetFingerprints.has(faction)){
  const assets=[];
  for(const detail of ['near','far']){
   const file=`${faction}-roster${detail==='far'?'-lod':''}.glb`;
   const response=await page.request.get(`${base}/models/battle/${file}`);
   if(!response.ok())throw new Error(`Screenshot asset request failed: ${file}`);
   const bytes=await response.body();
   assets.push({file,detail,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
   await response.dispose();
  }
  assetFingerprints.set(faction,assets);
 }
 captures.push({faction,role,label,file:name,stats,assets:assetFingerprints.get(faction)});
 await writeFile(join(out,'progress.json'),JSON.stringify({out,errors,warnings,captures},null,2));
 console.log(JSON.stringify({event:'UNIT_SCREENSHOT_READY',faction,role,label,path:join(out,name)}));
}
try{
 await page.addInitScript(()=>{localStorage.setItem('peris-solo-v6','preserve-roster-review-save');localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));});
 console.log(JSON.stringify({event:'CAPTURE_RUN_STARTED',out}));
 await page.goto(`${base}/?battle-preview=1&unit-prototypes=1&faction=${factions[0]}&enemy=roman`,{waitUntil:'domcontentloaded',timeout:120000});
 await ready();
 await page.getByLabel('Enemy faction').selectOption('roman');await ready();
 for(const faction of factions){
  await page.getByLabel('Your faction').selectOption(faction);await ready();
  for(const role of troopRoles){
   await page.getByLabel('Inspect unit role').selectOption(role);
   // A tighter game camera reveals the model's fitted equipment and textures.
   // It changes only the view; the formation and battle state remain intact.
   for(let zoom=0;zoom<(role.includes('cavalry')||role==='scout'?2:4);zoom++)
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
   await capture(faction,role);
  }
  await page.getByRole('button',{name:/^Inspect ram$/i}).click();await capture(faction,'ram');
  await page.getByRole('button',{name:/^Inspect (catapult|stonehurler)$/i}).click();await capture(faction,'catapult');
  await page.getByRole('button',{name:'Battle overview',exact:true}).click();
  await capture(faction,'overview');
 }
 const save=await page.evaluate(()=>localStorage.getItem('peris-solo-v6'));
 if(save!=='preserve-roster-review-save')throw new Error('Preview modified campaign save');
 const gl=await page.locator('.battle-3d-canvas canvas').evaluate(canvas=>{const gl=canvas.getContext('webgl2'),extension=gl.getExtension('WEBGL_debug_renderer_info');return extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
 await writeFile(join(out,'report.json'),JSON.stringify({capturedAt:run,viewport:{width:1600,height:1000},quality:'ultra',gpu:gl,animations:false,savePreserved:true,errors,warnings,captures},null,2));
 const escape=text=>String(text).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const sections=factions.map(faction=>`<section><h2>${escape(rosters.find(r=>r.id===faction).name)}</h2><div class="grid">${captures.filter(c=>c.faction===faction).map(c=>`<figure><a href="${c.file}"><img src="${c.file}" alt="Actual game capture of ${escape(c.label)}" loading="lazy"></a><figcaption>${escape(c.label)}<small>${escape(c.stats)} · capture statistic</small></figcaption></figure>`).join('')}</div></section>`).join('');
 await writeFile(join(out,'index.html'),`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Peris faction model review</title><style>body{margin:0;background:#16271f;color:#e5dcc0;font:16px system-ui;padding:32px}main{max-width:1440px;margin:auto}h1,h2{font-family:Georgia;font-weight:400}p,small{color:#b6bc9d}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}figure{margin:0;background:#22382b;border:1px solid #66734f}img{display:block;width:100%}figcaption{padding:12px}small{display:block;font-size:11px;margin-top:5px}section{margin-top:40px}@media(max-width:800px){.grid{grid-template-columns:1fr}body{padding:16px}}</style><main><h1>Peris · Actual model review captures</h1><p>Playable Three.js renderer · ${escape(run)} · Ultra · 1600×1000. The units are 3D models; the portrait cards are concept illustrations. These snapshots establish appearance, not sustained FPS.</p>${sections}<p>Adapted game assets by Wildfire Games, CC BY-SA 3.0. See the shipped unit credits and source inventory for provenance.</p></main>`);
 console.log(JSON.stringify({out,captures:captures.length,errors:errors.length,warnings:warnings.length}));
 if(errors.length)process.exitCode=1;
}finally{await browser.close();}

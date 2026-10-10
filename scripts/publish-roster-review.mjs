// Publish verified, actual game screenshots incrementally without losing earlier captures.
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),destination=join(root,'assets/references/units/previews/roster-v3');
const roster=JSON.parse(await readFile(join(root,'assets/concepts/faction-sheets-v1/expanded-rosters.json'),'utf8')).roster;
const publication=JSON.parse(await readFile(join(root,'public/models/battle/faction-rosters.json'),'utf8'));
const roles=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','ram','catapult'];
await mkdir(destination,{recursive:true});
let previous={captures:[]};
try{previous=JSON.parse(await readFile(join(destination,'captures.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const hashes=new Map();
async function currentAssetHash(file){
 if(!/^[a-z]+-roster(?:-lod)?\.glb$/.test(file))throw new Error('Unexpected screenshot model filename');
 if(!hashes.has(file)){
  try{hashes.set(file,createHash('sha256').update(await readFile(join(root,'public/models/battle',file))).digest('hex'));}
  catch(error){if(error.code!=='ENOENT')throw error;hashes.set(file,null);}
 }
 return hashes.get(file);
}
async function matchesCurrentAssets(capture){
 const assets=capture.assets||[];
 if(!['','-lod'].every(suffix=>assets.some(asset=>asset.file===`${capture.faction}-roster${suffix}.glb`&&/^[a-f0-9]{64}$/.test(asset.sha256))))return false;
 for(const asset of assets)if(await currentAssetHash(asset.file)!==asset.sha256)return false;
 return true;
}
function factionAvailability(faction){
 if(publication.withheld?.[faction])return 'withheld';
 const pack=publication.factions?.[faction];return pack?.near&&pack?.far?'enabled':'unavailable';
}
// Kept captures are historical evidence even when their model no longer ships.
// Each record retains its original fingerprints and explicit review standard.
const captures=[];
const imageHashes=new Map();
for(const capture of previous.captures){
 const hash=createHash('sha256').update(await readFile(join(destination,capture.file))).digest('hex');
 const imageKey=capture.faction+'/'+hash;
 const duplicate=imageHashes.has(imageKey)&&imageHashes.get(imageKey)!==capture.role;
 if(!duplicate)imageHashes.set(imageKey,capture.role);
 captures.push({...capture,pixelSHA256:capture.pixelSHA256||hash,storedPixelSHA256:hash,duplicateRoleEvidence:duplicate});
}
const source=process.argv[2];
if(source){
 const report=JSON.parse(await readFile(resolve(source),'utf8'));
 if(report.errors?.length)throw new Error('Resolve renderer errors before publishing captures');
 for(const capture of report.captures){
  if(!roles.includes(capture.role))continue;
  if(!await matchesCurrentAssets(capture))throw new Error(`Capture needs matching near/far model fingerprints: ${capture.faction}/${capture.role}`);
  const image=join(dirname(resolve(source)),capture.file);
  const data=await readFile(image);
  if(data.toString('hex',0,8)!=='89504e470d0a1a0a')throw new Error('Expected an original PNG screenshot');
  const hash=createHash('sha256').update(data).digest('hex'),imageKey=capture.faction+'/'+hash;
  if(imageHashes.has(imageKey)&&imageHashes.get(imageKey)!==capture.role)throw new Error(`Duplicate role screenshot: ${capture.faction}/${capture.role}`);
  imageHashes.set(imageKey,capture.role);
  // A new screenshot cannot replace an earlier image for the same unit.
  const filename=`${capture.faction}-${capture.role}-${hash.slice(0,12)}.png`;
  if(!captures.some(saved=>saved.faction===capture.faction&&saved.role===capture.role&&saved.storedPixelSHA256===hash)){
   await copyFile(image,join(destination,filename));
   captures.push({...capture,file:filename,pixelSHA256:hash,storedPixelSHA256:hash,duplicateRoleEvidence:false,visualStandard:report.visualStandard||null,capturedAt:report.capturedAt||new Date().toISOString(),width:data.readUInt32BE(16),height:data.readUInt32BE(20)});
  }
 }
}
export async function reviewCapture(capture){
 const availability=factionAvailability(capture.faction),withheld=publication.withheld?.[capture.faction];
 const fingerprinted=(capture.assets||[]).length>0,matched=await matchesCurrentAssets(capture);
 const pixelsMatch=capture.pixelSHA256===capture.storedPixelSHA256;
 const activeAssets=(capture.assets||[]).every(asset=>factionAvailability(asset.file.split('-roster')[0])==='enabled');
 const currentPreviewCapture=availability==='enabled'&&matched&&activeAssets&&pixelsMatch&&!capture.duplicateRoleEvidence;
 return {...capture,publicationStatus:availability,assetFingerprintStatus:matched?'matched':fingerprinted?'stale':'unverified',currentPreviewCapture,
  portraitApprovedCurrentUnit:currentPreviewCapture&&capture.visualStandard==='portrait-match-v1',
  galleryStatus:availability==='withheld'?'withheld-archive':currentPreviewCapture?'current-preview':'archived-study',
  archiveReason:withheld?.reason||(!pixelsMatch?'Saved image differs from its original pixel fingerprint.':capture.duplicateRoleEvidence?'The same image was attributed to different unit roles.':availability==='unavailable'?'This faction has no enabled near/far preview pack.':!matched?'The original near/far model fingerprints are missing or no longer match.':!activeAssets?'The capture includes a model pack that is no longer enabled.':null),
  reviewEvidence:withheld?.evidence||null};
}
for(let i=0;i<captures.length;i++)captures[i]=await reviewCapture(captures[i]);
const current=captures.filter(capture=>capture.currentPreviewCapture),approved=captures.filter(capture=>capture.portraitApprovedCurrentUnit);
const statuses=Object.fromEntries(roster.map(faction=>[faction.id,{publicationStatus:factionAvailability(faction.id),reason:publication.withheld?.[faction.id]?.reason||null,evidence:publication.withheld?.[faction.id]?.evidence||null}]));
const metadata={edition:'roster-v3',kind:'Actual Three.js game screenshots, including preserved archives',updatedAt:new Date().toISOString(),factionStatuses:statuses,counts:{preserved:captures.length,currentPreview:current.length,archived:captures.length-current.length,portraitApprovedCurrentUnits:new Set(approved.map(capture=>capture.faction+'/'+capture.role)).size},captures};
await writeFile(join(destination,'captures.json'),JSON.stringify(metadata,null,2)+'\n');
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const figure=(capture,unit)=>`<figure data-status="${escape(capture.galleryStatus)}"><a href="${escape(capture.file)}" target="_blank"><img src="${escape(capture.file)}" loading="lazy" alt="${capture.currentPreviewCapture?'Current preview':'Archived in-game'} ${escape(unit.name)} capture"></a><figcaption><strong>${escape(unit.name)}</strong><small>${escape(capture.role.replaceAll('_',' '))} · ${capture.galleryStatus==='withheld-archive'?'Withheld archive':capture.currentPreviewCapture?'Matches enabled preview assets':'Archived study'}${capture.portraitApprovedCurrentUnit?' · Portrait review passed':' · Art approval pending'}</small>${capture.archiveReason?`<p class="capture-note">${escape(capture.archiveReason)}</p>`:''}</figcaption></figure>`;
const sections=roster.map(faction=>{
 const status=statuses[faction.id];
 return `<section id="${escape(faction.id)}"><h2>${escape(faction.name)}</h2>${status.publicationStatus==='withheld'?`<p class="withheld"><strong>Withheld from the battle preview.</strong> ${escape(status.reason)} The earlier full roster remains preserved. ${status.evidence?`<a href="${escape(relative(destination,join(root,status.evidence)).replaceAll('\\','/'))}">Review evidence</a>.`:''}</p>`:''}<div class="grid">${roles.map(role=>{
  const unit=[...faction.troops,...faction.siege].find(u=>u.id===role),saved=captures.filter(capture=>capture.faction===faction.id&&capture.role===role);
  return saved.length?saved.map(capture=>figure(capture,unit)).join(''):`<figure><div class="pending">${status.publicationStatus==='withheld'?'Withheld roster · screenshot not cataloged':'Screenshot pending'}</div><figcaption><strong>${escape(unit.name)}</strong><small>${escape(role.replaceAll('_',' '))} · ${status.publicationStatus==='withheld'?'Archived export; replacement in progress':'In progress'}</small></figcaption></figure>`;
 }).join('')}</div></section>`;
}).join('');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Peris · Unit screenshots</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#14271f;color:#e9dfc2;font:16px system-ui}header{position:sticky;top:0;z-index:2;background:#14271ff2;border-bottom:1px solid #5b6947;padding:16px 24px;display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap}header strong{letter-spacing:.15em;font-size:13px}select{background:#263b2c;color:#e9dfc2;border:1px solid #697858;padding:8px}a{color:#eed69a}main{max-width:1500px;margin:auto;padding:28px}h1,h2{font-family:Georgia;font-weight:400}h1{font-size:36px}h2{font-size:28px}p,small{color:#b7c0a1;line-height:1.5}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}figure{margin:0;background:#22392b;border:1px solid #637150;overflow:hidden}figure[data-status="withheld-archive"]{border-color:#ad8356}figure a{display:block}img{width:100%;display:block;aspect-ratio:1.6;object-fit:contain}figcaption{padding:12px}small{display:block;font-size:12px;margin-top:4px}.capture-note{font-size:12px;margin-bottom:0}.withheld{background:#3a3224;border:1px solid #ad8356;padding:14px}.pending{display:grid;place-items:center;aspect-ratio:1.6;background:#1a2e23;color:#819274}section{margin-top:38px;scroll-margin-top:100px}footer{padding-top:32px} @media(max-width:850px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.grid{grid-template-columns:1fr}main{padding:16px}}
</style></head><body><header><strong>PERIS · ACTUAL UNIT SCREENSHOTS</strong><label>Faction <select id="faction"><option value="all">All factions</option>${roster.map(r=>`<option value="${escape(r.id)}">${escape(r.name)}</option>`).join('')}</select></label><a href="/?battle-preview=1&unit-prototypes=1">Open battle preview</a></header><main><h1>In-game screenshots and preserved studies</h1><p>${captures.length} screenshots preserved. ${current.length} match enabled preview assets; ${captures.length-current.length} are archived studies. ${metadata.counts.portraitApprovedCurrentUnits} current units have passed the portrait review. Enabled exports remain visual prototypes until they pass that review. Each saved image came from the Three.js renderer at its recorded checkpoint; archived images may show models that are no longer enabled. Click an image for full resolution. Portrait cards are concept illustrations.</p>${sections}<footer><p>Models adapted from 0 A.D. artwork by <a href="https://wildfiregames.com/">Wildfire Games</a>, with original Peris equipment and fantasy additions, under <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>. <a href="../../index.html">Sources and production notes</a>. Siege and Academy/Workshop progression remain design studies.</p></footer></main><script>const select=document.querySelector('#faction');function choose(value){select.value=value;for(const section of document.querySelectorAll('section'))section.hidden=value!=='all'&&section.id!==value;}select.addEventListener('change',()=>{location.hash=select.value;choose(select.value);});const initial=location.hash.slice(1);if([...select.options].some(o=>o.value===initial))choose(initial);</script></body></html>`;
await writeFile(join(destination,'index.html'),html);
console.log(JSON.stringify({destination,captures:captures.length,total:roster.length*roles.length,counts:metadata.counts,withheld:Object.keys(publication.withheld||{})}));

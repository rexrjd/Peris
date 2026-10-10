import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const catalog=await read('assets/references/units/catalog.json');
const inventory=await read('assets/references/units/0ad/inventory-roster-v3.json');
const published=await read('public/models/battle/faction-rosters.json');
const roster=await read('assets/concepts/faction-sheets-v1/expanded-rosters.json');
let screenshots={captures:[]};
try{screenshots=await read('assets/references/units/previews/roster-v3/captures.json');}catch(error){if(error.code!=='ENOENT')throw error;}
const withheld=Object.keys(published.withheld||{});
const factions=Object.keys(published.factions).filter(faction=>!withheld.includes(faction)&&published.factions[faction]?.near&&published.factions[faction]?.far);
const retained=withheld.filter(faction=>published.withheld[faction]?.retained?.near&&published.withheld[faction]?.retained?.far);
const exported=roster.roster.map(faction=>faction.id).filter(faction=>factions.includes(faction)||retained.includes(faction));
const hashes=new Map();
async function fingerprint(path){
 if(!hashes.has(path)){
  try{hashes.set(path,createHash('sha256').update(await readFile(path)).digest('hex'));}
  catch(error){if(error.code!=='ENOENT')throw error;hashes.set(path,null);}
 }
 return hashes.get(path);
}
export async function currentCapture(capture){
 if(!factions.includes(capture.faction)||capture.duplicateRoleEvidence)return false;
 if(!/^[a-z0-9_-]+\.png$/.test(capture.file)||await fingerprint('assets/references/units/previews/roster-v3/'+capture.file)!==capture.pixelSHA256)return false;
 const assets=capture.assets||[];
 if(!['','-lod'].every(suffix=>assets.some(asset=>asset.file===`${capture.faction}-roster${suffix}.glb`&&/^[a-f0-9]{64}$/.test(asset.sha256))))return false;
 for(const asset of assets){
  if(!/^[a-z]+-roster(?:-lod)?\.glb$/.test(asset.file)||!factions.includes(asset.file.split('-roster')[0])||await fingerprint('public/models/battle/'+asset.file)!==asset.sha256)return false;
 }
 return true;
}
const current=[];
for(const capture of screenshots.captures)if(await currentCapture(capture))current.push(capture);
// Recheck availability and fingerprints rather than trusting a saved approval
// field after a pack is withdrawn or rebuilt. Historical evidence stays saved.
const finished=current.filter(capture=>capture.visualStandard==='portrait-match-v1');
const reviewedFactions=factions.filter(faction=>published.roles.every(role=>finished.some(capture=>capture.faction===faction&&capture.role===role)));
const complete=reviewedFactions.length===roster.roster.length;
catalog.purpose='Research, licensed sources, editable models and actual in-game review for all Peris faction troop and siege graphics.';
catalog.sourcePack.previousInventory=catalog.sourcePack.previousInventory||'0ad/inventory.json';
catalog.sourcePack.inventory='0ad/inventory-roster-v3.json';
catalog.sourcePack.files=inventory.files.length;
catalog.sourcePack.bytes=inventory.files.reduce((sum,file)=>sum+file.bytes,0);
catalog.sourcePack.familyCatalog='roster-sources-v3.json';
catalog.rosterPrototypes={
 status:complete?'All eleven faction rosters have passed the visual review in the game.':'Faction rosters are being revised and reviewed in the game. Exported models may still require visual corrections.',
 edition:published.edition,factionsExported:exported,factionsEnabled:factions,factionsWithheld:withheld,factionsReady:reviewedFactions,totalFactions:roster.roster.length,roles:published.roles,
 unitsExported:exported.length*published.roles.length,unitsEnabled:factions.length*published.roles.length,unitsWithheld:retained.length*published.roles.length,
 unitsReady:new Set(finished.map(capture=>capture.faction+'/'+capture.role)).size,
 screenshotsReady:new Set(current.map(capture=>capture.faction+'/'+capture.role)).size,
 screenshotsCurrent:current.length,screenshotsPreserved:screenshots.captures.length,screenshotsArchived:screenshots.captures.length-current.length,
 withheld:published.withheld||{},
 countDefinitions:{unitsExported:'Complete exported roles retained locally, including withheld archives.',unitsEnabled:'Roles in complete near/far packs currently enabled for the battle preview; this is not art approval.',unitsReady:'Distinct enabled roles with matching model/image fingerprints and an explicit portrait-match-v1 review.',screenshotsReady:'Distinct roles with screenshots whose image and complete near/far model fingerprints match enabled preview assets.',screenshotsPreserved:'All saved screenshot records, including historical, unverified and withheld studies.'},
 visualStandard:'portrait-match-v1: unique role silhouette, equipment, materials, anatomy and pose matched to each unit portrait',
 visualReviewCriteria:[
  'Recognizable race anatomy and silhouette from the battle camera, including faces and exposed racial features.',
  'Distinct faction equipment and materials across all nine roles; fantasy units must not read as recolored historical soldiers.',
  'Readable role weapons, scout and heavy cavalry differences, and siege identity.',
  'Riders seated on the mount with supported legs, stable proportions and coherent saddle equipment.',
  'Current model fingerprints match every published actual game screenshot.'
 ],
 previewUrl:'/?battle-preview=1&unit-prototypes=1',screenshotGallery:'previews/roster-v3/index.html',
 editableSourcePattern:`assets/source/battle/${published.edition}/peris-<faction>-army.blend`,
 assetPattern:'public/models/battle/<faction>-roster.glb',distantAssetPattern:'public/models/battle/<faction>-roster-lod.glb',
 publicationReport:'public/models/battle/faction-rosters.json',credits:'public/licenses/peris-faction-rosters.txt',
 rebuildOrder:[
  'node scripts/fetch-roster-references.mjs',
  'python scripts/convert-reference-textures.py --inventory inventory-roster-v3.json',
  'blender --background --python scripts/blender/cache_reference_imports.py -- --inventory inventory-roster-v3.json',
  'blender --background --python scripts/blender/build_faction_rosters.py -- --edition roster-next --factions roman spartan persian egyptian orc elf dwarf gnome pandaren undead demon',
  "PowerShell: $env:PERIS_ROSTER_EDITION='roster-next'",
  'node scripts/prepare-faction-rosters.mjs'
 ],
 preservation:'The source builder refuses to overwrite a previous edition. Packed editable sources, earlier runtime packs and historical screenshot records remain preserved. Withheld exports cannot count as enabled previews or portrait-approved current units.',
 limitations:'These are visual prototypes. Seven troop looks use existing infantry, archer and cavalry combat rules. Rams, catapults and fantasy stonehurlers are inspection models. Academy research and Workshop recruitment remain design plans. Screenshot FPS is a capture statistic, not a sustained performance measurement.'
};
catalog.status=catalog.rosterPrototypes.status;
catalog.prototypes.status='Earlier two-unit licensed reference trial; its editable source and exports remain preserved.';
catalog.prototypes.previewUrl='/?battle-preview=1&unit-prototypes=1&faction=roman';
catalog.prototypes.limitations='The recorded performance concerns the earlier two-unit trial. See rosterPrototypes for the complete faction production and current review.';
await writeFile('assets/references/units/catalog.json',JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({factionsEnabled:factions.length,factionsExported:exported.length,factionsWithheld:withheld,unitsEnabled:catalog.rosterPrototypes.unitsEnabled,unitsExported:catalog.rosterPrototypes.unitsExported,screenshotsCurrent:current.length,screenshotsPreserved:screenshots.captures.length,sourceFiles:inventory.files.length,sourceBytes:catalog.sourcePack.bytes}));

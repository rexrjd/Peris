import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { FIELD_W,FIELD_H,FIELD_SCALE } from '../src/features/battle/domain/dimensions';
import { BATTLE_TERRAINS,battleTerrainFor,battleTerrainAtWorld,terrainAt } from '../src/features/battle/domain/terrain';
import { generateBanditCamps,BANDIT_CAMPS } from '../src/features/map/domain/bandits';
import { getCell,isHistoricStartingField } from '../src/features/map/domain/worldGrid';
import { wrapWorldCell,wrappedCellDistance,CELL_SIZE } from '../src/features/map/domain/dimensions';
import { FACTIONS } from '../src/features/factions/domain/factions';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { validateSave } from '../src/platform/storage/saves';
import { normalizeRealm } from '../src/features/empire/domain/normalization';
import { beginRaid } from '../src/features/campaign/domain/raids';
import { settleBattle } from '../src/features/campaign/domain/battleSettlement';
import { finishBattle } from '../src/features/battle/domain/resolution';
import { conquered,nextCampaign,readiness } from '../src/features/campaign/domain/progression';
import { heroPortraitUrl } from '../src/features/heroes/domain/portraits';

test('five times the area retains soldier scale and connected terrain footprints',()=>{
 assert.ok(Math.abs(FIELD_W*FIELD_H/(1200*700)-5)<1e-12);
 assert.equal(terrainAt('river',600*FIELD_SCALE,350*FIELD_SCALE).speed,1);
 assert.equal(terrainAt('river',600*FIELD_SCALE,10*FIELD_SCALE).speed,.42);
 assert.equal(terrainAt('woods',525*FIELD_SCALE,185*FIELD_SCALE).cover,.6);
 const expected={grassland:'plains',forest:'woods',mountain:'highlands',river:'river',farmland:'farmland',desert:'desert',snow:'snow',marsh:'marsh',coast:'coast',darkland:'darkland',water:'coast'} as const;
 for(const [field,terrain]of Object.entries(expected))assert.equal(battleTerrainFor(field as keyof typeof expected),terrain);
});
test('seeded camps span the realm with moderate density, all races and varied armies',()=>{
 assert.deepEqual(generateBanditCamps(),BANDIT_CAMPS);assert.notDeepEqual(generateBanditCamps(42),BANDIT_CAMPS);
 assert.ok(BANDIT_CAMPS.length>300&&BANDIT_CAMPS.length<650);
 assert.equal(new Set(BANDIT_CAMPS.map(c=>c.id)).size,BANDIT_CAMPS.length);
 assert.equal(new Set(BANDIT_CAMPS.map(c=>c.faction)).size,Object.keys(FACTIONS).length);
 assert.ok(BANDIT_CAMPS.filter(c=>c.tier<=2).length>BANDIT_CAMPS.length*.6);
 const positions=new Set<string>();
 for(const camp of BANDIT_CAMPS){const cell=wrapWorldCell(Math.floor(camp.x/CELL_SIZE),Math.floor(camp.y/CELL_SIZE));assert.notEqual(getCell(cell.col,cell.row).terrain,'water');assert.equal(isHistoricStartingField(cell.col,cell.row),false);assert.equal(camp.terrain,battleTerrainAtWorld(camp.x,camp.y));assert.ok(!positions.has(`${cell.col},${cell.row}`));positions.add(`${cell.col},${cell.row}`);assert.ok(camp.infantry>0&&camp.archers>0&&camp.cavalry>=0);}
 for(let i=0;i<BANDIT_CAMPS.length;i++)for(let j=i+1;j<BANDIT_CAMPS.length;j++){const a=BANDIT_CAMPS[i],b=BANDIT_CAMPS[j];assert.ok(wrappedCellDistance({col:Math.floor(a.x/128),row:Math.floor(a.y/128)},{col:Math.floor(b.x/128),row:Math.floor(b.y/128)})>=3);}
});
test('old six-site saves gain camps once and remain importable with battles in every biome',()=>{
 const w=createSolo('Rex');w.camps=w.camps.filter(c=>!c.bandit);const before=structuredClone(w.settlements);normalizeRealm(w);const n=w.camps.length;normalizeRealm(w);assert.equal(w.camps.length,n);assert.deepEqual(w.settlements,before);
 for(const terrain of BATTLE_TERRAINS){const copy=structuredClone(w);beginRaid(copy,'solo-ruler',copy.camps.find(c=>c.bandit)!.id,()=>100);copy.battles[0].terrain=terrain;const imported=validateSave(copy);assert.equal(imported.battles[0].terrain,terrain);assert.ok(imported.camps.length>6);}
});
test('bandit victories grant hero XP once, regroup for ten minutes, and do not recover campaign standards',()=>{
 const w=createSolo('Rex'),camp=w.camps.find(c=>c.bandit)!,owner='solo-ruler';let id=10000;
 beginRaid(w,owner,camp.id,()=>++id);const b=w.battles[0];assert.equal(b.defender_faction,camp.faction);assert.equal(b.terrain,battleTerrainAtWorld(camp.x,camp.y));
 w.formations.filter(f=>f.side==='defender').forEach(f=>{f.soldiers=0;f.status='routed';});finishBattle(b,w.formations,'attacker','Army routed');
 settleBattle(w,b.id,owner,()=>++id);const xp=w.heroes![0].experience;assert.equal(xp,(camp.infantry+camp.archers+camp.cavalry)*2+50);assert.equal(conquered(w,owner).size,0);assert.equal(nextCampaign(w,owner)?.id,1);assert.ok(Date.parse(w.progress[0].available_at)-Date.now()>599000);assert.ok(readiness(w,owner,camp).ratio>0);
 settleBattle(w,b.id,owner,()=>++id);assert.equal(w.heroes![0].experience,xp);assert.equal(w.reports.length,1);
});
test('ten original portraits ship and every faction marker resolves to its commander artwork',()=>{
 const manifest=JSON.parse(readFileSync('assets/hero-portraits.json','utf8'));assert.equal(manifest.portraits.length,10);
 for(const item of manifest.portraits){assert.ok(existsSync(item.file));assert.equal(readFileSync(item.file).subarray(0,8).toString('hex'),'89504e470d0a1a0a');}
 for(const faction of Object.keys(FACTIONS) as (keyof typeof FACTIONS)[]){const url=heroPortraitUrl(faction);assert.ok(url.startsWith('data:image/svg+xml,')||existsSync(`public/${url}`));}
});


test('campaign imports reject invalid bandit races and troop counts',()=>{
 const w=createSolo('Rex'),camp=w.camps.find(c=>c.bandit)!;
 (camp as any).faction='dragon';assert.throws(()=>validateSave(w),/valid Peris/);
 camp.faction='elf';camp.infantry=-1;assert.throws(()=>validateSave(w),/valid Peris/);
});
test('new camps respect an existing city across the wrapped map seam',()=>{
 const w=createSolo('Rex'),camp=BANDIT_CAMPS.find(c=>Math.floor(c.x/128)===-100)!;assert.ok(camp);
 w.camps=w.camps.filter(c=>!c.bandit);w.settlements[0].x=camp.x+25600-128;w.settlements[0].y=camp.y;normalizeRealm(w);
 assert.ok(!w.camps.some(c=>c.id===camp.id));
});

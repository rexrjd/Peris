import { seeded } from '../../../shared/math/random';
import { FACTIONS, type Faction } from '../../factions/domain/factions';
import { battleTerrainAtWorld } from '../../battle/domain/terrain';
import { getCell, isHistoricStartingField } from './worldGrid';
import { WORLD_MAP_SEED, CELL_SIZE, wrappedCellDistance } from './dimensions';
import { CAMPS } from './camps';
import type { Camp } from './types';
/** One seeded camp per 8×8 sector, with jitter and protected village rings.
 * Stable IDs keep multiplayer, existing progress and imported saves in agreement. */
export function generateBanditCamps(seed=WORLD_MAP_SEED): Camp[] {
    const camps:Camp[]=[], races=Object.keys(FACTIONS) as Faction[];
    const historic=CAMPS.map(c=>({col:Math.floor(c.x/CELL_SIZE),row:Math.floor(c.y/CELL_SIZE)}));
    for(let row=0;row<25;row++)for(let col=0;col<25;col++){
        const id=1000+row*25+col, rng=seeded(seed+id*7919);
        for(let attempt=0;attempt<32;attempt++){
            const c=-100+col*8+Math.floor(rng()*8),r=-100+row*8+Math.floor(rng()*8);
            const cm=(c+298)%4,rm=(r+298)%4;
            if((cm!==2&&rm!==2)||getCell(c,r).terrain==='water'||isHistoricStartingField(c,r)||historic.some(h=>wrappedCellDistance(h,{col:c,row:r})<=2)||camps.some(h=>wrappedCellDistance({col:Math.floor(h.x/CELL_SIZE),row:Math.floor(h.y/CELL_SIZE)},{col:c,row:r})<3))continue;
            const faction=races[Math.floor(rng()*races.length)],roll=rng(),tier=1+[.25,.45,.60,.72,.82,.88,.93,.96,.985].filter(n=>roll>=n).length;
            const total=Math.round(([0,30,50,80,120,180,260,360,480,610,720][tier])*(.92+rng()*.16));
            const archers=Math.floor(total*(.15+rng()*.25)),cavalry=Math.floor(total*rng()*(tier<=2?.1:.3));
            const x=(c+.5)*CELL_SIZE,y=(r+.5)*CELL_SIZE;
            camps.push({id,bandit:true,faction,name:`${FACTIONS[faction].name} ${['outpost','raider camp','war camp','stronghold'][tier<=2?0:tier<=5?1:tier<=8?2:3]}`,x,y,tier,terrain:battleTerrainAtWorld(x,y),infantry:total-archers-cavalry,archers,cavalry,description:`Level ${tier} camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.`});break;
        }
    }
    return camps;
}
export const BANDIT_CAMPS=generateBanditCamps();
export const recommendedHost=(camp:Camp)=>Math.ceil((camp.infantry+camp.archers+camp.cavalry)*1.25);
export const campCooldown=(camp:Camp)=>camp.bandit?600000:120000;

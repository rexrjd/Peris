import type { Terrain } from './types';
import type { FieldTerrain } from '../../map/domain/worldGrid';
import { getCell } from '../../map/domain/worldGrid';
import { CELL_SIZE } from '../../map/domain/dimensions';
import { FIELD_SCALE } from './dimensions';
export const BATTLE_TERRAINS: Terrain[] = ['plains','woods','highlands','river','farmland','desert','snow','marsh','coast','darkland'];
export const GROUND_COLORS: Record<Terrain,string> = { plains:'#76825a',woods:'#586b48',highlands:'#85847d',river:'#748565',farmland:'#ad9868',desert:'#c9a673',snow:'#c9d3dd',marsh:'#647c70',coast:'#c8b58c',darkland:'#514c59' };
export function battleTerrainFor(field: FieldTerrain): Terrain {
    return field === 'forest' ? 'woods' : field === 'mountain' ? 'highlands' : field === 'grassland' ? 'plains' : field === 'water' ? 'coast' : field;
}
export function battleTerrainAtWorld(x: number,y: number): Terrain { return battleTerrainFor(getCell(Math.floor(x/CELL_SIZE),Math.floor(y/CELL_SIZE)).terrain); }
/** All renderers and combat sample the same scaled terrain footprints. */
export function terrainAt(terrain: Terrain, x: number, y: number): { kind:string; speed:number; cover:number; height:number } {
    x/=FIELD_SCALE; y/=FIELD_SCALE;
    if (terrain === 'woods' && ((x>260&&x<650&&y>45&&y<315)||(x>660&&x<1040&&y>405&&y<665))) return {kind:'Forest',speed:.68,cover:.6,height:0};
    if (terrain === 'highlands' && ((x-650)**2/240**2+(y-285)**2/180**2<1)) return {kind:'High ground',speed:.85,cover:1,height:1};
    if (terrain === 'river' && Math.abs(x-(600+Math.sin(y/110)*32))<42&&(y<306||y>395)) return {kind:'Shallows',speed:.42,cover:1,height:0};
    if (terrain === 'marsh' && Math.sin(x/95)+Math.cos(y/70)>.3) return {kind:'Marsh',speed:.62,cover:.9,height:0};
    return {kind:({desert:'Sand',snow:'Snow',coast:'Coastal ground',darkland:'Volcanic ground',farmland:'Farmland'} as Partial<Record<Terrain,string>>)[terrain]??'Open ground',speed:terrain==='snow'?.88:terrain==='desert'?.9:1,cover:1,height:0};
}

import type { Faction } from '../../factions/domain/factions';
import { cityBoundary, paintedBoundaryPaths } from './paintedLayout';
import type { CityEnvironment } from '../domain/environment';

export type VillagePatrolRoute = { path: string; surface: 'wall' | 'lane' };

/** Feet remain on a cleared work pad, in the wheat, or on the fishery bridge. */
export const VILLAGE_WORK_AREAS = {
    lumber: { x: 67, y: 558, width: 72, height: 30 },
    quarry: { x: 954, y: 303, width: 74, height: 32 },
    farm: { x: 485, y: -30, width: 68, height: 28 },
    fishery: { x: 910, y: 635, width: 0, height: 0 },
} as const;

function arc(from: number, to: number, rx: number, ry: number): string {
    return Array.from({length:33},(_,i)=>{
        const angle=(from+(to-from)*i/32)*Math.PI/180;
        return `${i?'L':'M'}${(500+Math.cos(angle)*rx).toFixed(2)} ${(345+Math.sin(angle)*ry).toFixed(2)}`;
    }).join('');
}

/** Open routes reverse direction at their ends. No route crosses the gate opening. */
export function villagePatrolRoutes(faction: Faction, environment?:CityEnvironment): VillagePatrolRoute[] {
    const boundary=cityBoundary(faction,environment);
    if(environment){
        const sides=paintedBoundaryPaths(faction,environment),lane=['timber','bamboo','living','bone'].includes(boundary.material);
        // Ground patrols use a separately cleared western lane; masonry guards use the actual wall.
        return lane?[{path:'M125 190Q90 345 125 520',surface:'lane'},{path:'M125 535Q140 585 180 610',surface:'lane'}]:[{path:sides.west,surface:'wall'},{path:sides.east,surface:'wall'}];
    }
    if(['timber','bamboo','living','bone'].includes(boundary.material)) {
        const living=boundary.material==='living';
        // The western lanes stay away from the river and fishing shore to the east.
        return [arc(-100,-175,living?397:374,living?315:294),arc(-187,-240,living?397:374,living?315:294)].map(path=>({path,surface:'lane'}));
    }
    const paths=boundary.shape==='square' ? ['M440 60H220V585','M560 60H780V585']
        : boundary.shape==='rounded' ? ['M440 65H285Q195 65 195 160V535Q195 615 280 615H440','M560 65H715Q805 65 805 160V535Q805 615 720 615H560']
        : boundary.shape==='hexagon' ? ['M440 61H295L175 250V453L295 619H440','M560 61H705L825 250V453L705 619H560']
        : ['M440 58H295L180 171V510L295 621H440','M560 58H705L820 171V510L705 621H560'];
    return paths.map(path=>({path,surface:'wall'}));
}

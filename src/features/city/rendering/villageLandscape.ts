import { FACTIONS, type Faction } from '../../factions/domain/factions';
import { PAINTED_CITY, cityBoundary, type PaintedCityPlot } from './paintedLayout';
import { cityColor, VILLAGE_ROADS, villageWallSvg } from './villageDecoration';
import { VILLAGE_WORK_AREAS, villagePatrolRoutes } from './villageWalkways';
import type { CityEnvironment } from '../domain/environment';
import { cityBiome } from './cityBiome';
import { terrainColor, villageCountrysideSvg } from './villageCountryside';

export const VILLAGE_LANDSCAPE_URL='/art/city/village-v1/countryside-simple.webp';

/** Original painted scenery is clipped away from cleared ground and work/patrol lanes. */
export function villageLandscapeSvg(faction:Faction,wallLevel:number,plots:PaintedCityPlot[],id:string,environment?:CityEnvironment):string {
    const p=FACTIONS[faction],c=cityColor,b=cityBoundary(faction,environment),routes=wallLevel>0?villagePatrolRoutes(faction,environment):[];
    const biome=cityBiome(faction,environment);
    const transform=`translate(${PAINTED_CITY.offsetX} ${PAINTED_CITY.offsetY})`;
    const pads=Object.entries(VILLAGE_WORK_AREAS).filter(([key])=>key!=='fishery'&&plots.some(plot=>plot.key===key&&plot.level>0));
    const padMarkup=pads.map(([key,a])=>`<rect data-walkable="work-pad" data-work-source="${key}" x="${a.x-18}" y="${a.y-9}" width="${a.width}" height="${a.height}" rx="8" fill="${key==='quarry'?c(p.stone):c(p.earth)}" opacity=".65"/>`).join('');
    const insideRoads=plots.filter(plot=>plot.slot!==undefined&&plot.slot<16).map(plot=>`<path d="M500 345Q${(500+plot.x)/2} ${plot.y+18} ${plot.x} ${plot.y}" stroke-width="8" opacity=".65"/>`).join('');
    const dockBuilt=plots.some(plot=>plot.key==='fishery'&&plot.level>0);
    const roadClearings=environment?[VILLAGE_ROADS.entrance,VILLAGE_ROADS.north].map(path=>`<path d="${path}" fill="none" stroke="black" stroke-width="56" stroke-linecap="round"/>`).join(''):'';
    return `<defs><mask id="${id}-scenery"><rect width="1200" height="900" fill="white"/><g transform="${transform}"><path d="${b.path}" fill="black" stroke="black" stroke-width="22"/>${roadClearings}${routes.filter(r=>r.surface==='lane').map(r=>`<path d="${r.path}" fill="none" stroke="black" stroke-width="26" stroke-linecap="round"/>`).join('')}${pads.map(([,a])=>`<rect x="${a.x-24}" y="${a.y-18}" width="${a.width+12}" height="${a.height+18}" rx="14" fill="black"/>`).join('')}</g></mask><clipPath id="${id}-inside"><path d="${b.path}"/></clipPath><pattern id="${id}-earth" width="300" height="300" patternUnits="userSpaceOnUse"><image href="/art/shared/meadow-ground.png" width="300" height="300" opacity=".12"/></pattern></defs>
    <rect width="1200" height="900" fill="${environment?terrainColor(biome.ground):'#9caa64'}"/>${environment?`<g mask="url(#${id}-scenery)">${villageCountrysideSvg(faction,environment,plots,id)}</g>`:`<image href="${VILLAGE_LANDSCAPE_URL}" width="1200" height="900" mask="url(#${id}-scenery)"/>`}
    <g transform="${transform}"><path data-walkable="court" d="${b.path}" fill="${environment?terrainColor(biome.ground):c(p.ground)}" opacity=".45"/>${environment?'':`<path d="${b.path}" fill="url(#${id}-earth)"/>`}
    <g fill="none" stroke="${c(p.road)}" stroke-linecap="round"><path data-city-road="gate-entrance" d="${VILLAGE_ROADS.entrance}" stroke-width="20"/><path data-city-road="north-gate" d="${VILLAGE_ROADS.north}" stroke-width="14"/>
    <g data-city-road="inside" clip-path="url(#${id}-inside)"><ellipse cx="500" cy="345" rx="198" ry="133" stroke-width="13" opacity=".6"/>${insideRoads}</g></g>
    ${routes.map(r=>`<path data-walkable="${r.surface}" d="${r.path}" fill="none" stroke="${r.surface==='lane'?c(p.road):'transparent'}" stroke-width="${r.surface==='lane'?19:20}" stroke-linecap="round" opacity=".75"/>`).join('')}
    ${padMarkup}
    ${dockBuilt?`<g data-fishing-bridge="true"><path data-walkable="dock" d="M805 635H1010" stroke="${c(p.wood)}" stroke-width="24"/><path d="M805 635H1010" stroke="${c(p.timber)}" stroke-width="20"/>${Array.from({length:35},(_,i)=>`<path d="M${805+i*6} 626v18" stroke="${c(p.wood)}" stroke-width="1.2"/>`).join('')}<path d="M805 623H1010M805 647H1010" stroke="${c(p.wood)}" stroke-width="2"/>${[811,860,910,960,1005].map(x=>`<path d="M${x} 616v10M${x} 644v9" stroke="${c(p.wood)}" stroke-width="3"/>`).join('')}</g>`:''}
    ${villageWallSvg(faction,wallLevel,id,environment)}
    </g>${environment?'':`<g class="painted-city-water" fill="none" stroke="#d0e7d6" stroke-width="1.5" stroke-dasharray="10 24" opacity=".4"><path d="M1085 740q38 15 80 0M1082 785q35 14 81-2M1120 605q32 10 62 0"/></g>`}`;
}

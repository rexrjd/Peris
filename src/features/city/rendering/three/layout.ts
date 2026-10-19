import type { BuildingType } from '../../domain/types';
import { cityGrowth, slotCount, type CitySlot, type SlotType } from '../../domain/slots';
import { cityPlotPosition, cityRandom, type CityEnvironment } from '../../domain/environment';
export type CityPlot = { key:string; type:BuildingType|SlotType|null; x:number; z:number; radius:number; level:number; slot?:number };
export const CITY_PLOTS = [
 {type:'wall' as const,x:-.4,z:-9,radius:2.25},
 {type:'market' as const,x:0,z:-6,radius:2.2},
 {type:'lumber' as const,x:-12,z:-4,radius:1.9},
 {type:'quarry' as const,x:13,z:-4,radius:1.9},
 {type:'farm' as const,x:-12,z:5,radius:2},
];
export const riverX = (z:number, environment?:CityEnvironment) => environment
 ? 9 + Math.sin(z * (.09+cityRandom(environment,2)*.08)+cityRandom(environment,3)*Math.PI*2) * (.16+cityRandom(environment,4)*.12+Math.min(2.8,Math.max(0,Math.abs(z)-25)*.06))
 : 9.3 + Math.sin(z * .44) * .3;
/** A shore sweeps around the working yards and meets the reserved fishing landing. */
export function cityShoreX(z:number, main:number, environment:CityEnvironment) {
 const f=cityFootprint(main,environment);
 return riverX(f.fishingZ,environment)-.55+Math.min(35,Math.max(0,f.fishingZ-z)**2*1.6)+Math.sin((z-f.fishingZ)*.12)*.35;
}
/** Bounds in landscape coordinates; reserve an open street beyond the last plot row. */
export function cityFootprint(main:number, environment?:CityEnvironment) {
 const level=Math.max(0,Math.min(5,main)),rows=Math.ceil(slotCount(level)/4);
 const lastRow=-2+(rows-1)*4;
 const front=Math.max(11,lastRow+3.8)+level*.1+(environment?cityRandom(environment,5)*1.2:0);
 return {left:-8.8-(environment?cityRandom(environment,6)*.45:0),right:10.6,back:-9,front,outsideRoad:front+2,fishingZ:front+3.5};
}
export function cityLayout(levels:Record<string,number>, slots:CitySlot[], environment?:CityEnvironment):CityPlot[] {
 const growth=cityGrowth(levels.market??0),footprint=cityFootprint(levels.market??0,environment);
 const fixed:CityPlot[]=CITY_PLOTS.map(p=>({...p,key:p.type,x:p.x*growth,z:p.z*growth,level:levels[p.type]??0}));
 const fishing=slots.find(s=>s.slot_index===16);
 if(!environment||environment.water!=='none'||fishing)fixed.push({key:'fishery',type:'fishery',slot:16,level:fishing?.level??0,x:riverX(footprint.fishingZ,environment)*growth,z:footprint.fishingZ*growth,radius:1.6});
 return [...fixed,...Array.from({length:slotCount(levels.market??0)},(_,index)=>{
  const slot=slots.find(s=>s.slot_index===index);
  const position=cityPlotPosition(index,environment);
  return {key:`slot:${index}`,slot:index,type:slot?.building_type??null,level:slot?.level??0,x:[-6,-2,2,6.2][position%4]*growth,z:(-2+Math.floor(position/4)*4)*growth,radius:1.5};
 })];
}

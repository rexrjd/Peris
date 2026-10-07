import type { BuildingType } from '../../domain/types';
import { cityGrowth, slotCount, type CitySlot, type SlotType } from '../../domain/slots';
export type CityPlot = { key:string; type:BuildingType|SlotType|null; x:number; z:number; radius:number; level:number; slot?:number };
export const CITY_PLOTS = [
 {type:'wall' as const,x:-.4,z:-9,radius:2.25},
 {type:'market' as const,x:0,z:-6,radius:2.2},
 {type:'lumber' as const,x:-12,z:-4,radius:1.9},
 {type:'quarry' as const,x:13,z:-4,radius:1.9},
 {type:'farm' as const,x:-12,z:5,radius:2},
];
export function cityLayout(levels:Record<string,number>, slots:CitySlot[]):CityPlot[] {
 const growth=cityGrowth(levels.market??0);
 const fixed:CityPlot[]=CITY_PLOTS.map(p=>({...p,key:p.type,x:p.x*growth,z:p.z*growth,level:levels[p.type]??0}));
 const fishing=slots.find(s=>s.slot_index===16);
 fixed.push({key:'fishery',type:'fishery',slot:16,level:fishing?.level??0,x:8.8*growth,z:14*growth,radius:1.6});
 return [...fixed,...Array.from({length:slotCount(levels.market??0)},(_,index)=>{
  const slot=slots.find(s=>s.slot_index===index);
  return {key:`slot:${index}`,slot:index,type:slot?.building_type??null,level:slot?.level??0,x:[-6,-2,2,6.2][index%4]*growth,z:(-2+Math.floor(index/4)*4)*growth,radius:1.5};
 })];
}

import {createAcademy} from './academy';
import {createMarket} from './market';
import type {Faction} from '../../../factions/domain/factions';
import type { SlotType } from '../../domain/slots';
import { createBuildingModel } from './buildingModels';
import {createMageTower} from './mageTower';
import { cityKit } from './modelKit';
import { createCityBarracks } from './barracks';
import { createCityWorkplace } from './cityWorkplaces';
export function createSlotModel(type:SlotType|null,level:number,faction:Faction='roman', animated=false) {
 if(type==='bazaar')return createMarket(level,faction,animated);
 if(!type || !level)return createBuildingModel('barracks',0,faction);
 if(type==='academy')return createAcademy(level,faction,animated);
 if(type==='mage_tower')return createMageTower(level,faction,animated);
 if(type==='smithy'||type==='warehouse'||type==='granary')return createCityWorkplace(type,level,faction,animated);
 if(type==='barracks')return createCityBarracks(level,faction,animated);
 if(type==='stables')return createBuildingModel(type,level,faction,animated);
 const k=cityKit(faction,animated),{m,box,cylinder,house}=k;
 if(type==='housing'){
  house(0,-.1,1.15,.9,.55+level*.13,level>=3);
  if(level>=2)house(-.85,.15,.55,.65,.55+level*.08,level>=3,m.roofLight);
  if(level>=3)house(.85,.15,.55,.65,.55+level*.08,true,m.slate);
  if(level>=4){k.fence(0,.85,2.35);box(.22,.7,.22,-.3,0,-.3,m.darkStone);}
  if(level>=5){house(0,-.8,1,.55,1.25,true);k.flag(0,1.8,-.8,.6);}
 } else if(type==='workshop') {
  house(-.4,-.35,1.35,.85,.7+level*.06,level>=3,m.slate);
  // Siege workshop: a wheeled timber ram and a visibly growing catapult yard.
  box(.85,.08,.45,.25,.25,.7,m.wood);
  const ram=cylinder(.1,.8,.25,.3,.7,m.timber);ram.rotation.z=Math.PI/2;
  for(const x of [-.1,.6])for(const z of [.42,.97]){const wheel=cylinder(.14,.06,x,.04,z,m.dark);wheel.rotation.x=Math.PI/2;}
  if(level>=2){
   box(.6,.09,.5,.9,.16,-.35,m.wood);box(.07,.55,.07,.9,.25,-.35,m.timber);
   const beam=box(.08,.8,.07,.9,.4,-.35,m.wood);beam.rotation.z=-.55;
   box(.25,.07,.25,.68,1.05,-.35,m.timber);
   for(const x of [.65,1.15])for(const z of [-.62,-.08]){const wheel=cylinder(.12,.06,x,.05,z,m.dark);wheel.rotation.x=Math.PI/2;}
  }
  if(level>=3)for(let i=0;i<4;i++)box(.22,.18,.22,-1.1+i*.24,0,.8,m.stone);
  if(level>=4){box(.08,1.4,.08,-1.2,0,-.55,m.wood);box(.8,.08,.08,-.85,1.3,-.55,m.timber);}
  if(level>=5)k.flag(-.4,1.7,-.35,.7);
 } else {
  house(-.45,-.3,.65,.75,.65,level>=3,m.slate);
  const width=1.2+level*.13;
  for(let i=0;i<7;i++)box(width,.075,.13,.7,.12,-.45+i*.18,m.timber);
  for(const x of [.3,1.2])for(const z of [-.45,.65])cylinder(.045,.4,x,0,z,m.wood);
  for(let i=0;i<level;i++){box(.2,.2,.2,-.5+i*.2,0,.65,m.wood);}
  if(level>=2) {box(.035,.8,.035,1.1,.2,.1,m.wood);k.motion(box(.65,.035,.035,.9,1,.1,m.timber,-.2),'fishing');}
  if(level>=4)k.fence(.7,.85,width);
  if(level>=5)k.flag(-.4,1,-.3);
 }
 k.heraldry(level);return k.finish();
}

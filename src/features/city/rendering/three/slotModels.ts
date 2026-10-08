import type {Faction} from '../../../factions/domain/factions';
import type { SlotType } from '../../domain/slots';
import { createBuildingModel } from './buildingModels';
import {createMageTower} from './mageTower';
import { cityKit } from './modelKit';
export function createSlotModel(type:SlotType|null,level:number,faction:Faction='roman') {
 if(!type || !level)return createBuildingModel('barracks',0,faction);
 if(type==='mage_tower')return createMageTower(level,faction);
 if(type==='barracks'||type==='stables')return createBuildingModel(type,level,faction);
 if(type==='warehouse')return createBuildingModel('storehouse',level,faction);
 const k=cityKit(faction),{m,box,cylinder,cone,house}=k;
 if(type==='housing'){
  house(0,-.1,1.15,.9,.55+level*.13,level>=3);
  if(level>=2)house(-.85,.15,.55,.65,.55+level*.08,level>=3,m.roofLight);
  if(level>=3)house(.85,.15,.55,.65,.55+level*.08,true,m.slate);
  if(level>=4){k.fence(0,.85,2.35);box(.22,.7,.22,-.3,0,-.3,m.darkStone);}
  if(level>=5){house(0,-.8,1,.55,1.25,true);k.flag(0,1.8,-.8,.6);}
 }else if(type==='smithy') {
  house(-.2,0,1.2,.9,.7+level*.06,level>=3,m.slate);
  box(.28,1.35+level*.12,.28,.4,0,-.25,m.darkStone);
  box(.45,.4,.45,.85,0,.6,m.darkStone);box(.26,.15,.03,.85,.15,.85,m.gold);
  box(.45,.12,.23,-.8,.3,.65,m.dark);box(.22,.3,.16,-.8,0,.65,m.darkStone);
  if(level>=2)k.fence(-.2,-.8,2);
  if(level>=3)house(-1.05,-.25,.6,.7,.7,true);
  if(level>=4)box(.7,.25,.5,.8,0,-.85,m.stone);
  if(level>=5)k.flag(.4,1.95,-.25);
 } else if(type==='granary') {
  house(0,-.45,.95,.7,.65,level>=3);
  for(let i=0;i<Math.min(3,level);i++){const x=-.7+i*.65;cylinder(.25,.75+level*.12,x,0,.5,m.wheat);cone(.32,.3,x,.75+level*.12,.5,m.slate);}
  if(level>=4)k.fence(0,1.1,2.3);
  if(level>=5)k.flag(0,1.05,-.45);
 } else {
  house(-.45,-.3,.65,.75,.65,level>=3,m.slate);
  const width=1.2+level*.13;
  for(let i=0;i<7;i++)box(width,.075,.13,.7,.12,-.45+i*.18,m.timber);
  for(const x of [.3,1.2])for(const z of [-.45,.65])cylinder(.045,.4,x,0,z,m.wood);
  for(let i=0;i<level;i++){box(.2,.2,.2,-.5+i*.2,0,.65,m.wood);}
  if(level>=2) {box(.035,.8,.035,1.1,.2,.1,m.wood);box(.65,.035,.035,.9,1,.1,m.timber,-.2);}
  if(level>=4)k.fence(.7,.85,width);
  if(level>=5)k.flag(-.4,1,-.3);
 }
 k.heraldry(level);return k.finish();
}

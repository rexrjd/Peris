import type {Faction} from '../../../factions/domain/factions';
import {cityKit} from './modelKit';
/** Culture-specific main halls keep the same plot size and five-stage progression. */
export function createFactionHall(level:number,faction:Faction){
 const k=cityKit(faction),{m,box,cylinder,cone,roof,house,tower,flag}=k,h=.8+level*.16;
 box(2,.12,1.7,0,0,0,m.stone);
 if(faction==='spartan'){
  box(1.5,h,.75,0,.12,-.25,m.light);
  for(const x of [-.75,-.25,.25,.75])cylinder(.09,h,x,.12,.5,m.light);
  box(1.9,.15,1.4,0,h+.12,0,m.light);roof(2,.45,1.5,0,h+.27,0);
  if(level>=3)for(const x of [-.8,.8]){const shield=cylinder(.22,.08,x,.5,.65,m.gold);shield.rotation.x=Math.PI/2;}
 }else if(faction==='persian'){
  box(1.65,h,1.3,0,.12,0,m.light);roof(1.7,.65,1.4,0,h+.12,0,m.roof);
  box(.35,.7,.04,0,.12,.67,m.dark);for(const x of [-.68,.68]){cylinder(.09,h,x,.12,.65,m.gold);}
  if(level>=2)for(const x of [-.87,.87])tower(x,-.5,h+.7,.18,true);
 }else if(faction==='egyptian'){
  for(let row=0;row<3+level;row++)box(1.9-row*.15,.16,1.4-row*.12,0,.12+row*.16,-.2,m.stone);
  for(const x of [-.68,.68]){box(.45,h,.65,x,.12,.6,m.light);box(.48,.12,.7,x,h+.12,.6,m.slate);}
  box(.8,.14,.65,0,h-.1,.6,m.light);box(.28,.65,.04,0,.12,.75,m.dark);
  if(level>=2)for(const x of [-.92,.92]){box(.12,h+.4,.12,x,0,-.55,m.gold);cone(.12,.18,x,h+.4,-.55,m.gold);}
 }else if(faction==='orc'){
  cylinder(.9,h,0,.12,0,m.timber);roof(2.1,.75,1.9,0,h+.12,0);box(.35,.65,.05,0,.12,.9,m.dark);
  for(const x of [-.9,.9]){box(.15,h+.25,.18,x,0,.5,m.darkStone);const tusk=cone(.2,.85,x,h-.25,.5,m.light);tusk.rotation.z=-Math.sign(x)*.3;}
 }else if(faction==='elf'){
  for(const x of [-.55,.55]){cylinder(.13,h+.6,x,0,-.15,m.wood);cone(.6,1.2,x,h*.85,-.15,m.green);}
  house(0,.2,1.2,1,h,true,m.roof);roof(1.8,.9,1.6,0,h+.4,0,m.leaf);
  if(level>=3)for(const x of [-.9,.9])tower(x,-.4,h+.5,.15,true);
 }else if(faction==='dwarf'){
  box(1.9,h,1.45,0,.12,0,m.stone);roof(2,.25,1.55,0,h+.12,0,m.roof);
  for(const x of [-.75,.75]){box(.3,h+.35,1.65,x,0,0,m.darkStone);box(.36,.13,1.7,x,h+.35,0,m.gold);}
  box(.5,.75,.06,0,.12,.74,m.dark);box(.6,.12,.12,0,.9,.78,m.gold);
 }else if(faction==='gnome'){
  cylinder(.83,h,0,.12,0,m.light);roof(1.9,.75,1.6,0,h+.12,0,m.roof);
  for(const x of [-.6,.6]){box(.24,.24,.03,x,.5,.75,m.water);}
  box(.3,h+.6,.3,-.6,.12,-.35,m.gold);cone(.34,.4,-.6,h+.72,-.35,m.slate);
 }else if(faction==='pandaren'){
  box(1.35,h,1.15,0,.12,0,m.light);for(const x of [-.65,.65])for(const z of [-.55,.55])cylinder(.08,h+.2,x,.12,z,m.wood);
  roof(2.05,.5,1.8,0,h+.12,0,m.roof);box(1,.35,.85,0,h+.42,0,m.light);roof(1.65,.5,1.4,0,h+.77,0,m.slate);
  if(level>=4){box(.7,.3,.65,0,h+1.07,0,m.light);roof(1.2,.4,1.05,0,h+1.37,0,m.roof);}
 }else if(faction==='undead'){
  box(1.35,h,1.35,0,.12,0,m.stone);roof(1.65,.8,1.65,0,h+.12,0,m.slate);
  for(const x of [-.8,.8])tower(x,0,h+.5,.2,true);
  box(.38,.7,.035,0,.12,.7,m.dark);k.rock(.17,0,h+.7,.7,m.water);
  if(level>=3)for(const x of [-.65,.65]){box(.11,.4,.08,x,0,.92,m.light);box(.3,.1,.08,x,.25,.92,m.light);}
 }else{
  box(1.65,h,1.2,0,.12,0,m.darkStone);roof(1.9,.65,1.45,0,h+.12,0,m.roof);
  for(const x of [-.8,.8]){tower(x,-.1,h+.55,.23,true);const horn=cone(.2,.75,x,h+.7,-.1,m.gold);horn.rotation.z=-Math.sign(x)*.35;}
  box(.4,.7,.05,0,.12,.64,m.dark);box(.5,.07,.06,0,.85,.66,m.roofLight);
 }
 if(level>=2)k.heraldry(level,0,.15);
 if(level>=3)for(const x of [-.85,.85])box(.28,.25,.3,x,0,.95,m.gold);
 if(level>=4&&faction!=='pandaren')house(0,-.85,.8,.55,.75,true,m.slate);
 if(level>=5)flag(.4,h+1.05,-.25,.55);
 const model=k.finish();model.name=`${faction} main hall level ${level}`;return model;
}

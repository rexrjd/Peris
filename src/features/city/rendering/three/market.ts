import type {Faction} from '../../../factions/domain/factions';
import {cityKit} from './modelKit';

/** Original merchant courts: five physical stages within one ordinary city lot. */
export function createMarket(value:number,faction:Faction='roman',animated=false){
 const level=Number.isFinite(value)?Math.max(0,Math.min(5,Math.floor(value))):0;
 const k=cityKit(faction,animated),{m,box,cylinder,cone,roof,house}=k;
 k.group.name=`Market ${faction} level ${level}`;k.group.userData.marketLevel=level;
 if(!level){box(1.9,.045,1.7,0,0,0,m.earth);for(const x of [-.85,.85])box(.09,.2,.09,x,0,.65,m.timber);return k.finish();}
 const stone=['roman','spartan','egyptian','dwarf','undead','demon'].includes(faction);
 const canopy=(w:number,h:number,d:number,x:number,y:number,z:number,tone=m.roof)=>{
  if(faction!=='orc')return roof(w,h,d,x,y,z,tone);
  // Long market awnings are stretched hides, rather than the hall kit's broad conical tent.
  const hide=box(w,.09,d,x,y,z,tone);hide.rotation.x=-.1;return hide;
 };
 box(2.9,.065,2.65,0,0,0,stone?m.stone:m.earth);
 // Each awning remains open below, so counters and displayed goods are readable.
 function stall(x:number,z:number,width=1.05){
  const h=faction==='dwarf'?.73:faction==='gnome'?.82:faction==='elf'?1.22:1;
  for(const dx of [-width*.43,width*.43])for(const dz of [-.32,.32]){
   if(faction==='elf'){const post=box(.065,h,.065,x+dx,.06,z+dz,m.timber);post.rotation.z=dx>0?-.11:.11;}
   else if(faction==='egyptian')box(.12,h,.12,x+dx,.06,z+dz,m.light);
   else cylinder(faction==='orc'?.065:.035,h,x+dx,.06,z+dz,m.wood);
  }
  canopy(width+.14,.22,.84,x,h+.06,z,m.roofLight);
  box(width*.93,.32,.4,x,.06,z+.14,m.timber);
  box(width,.065,.48,x,.38,z+.14,m.wood);
  for(let i=0;i<3;i++){
   box(.22,.055,.26,x+(i-1)*.27,.445,z+.14,m.wood);
   for(let j=0;j<3;j++)k.rock(.055,x+(i-1)*.27+(j-1)*.05,.48,z+.14,i===0?m.wheat:i===1?m.green:m.gold);
  }
  if(faction==='orc')for(const dx of [-.5,.5]){const tusk=cone(.075,.35,x+dx,.8,z+.32,m.light);tusk.rotation.z=-dx*.5;}
  if(faction==='pandaren')for(const dx of [-.43,.43]){cylinder(.012,.23,x+dx,.69,z+.36,m.gold);k.rock(.09,x+dx,.72,z+.36,m.roof);}
 }
 stall(level>=2?-.65:0,.55,level>=2?.95:1.55);
 if(level>=2)stall(.65,.55,.95);
 // Storehouse and weighing station give even the first stage a trade identity.
 for(let i=0;i<level+1;i++){
  const x=-1.12+(i%2)*.25,z=-.15-Math.floor(i/2)*.24;
  box(.21,.2,.2,x,.07,z,m.timber);box(.225,.035,.22,x,.21,z,m.wood);
 }
 const sx=level>=3?.6:.72,sz=level>=3?.05:-.38;
 cylinder(.022,.4,sx,.1,sz,m.gold);box(.42,.028,.03,sx,.5,sz,m.gold);
 for(const dx of [-.17,.17]){cylinder(.008,.12,sx+dx,.37,sz,m.gold);cylinder(.085,.025,sx+dx,.34,sz,m.gold);}
 if(level>=2){
  box(.52,.06,.36,1.06,.27,-.67,m.wood);
  for(const x of [.85,1.27])for(const z of [-.9,-.45]){const wheel=cylinder(.14,.045,x,.08,z,m.dark);wheel.rotation.x=Math.PI/2;wheel.position.y=.2;}
  box(.045,.045,.65,1.06,.25,-1.1,m.timber);box(.28,.24,.24,1.06,.3,-.67,m.wheat);
 }
 if(level>=3){
  // Shallow rear hall preserves a central open court and the street-facing stalls.
  const h=faction==='dwarf'?.8:faction==='elf'?1.16:1.02;
  if(faction==='persian'){
   for(const x of [-.61,.61])box(.24,h,.66,x,.065,-.77,m.light);
   box(1.48,.23,.66,0,h-.16,-.77,m.light);roof(1.55,.37,.83,0,h+.07,-.77,m.roof);
  }else if(faction==='gnome'){cylinder(.57,h,0,.065,-.78,m.timber);roof(1.35,.4,1.05,0,h+.065,-.78,m.roof);box(.35,.6,.035,0,.07,-.19,m.dark);}
  else if(faction==='orc'){for(const x of [-.38,.38])house(x,-.78,.72,.74,h,false);}
  else {box(1.55,h,.64,0,.065,-.82,stone?m.light:m.timber);roof(1.75,.35,.84,0,h+.065,-.82,m.roof);box(.38,h*.7,.035,0,.065,-.49,m.dark);}
  if(faction==='roman'||faction==='spartan')for(const x of [-.64,-.3,.3,.64]){cylinder(.055,h,x,.07,-.31,m.light);box(.17,.055,.17,x,h+.02,-.31,m.light);}
 }
 if(level>=4){
  for(const side of [-1,1]){
   const x=side*1.22;
   for(const z of [-.78,-.05])cylinder(.055,1.02,x,.065,z,stone?m.light:m.timber);
   canopy(.42,.17,1.13,x,1.08,-.42,m.roof);
   box(.26,.31,.26,x,.07,-.28,m.timber);
  }
  box(.82,.09,.35,0,.065,1.13,m.stone);
 }
 if(level>=5){
  for(const side of [-1,1]){
   const x=side*.77;box(.2,1.34,.25,x,.065,1.12,stone?m.light:m.wood);
   if(faction==='egyptian')box(.32,1.5,.29,x,.065,1.12,m.stone);
  }
  box(1.72,.15,.3,0,1.4,1.12,m.light);canopy(1.9,.25,.54,0,1.55,1.12,m.slate);
  k.flag(.77,1.45,1.12,.65);
 }
 // Structural faction signatures are present at every completed stage.
 if(faction==='roman'){for(const x of [-1.3,1.3]){cylinder(.06,.62,x,.07,.95,m.light);box(.2,.06,.2,x,.67,.95,m.light);}}
 else if(faction==='spartan'){box(.28,.65,.22,-1.21,.07,-.93,m.light);const shield=cylinder(.17,.055,-1.21,.4,-.79,m.gold);shield.rotation.x=Math.PI/2;shield.position.y=.5;}
 else if(faction==='persian'){cylinder(.085,.9,-1.24,.07,-.95,m.light);roof(.32,.18,.32,-1.24,.97,-.95,m.roof);}
 else if(faction==='egyptian'){box(.25,.65,.21,-1.22,.07,-.94,m.light);box(.33,.11,.25,-1.22,.72,-.94,m.slate);}
 else if(faction==='orc'){for(const x of [-1.25,1.25]){box(.16,.65,.16,x,.07,1.04,m.wood);const horn=cone(.09,.33,x,.72,1.04,m.light);horn.rotation.z=x>0?-.3:.3;}}
 else if(faction==='elf'){for(const x of [-1.22,1.22]){const limb=box(.08,.85,.08,x,.07,-1.04,m.timber);limb.rotation.z=x*.15;cone(.25,.34,x,.8,-1.04,m.leaf);}k.rock(.14,0,.15,1.08,m.water);}
 else if(faction==='dwarf'){box(.32,.45,.28,-1.18,.07,-.97,m.darkStone);box(.42,.12,.36,-1.18,.52,-.97,m.gold);for(const x of [-.13,.13])box(.035,.25,.035,-1.18+x,.24,-.82,m.gold);}
 else if(faction==='gnome'){const gear=cylinder(.19,.05,-1.22,.35,-.98,m.gold);gear.rotation.x=Math.PI/2;gear.position.y=.5;for(let i=0;i<8;i++)box(.075,.075,.06,-1.22+Math.sin(i*Math.PI/4)*.21,.5+Math.cos(i*Math.PI/4)*.21,-.98,m.gold);}
 else if(faction==='pandaren'){for(let i=0;i<3;i++){cylinder(.025,.9,-1.23+i*.12,.07,-1.02,m.green);for(const h of [.3,.55,.8])cylinder(.034,.035,-1.23+i*.12,h,-1.02,m.gold);}}
 else if(faction==='undead'){for(const x of [-1.2,1.2]){box(.12,.66,.12,x,.07,-1.04,m.light);k.rock(.14,x,.7,-1.04,m.water);}box(.45,.08,.32,0,.07,1.06,m.darkStone);}
 else if(faction==='demon'){for(const x of [-1.18,1.18]){const horn=cone(.14,.85,x,.07,-1.02,m.darkStone);horn.rotation.z=-x*.2;box(.035,.38,.04,x,.12,-.9,m.gold);}}
 k.heraldry(level,0,-.15);return k.finish();
}

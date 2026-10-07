import {FACTIONS,type Faction} from '../../../factions/domain/factions';
import {cityKit} from './modelKit';
/** Ten cumulative silhouettes: hall, library, turrets, spires and an arcane crown. */
export function createMageTower(value:number,faction:Faction='roman'){
 const level=Math.max(1,Math.min(10,Math.round(value))),k=cityKit(faction),{m,cylinder,cone,box,rock}=k;
 if(faction==='roman'){m.slate.color.set(0x4f5684);m.water.color.set(0x63b9d8);}m.water.emissive.set(FACTIONS[faction].water).multiplyScalar(.2);
 const height=.75+level*.2;
 cylinder(.84,.12,0,0,0,m.darkStone);cylinder(.62,height,0,.12,0,m.light);
 box(.24,.48,.035,0,.12,.625,m.dark);cone(.78,.65+level*.025,0,height+.12,0,m.slate);
 for(let row=0;row<Math.ceil(level/2);row++)for(const x of [-.32,.32])box(.12,.2,.035,x,.52+row*.37,.58,m.water);
 if(level>=2){box(.78,.58,.65,-.72,.12,-.1,m.stone);k.roof(.9,.28,.77,-.72,.7,-.1,m.slate);}
 if(level>=3)cylinder(.67,.08,0,height*.56,0,m.gold);
 if(level>=4){cylinder(.23,height*.72,.83,.12,0,m.stone);cone(.32,.55,.83,height*.72+.12,0,m.slate);}
 if(level>=5){cylinder(.23,height*.72,-.83,.12,.45,m.light);cone(.32,.55,-.83,height*.72+.12,.45,m.slate);}
 if(level>=6){cylinder(.28,.48,0,height+.6,0,m.light);cone(.42,.6,0,height+1.08,0,m.slate);}
 if(level>=7)for(const x of [-.42,.42]){cylinder(.08,.3,x,height+.12,.42,m.gold);rock(.16,x,height+.42,.42,m.water);}
 if(level>=8){cylinder(.72,.08,0,height*.78,0,m.gold);for(let i=0;i<6;i++){const angle=i*Math.PI/3;rock(.12,Math.cos(angle)*.72,height*.78+.08,Math.sin(angle)*.72,m.water);}}
 if(level>=9){for(const x of [-.83,.83]){cylinder(.14,.48,x,height*.72+.55,0,m.light);cone(.24,.48,x,height*.72+1.03,0,m.slate);}box(.12,.8,.12,0,height+1.65,0,m.gold);}
 if(level>=10){rock(.34,0,height+2.2,0,m.water);for(const x of [-.5,.5])rock(.16,x,height+1.8,0,m.gold);cylinder(.9,.1,0,.12,0,m.gold);}
 if(faction==='pandaren')for(let row=0;row<Math.ceil(level/3);row++)k.roof(1.7,.2,1.7,0,.6+row*.7,0,m.slate);
 if(faction==='elf')for(const x of [-.6,.6])cone(.12,.55+level*.07,x,height*.7,0,m.gold);
 if(faction==='dwarf')for(const x of [-.7,.7])box(.18,height,.3,x,.12,0,m.darkStone);
 k.heraldry(level);const model=k.finish();model.name=`Mage tower level ${level}`;return model;
}

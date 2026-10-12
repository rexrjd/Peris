import type {Faction} from '../../../factions/domain/factions';
import {cityKit} from './modelKit';
/** Five native geometry stages, sharing each faction's materials and roof language. */
export function createAcademy(level:number,faction:Faction){
 const k=cityKit(faction),{m,box,cylinder,house,roof}=k;
 const l=Math.max(1,Math.min(5,level));box(1.8,.12,1.55,0,0,0,m.stone);house(0,-.25,1.3,1,.7+l*.08,true,m.slate);
 for(const x of [-.5,0,.5]){cylinder(.06,.55,x,.12,.52,m.light);box(.2,.09,.22,x,.1,.52,m.stone);}
 box(.45,.08,.25,0,.52,.9,m.gold);box(.18,.045,.24,-.1,.61,.9,m.light);box(.18,.045,.24,.1,.61,.9,m.light);
 if(l>=2)house(-1.05,-.05,.6,.9,.65,true,m.slate);
 if(l>=3){house(1.05,-.05,.6,.9,.65,true,m.slate);box(2.6,.08,.2,0,.13,.95,m.light);}
 if(l>=4){cylinder(.28,1.55,0,.1,-.55,m.stone);roof(.75,.35,.75,0,1.65,-.55,m.slate);cylinder(.035,.4,0,1.95,-.55,m.gold);}
 if(l>=5){for(const x of [-.8,.8]){cylinder(.18,1.4,x,0,-.55,m.light);roof(.5,.3,.5,x,1.4,-.55,m.slate);}k.flag(0,1.5,.1,.9);box(.14,.14,.14,0,2.38,.1,m.gold);}
 k.heraldry(l);return k.finish();
}

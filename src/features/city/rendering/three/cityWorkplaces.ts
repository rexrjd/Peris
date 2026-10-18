import * as THREE from 'three';
import type { Faction } from '../../../factions/domain/factions';
import { cityKit } from './modelKit';

export type CityWorkplace = 'smithy' | 'warehouse' | 'granary';

/** Working silhouettes fill the same lots: forge, loading shed and raised grain silos. */
export function createCityWorkplace(type: CityWorkplace, level: number, faction: Faction, animated = false) {
    const k=cityKit(faction,animated),{m,box,cylinder,cone,roof,house}=k;
    if(type==='smithy') {
        const h=1.35+level*.12;
        // An open-sided canopy leaves the furnace and anvil visible from the street.
        box(.88,.72+level*.035,.8,.42,0,-.34,m.darkStone);
        box(.38,.32,.035,.42,.12,.075,m.dark);
        const fire=m.gold.clone();fire.emissive.copy(m.roofLight.color).multiplyScalar(.65);
        box(.27,.15,.04,.42,.13,.1,fire);box(.35,.045,.18,.42,.08,.15,m.dark);
        box(.32,h,.34,.4,0,-.25,m.darkStone);box(.43,.1,.44,.4,h-.12,-.25,m.stone);box(.25,.025,.26,.4,h-.01,-.25,m.dark);
        for(const x of [-1.1,-.03])box(.065,.9,.065,x,0,-.43,m.wood);
        roof(1.25,.27,1.3,-.56,.9,-.38,m.slate);
        box(.68,.13,.3,-.65,.17,-.6,m.timber);
        for(let i=0;i<4;i++)box(.55,.025,.26,-.65,.28+i*.055,-.6,m.dark);
        // The existing blacksmith and hammer keep their familiar rest coordinates.
        box(.45,.12,.23,-.8,.3,.65,m.dark);box(.22,.3,.16,-.8,0,.65,m.darkStone);
        if(animated){
            for(const x of [-.84,-.76])box(.05,.18,.055,x,0,.96,m.dark);
            box(.16,.24,.13,-.8,.18,.96,m.wood);k.rock(.085,-.8,.43,.96,m.skin);
            const arm=new THREE.Group();arm.position.set(-.8,.37,.88);k.group.add(arm);
            arm.add(box(.055,.06,.22,0,-.03,-.08,m.skin));arm.add(box(.03,.16,.03,0,-.04,-.19,m.timber));arm.add(box(.18,.08,.1,0,.04,-.19,m.dark));k.motion(arm,'hammer');
        }
        if(level>=2){cylinder(.18,.22,1.02,0,.55,m.dark);cylinder(.14,.018,1.02,.22,.55,m.water);}
        if(level>=3){box(.07,.64,.07,1.15,0,-.63,m.wood);box(.57,.065,.07,1.1,.48,-.63,m.timber);for(let i=0;i<4;i++)box(.045,.52,.045,.86+i*.13,0,-.63,m.dark);}
        if(level>=4){box(.62,.11,.5,.85,0,-.96,m.stone);for(let i=0;i<3;i++)box(.14,.08,.25,.65+i*.18,.11,-.96,m.dark);}
        if(level>=5)k.flag(-1.1,.92,-.43,.65);
    } else if(type==='warehouse') {
        const h=.83+level*.09;
        // Twin gabled loading sheds read differently from homes and grain silos.
        for(const x of [-.57,.57]){
            house(x,-.48,.98,1.04,h,level>=3,m.slate);
            box(.64,.68,.04,x,.13,.064,m.dark);
            for(const dx of [-.32,.32])box(.07,.74,.08,x+dx,.1,.1,m.timber);
            box(.78,.08,.09,x,.8,.1,m.timber);
        }
        box(2.52,.17,.7,0,0,.52,m.stone);box(2.57,.055,.74,0,.17,.52,m.timber);
        for(const side of [-1,1])box(.46,.075,.24,side*.96,0,1.0,m.stone);
        for(let i=0;i<Math.min(5,level+1);i++){
            const x=-.88+(i%3)*.3,z=.45+(i%2)*.25,y=i>=3?.48:.225;
            box(.27,.25,.26,x,y,z,m.timber);for(const dx of [-.09,.09])box(.035,.25,.28,x+dx,y,z,m.wood);
        }
        cylinder(.16,.4,.93,.225,.54,m.timber);
        if(level>=2){box(.085,1.62,.085,1.14,0,-.22,m.wood);box(.1,.09,.85,1.14,1.48,.16,m.timber);cylinder(.017,.55,1.14,.96,.55,m.dark);box(.18,.08,.16,1.14,.89,.55,m.dark);}
        if(level>=3)for(const x of [-.58,.58])box(.28,.18,.045,x,h*.68,.1,m.gold);
        if(level>=4){
            for(const x of [-1.17,1.17])box(.055,1.05,.055,x,0,.9,m.wood);
            // A long Orc tent roof is circular; a lean-to keeps this awning off the street.
            if(faction==='orc'){const awning=box(2.55,.07,.86,0,1.05,.55,m.roofLight);awning.rotation.x=.08;}
            else roof(2.55,.14,.86,0,1.05,.55,m.roofLight);
        }
        if(level>=5)k.flag(0,h+.35,-.6,.65);
    } else {
        box(2.44,.18,1.48,0,0,-.15,m.stone);
        // Grain is raised above damp ground, with dark bands and pointed silo caps.
        for(let i=0;i<Math.min(3,level+1);i++){
            const x=-.72+i*.72,h=.86+level*.12+(i===1?.18:0);
            for(const side of [-1,1])box(.08,.34,.08,x+side*.19,.18,.04,m.wood);
            cylinder(.285,h,x,.4,-.18,m.wheat);
            for(const y of [.48,.4+h*.75])cylinder(.3,.045,x,y,-.18,m.timber);
            cone(.36,.33,x,.4+h,-.18,m.slate);
            box(.11,.23,.22,x,.32,.16,m.timber);
        }
        for(let i=0;i<Math.min(4,level);i++){const sack=cylinder(.125,.24,-.87+i*.24,0,.8,m.wheat);sack.rotation.z=(i%2?1:-1)*.08;}
        if(level>=2){box(1.02,.08,.55,0,.18,.76,m.timber);box(.72,.08,.25,0,.08,1.02,m.wood);}
        if(level>=3){box(.055,1.45,.055,1.16,0,-.45,m.wood);for(let i=0;i<6;i++)box(.27,.035,.055,1.04,.23+i*.2,-.45,m.timber);box(.055,1.45,.055,.91,0,-.45,m.wood);}
        if(level>=4)k.fence(0,-1.04,2.45);
        if(level>=5)k.flag(-1.1,1.3,-.6,.7);
    }
    k.heraldry(level);const model=k.finish();model.name=`City ${type} level ${level}`;return model;
}

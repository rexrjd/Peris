import type { Faction } from '../../../factions/domain/factions';
import { createFactionHall } from './factionHall';
import { cityKit } from './modelKit';

/** A city-only civic landmark; strategic villages keep their existing models. */
export function createCityHall(level: number, faction: Faction, animated = false) {
    if (faction !== 'roman') {
        const k = cityKit(faction,animated), hall=createFactionHall(level,faction,animated);
        hall.scale.y=1.12;
        // A broad entrance stair makes the taller faction hall feel grounded.
        for(let step=0;step<3;step++)k.box(1.05-step*.12,.055,.2,0,step*.055,.97-step*.14,k.m.stone);
        const group=k.finish();group.add(hall);group.name=`City ${faction} hall level ${level}`;return group;
    }
    const k=cityKit(faction,animated),{m,box,cylinder,roof,house}=k,h=1.04+level*.13;
    box(2.65,.14,1.92,0,0,-.3,m.stone);
    box(1.95,h,1.08,0,.14,-.54,m.light);
    box(.46,.78,.035,0,.14,.018,m.dark);
    for(const x of [-.96,-.32,.32,.96]) {
        cylinder(.09,h,x,.14,.48,m.light);cylinder(.13,.07,x,.14,.48,m.stone);cylinder(.13,.09,x,h+.05,.48,m.light);
    }
    box(2.4,.14,1.65,0,h+.14,-.22,m.light);roof(2.58,.46,1.85,0,h+.28,-.22);
    for(let step=0;step<3;step++)box(1.5-step*.12,.05,.21,0,step*.05,.88-step*.13,m.light);
    for(const side of [-1,1])box(.22,.46,.04,side*.7,.55,.025,m.gold);
    if(level>=2)for(const x of [-1.03,1.03]){box(.42,.82,.62,x,.14,-.93,m.stone);roof(.56,.25,.76,x,.96,-.93,m.slate);}
    if(level>=3){
        const top=h+.38,th=.65+(level-3)*.12;
        box(.62,th,.62,0,top,-.7,m.light);
        for(const side of [-1,1])box(.12,.3,.035,side*.15,top+.14,-.376,m.dark);
        box(.72,.09,.72,0,top+th,-.7,m.stone);roof(.82,.3,.84,0,top+th+.09,-.7,m.slate);
        if(level>=5)k.flag(0,top+th+.36,-.7,.65);
    }
    if(level>=4)for(const x of [-1.03,1.03])house(x,-.85,.48,.8,1.1,true,m.slate);
    // Retain a small fountain at the front of the existing civic square.
    if(level>=2){cylinder(.36,.16,0,0,1.17,m.stone);cylinder(.27,.025,0,.16,1.17,m.water);cylinder(.06,.4,0,.18,1.17,m.light);}
    const group=k.finish();group.name=`City Roman hall level ${level}`;return group;
}

import { type BuildingType } from '../../domain/types';
import type {Faction} from '../../../factions/domain/factions';
import {createFactionHall} from './factionHall';
import { cityKit } from './modelKit';

export const visualLevel = (level: number) => Number.isFinite(level) ? Math.max(0, Math.min(5, Math.floor(level))) : 0;

/** Zero is an empty plot; levels 1–5 change the actual geometry, not an image tint. */
export function createBuildingModel(type: BuildingType, value: number, faction:Faction='roman') {
    const level = visualLevel(value), k = cityKit(faction);
    const { group, m, box, cylinder, cone, rock, roof, house, tower, flag, fence } = k;
    group.name = `${type} level ${level}`;
    if (!level) {
        box(type === 'wall' ? 3.2 : 1.8, .035, 1.35, 0, 0, 0, m.earth);
        for (const x of [-.8, .8]) for (const z of [-.55, .55]) box(.09, .24, .09, x, 0, z, m.wood);
        if (type === 'farm') for (let i = 0; i < 5; i++) box(1.45, .018, .04, 0, .04, -.45 + i * .22, m.wood);
        else if (type === 'quarry') for (let i = 0; i < 4; i++) rock(.2 + i * .04, -.65 + i * .4, .04, .05);
        else {
            box(1.3, .18, .16, -.1, .04, .23, m.darkStone);
            box(.16, .24, .85, -.67, .04, -.12, m.darkStone);
            box(.7, .1, .15, .24, .05, -.42, m.timber, -.2);
        }
        return k.finish();
    }
    if(type==='market'&&faction!=='roman')return createFactionHall(level,faction);
    const stone = level >= 3;
    if (type === 'lumber') {
        house(-.25, -.15, 1.05 + level * .06, .9, .65 + level * .06, stone);
        // Cut logs and a saw wheel give the yard its own silhouette.
        for (let i = 0; i < level + 2; i++) {
            const log = cylinder(.11, .9, -.7 + i % 3 * .23, .16 + Math.floor(i / 3) * .2, .75, m.timber);
            log.rotation.z = Math.PI / 2; log.position.y = .12 + Math.floor(i / 3) * .2;
        }
        if (level >= 2) {
            const wheel = cylinder(.4, .1, .72, .25, .3, m.wood); wheel.rotation.x = Math.PI / 2; wheel.position.y = .43;
            const hub = cylinder(.08, .12, .72, .25, .37, m.gold); hub.rotation.x = Math.PI / 2; hub.position.y = .43;
        }
        if (level >= 3) { house(-1.15, -.3, .55, .85, .6); fence(0, -1, 2.3); }
        if (level >= 4) {
            box(.13, 1.8, .13, 1.1, 0, -.45, m.wood); box(1.25, .12, .12, .7, 1.65, -.45, m.wood);
            cylinder(.02, .8, .1, .86, -.45, m.timber); box(.32, .15, .24, .1, .75, -.45, m.timber);
        }
        if (level >= 5) { house(.5, -1.02, 1.15, .65, 1.05, true, m.slate); flag(.7, 1.45, -1); }
    } else if (type === 'quarry') {
        for (let i = 0; i < 5; i++) rock(.35 + i % 3 * .17, -.9 + i * .39, 0, -.45 - i % 2 * .25);
        for (let i = 0; i < level + 1; i++) box(.32, .22, .28, -.65 + i % 3 * .39, Math.floor(i / 3) * .24, .65, m.stone);
        if (level >= 2) {
            box(.15, 1.65, .15, -.65, 0, -.35, m.wood); box(1.5, .14, .14, -.13, 1.5, -.35, m.wood);
            cylinder(.022, 1, .54, .5, -.35, m.timber); box(.4, .32, .4, .54, .28, -.35, m.light);
        }
        if (level >= 3) house(1.03, -.28, .65, .9, .9, true);
        if (level >= 4) {
            box(.15, 2.15, .15, -.85, 0, -.95, m.wood); box(2.3, .15, .15, -.15, 2, -.95, m.wood);
            cylinder(.02, 1.35, .85, .6, -.95, m.timber); box(.45, .32, .45, .85, .4, -.95, m.stone);
        }
        if (level >= 5) { house(1.12, -.32, .85, 1, 1.4, true, m.slate); flag(1.15, 1.9, -.35); }
    } else if (type === 'farm') {
        const rows = level + 2;
        box(2.5, .04, 1.65, 0, 0, .42, m.earth);
        for (let i = 0; i < rows; i++) box(2.25, .1 + level * .018, .09, 0, .03, -.25 + i * 1.3 / rows, m.wheat);
        house(.35, -.85, .75, .6, .55 + level * .04, stone);
        if (level >= 2) house(-.6, -.9, .65, .7, .6);
        if (level >= 3) {
            cylinder(.26, 1.7, -.95, 0, -.55, m.light); cone(.36, .42, -.95, 1.7, -.55, m.roof);
            box(.09, .1, .25, -.95, 1.25, -.24, m.wood);
            for (const angle of [Math.PI / 4, -Math.PI / 4]) {
                const blade = box(1.5, .13, .05, -.95, 1.25, -.1, m.light); blade.rotation.z = angle;
            }
        }
        if (level >= 4) { fence(0, 1.4, 2.8); fence(-1.4, .3, 2.2, Math.PI / 2); }
        if (level >= 5) { cylinder(.28, 1.1, 1.05, 0, -.8, m.stone); cone(.36, .35, 1.05, 1.1, -.8, m.slate); flag(.4, 1, -.85); }
    } else if (type === 'market') {
        const width = 1.3 + level * .15, h = .8 + level * .085;
        box(width + .25, .13, 1.25, 0, 0, -.25, m.stone);
        box(width, h, .55, 0, .13, -.5, m.light);
        for (let i = 0; i < 4; i++) cylinder(.065, h, -width / 2 + .12 + i * (width - .24) / 3, .13, .18, m.light);
        box(width + .15, .14, 1.05, 0, h + .13, -.22, m.light);
        roof(width + .26, .4, 1.18, 0, h + .27, -.22);
        if (level >= 2) for (const x of [-1.15, 1.15]) {
            box(.65, .4, .45, x, 0, .62, m.wood); roof(.8, .15, .65, x, .8, .62, x < 0 ? m.roofLight : m.slate);
            for (const side of [-1, 1]) cylinder(.03, .9, x + side * .3, 0, .62, m.wood);
        }
        if (level >= 3) {
            cylinder(.4, .18, 0, 0, 1.13, m.stone); cylinder(.31, .03, 0, .18, 1.13, m.water);
            cylinder(.08, .45, 0, .18, 1.13, m.light);
        }
        if (level >= 4) for (const x of [-1.2, 1.2]) house(x, -.65, .62, .8, 1.02, true);
        if (level >= 5) {
            box(.6, 1.25, .6, 0, 1.25, -.5, m.light); roof(.76, .3, .78, 0, 2.5, -.5, m.slate);
            flag(0, 2.75, -.5); box(.16, .28, .04, 0, 2.08, -.18, m.gold);
        }
    } else if (type === 'barracks') {
        house(0, -.32, 1.65, .92, .7 + level * .07, stone);
        box(.8, .035, 1, 0, 0, .8, m.earth);
        if (level >= 2) for (const x of [-.9, .9]) {
            box(.04, .6, .04, x, 0, .8, m.wood); box(.4, .05, .05, x, .45, .8, m.wood);
            cylinder(.16, .04, x, .54, .8, m.roof).rotation.x = Math.PI / 2;
        }
        if (level >= 3) for (const x of [-1.02, 1.02]) tower(x, -.38, 1.65, .26);
        if (level >= 4) { house(0, -1.16, 1.05, .7, 1.55, true, m.slate); fence(0, 1.4, 2.3); }
        if (level >= 5) { tower(0, -1.2, 2.55, .35); flag(0, 2.85, -1.2); }
    } else if (type === 'stables') {
        const h = .7 + level * .055;
        house(0, -.42, 1.55, .85, h, stone);
        for (const x of [-.4, .4]) box(.31, .55, .04, x, 0, .024, m.dark);
        if (level >= 2) { fence(0, 1.2, 2.5); fence(-1.25, .45, 1.5, Math.PI / 2); fence(1.25, .45, 1.5, Math.PI / 2); }
        if (level >= 3) {
            // A simple horse, assembled from a handful of faceted forms.
            box(.55, .3, .24, .5, .35, .75, m.wood); box(.14, .4, .18, .72, .55, .75, m.wood);
            box(.28, .16, .17, .75, .88, .75, m.wood);
            for (const x of [.3, .7]) for (const z of [.66, .84]) box(.05, .35, .05, x, 0, z, m.dark);
        }
        if (level >= 4) house(-1.05, -.6, .65, .8, 1.05, true);
        if (level >= 5) { house(0, -1.05, .7, .7, 1.8, true, m.slate); flag(0, 2.12, -1.05); }
    } else if (type === 'wall') {
        const h = .6 + level * .23, width = 2.9 + level * .08;
        if (level <= 2) {
            for (let i = 0; i < 12; i++) if (i !== 5 && i !== 6) {
                const x = -width / 2 + i * width / 11;
                box(.2, h, .18, x, 0, 0, m.wood); cone(.15, .2, x, h, 0, m.timber);
            }
            for (const x of [-.4, .4]) box(.17, h + .2, .2, x, 0, 0, m.timber);
            box(1, .2, .23, 0, h, 0, m.timber);
            if (level === 2) for (const x of [-1.65, 1.65]) { box(.45, h + .5, .45, x, 0, 0, m.wood); roof(.65, .32, .65, x, h + .5, 0, m.roof); }
        } else {
            for (const side of [-1, 1]) box(width / 2 - .38, h, .36, side * (width / 4 + .19), 0, 0, m.stone);
            box(.82, .32, .48, 0, h - .24, 0, m.light);
            for (let i = 0; i < 13; i++) box(.15, .2, .38, -width / 2 + i * width / 12, h, 0, m.light);
            for (const x of [-width / 2, width / 2]) tower(x, 0, h + .65, .35, level === 4);
            if (level >= 4) for (const side of [-1, 1]) box(.3, .75, 1.35, side * width / 2, 0, -.76, m.stone);
            if (level >= 5) { for (const x of [-.55, .55]) tower(x, -.12, h + 1.2, .29, true); flag(.55, h + 1.67, -.12); }
        }
    } else if (type === 'storehouse') {
        house(0, -.15, 1.25 + level * .07, .95, .75 + level * .06, stone);
        for (const x of [-.4, .4]) box(.24, .24, .24, x, 0, .75, m.timber);
        if (level >= 2) { cylinder(.29, .85, .95, 0, -.22, m.timber); cone(.37, .3, .95, .85, -.22, m.roof); }
        if (level >= 3) { cylinder(.3, 1.4, -.98, 0, -.28, m.stone); cone(.39, .36, -.98, 1.4, -.28, m.slate); }
        if (level >= 4) house(0, -1, 1.3, .7, 1.25, true);
        if (level >= 5) { cylinder(.33, 1.9, .98, 0, -.28, m.light); cone(.43, .43, .98, 1.9, -.28, m.slate); flag(.98, 2.25, -.28); }
    }
    if(type!=='wall')k.heraldry(level);
    return k.finish();
}

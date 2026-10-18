import * as THREE from 'three';
import { cityKit } from './modelKit';
import { type CityPlot } from './layout';
import type { Faction } from '../../../factions/domain/factions';
import { isCityResource } from './resourceModels';
import { createCitySurfaces } from './citySurfaces';

/** Shared material batches dress actual built plots. No decorative building fills an empty slot. */
export function createCityDistricts(plots: CityPlot[], faction: Faction) {
    const k = cityKit(faction), { m, box, cylinder, rock } = k;
    m.road.color.lerp(m.light.color, .35);
    m.earth.color.lerp(m.wood.color, .2); m.wheat.color.lerp(m.gold.color, .24);
    for (const plot of plots) {
        if (!plot.level || plot.type === 'wall') continue;
        const { x, z, type } = plot, main = type === 'market', inside = plot.slot !== undefined && plot.slot < 16;
        if (isCityResource(type)) {
            // Working country yards use soil, crops and stock instead of civic paving.
            if (type === 'fishery') {
                const bank = cylinder(1, .025, x - 1.5, -.015, z - .25, m.earth); bank.scale.set(.48, .025, 1.1);
                for (const dx of [-1.4, -.65]) for (const dz of [-.8, .1]) cylinder(.045, .35, x + dx, -.2, z + dz, m.wood);
            } else {
                const yard = cylinder(1, .026, x, -.015, z + .1, m.earth); yard.scale.set(2.2, .026, 1.8);
                box(1.15, .025, .8, x, -.008, z + 1.65, m.road);
            }
            if (type === 'lumber') {
                k.fence(x - 2, z - .2, 2.8, Math.PI / 2);
                for (let i = 0; i < 3; i++) { cylinder(.17, .16, x - 2.35 - i * .3, -.01, z - 1.4 + i * .6, m.timber); }
                box(.48, .28, .46, x + 1.75, 0, z + .95, m.wood);
            }
            if (type === 'quarry') {
                for (let i = 0; i < 7; i++) rock(.26 + i % 3 * .12, x + 1.95 + i % 2 * .55, -.04, z - 1.6 + Math.floor(i / 2) * .55, i % 2 ? m.light : m.darkStone);
                box(.65, .12, .5, x - 1.5, 0, z - 1.8, m.darkStone);
            }
            if (type === 'farm') {
                for (const [dx, dz, w, d] of [[-3, .05, 2.5, 3.4], [-.3, 3.8, 3.3, 2.25]]) {
                    const fx = x + dx, fz = z + dz;
                    box(w, .035, d, fx, -.016, fz, m.earth);
                    for (let row = 0; row < 7; row++) {
                        const pz = fz - d * .42 + row * d * .14;
                        box(w * .92, .026, .11, fx, .01, pz, m.timber);
                        box(w * .9, .12, .14, fx, .045, pz, m.wheat);
                        for (let stalk = 0; stalk < 9; stalk++) {
                            const px = fx - w * .43 + stalk * w * .107, h = .14 + (stalk + row) % 3 * .025;
                            cylinder(.018, h, px, .035, pz, m.wheat);
                            const head = k.cone(.055, .13, px, h, pz, (row + stalk) % 4 ? m.wheat : m.leaf); head.rotation.z = .2;
                        }
                    }
                    k.fence(fx - w / 2 - .12, fz, d + .2, Math.PI / 2);
                    box(.35, .17, .35, fx - w / 2 + .25, .02, fz + d / 2 + .05, m.wheat);
                }
            }
            continue;
        }
        const width = main ? 4.3 : inside ? 3.2 : 3.5, depth = main ? 3.65 : 3.2;
        const working = type==='smithy'||type==='workshop'||type==='barracks'||type==='stables';
        box(width, .045, depth, x, -.02, z, working ? m.earth : m.road);
        // Low kerbs, entrance steps and planting ground every district visually.
        box(width, .08, .07, x, .005, z - depth / 2, m.light);
        for (const side of [-1, 1]) box(.07, .08, depth, x + side * width / 2, .005, z, m.light);
        for (const side of [-1, 1]) box(width / 2 - .55, .08, .07, x + side * (width / 4 + .275), .005, z + depth / 2, m.light);
        for (const side of [-1, 1]) {
            const px = x + side * (width / 2 - .3), pz = z + depth / 2 - .34;
            box(.42, .17, .42, px, .02, pz, m.stone);
            rock(.24, px, .18, pz, faction === 'undead' || faction === 'demon' ? m.darkStone : m.leaf);
        }
        if (main) {
            // A paved civic forecourt reads as the settlement's centre at every growth stage.
            box(4.3, .026, 1.8, x, -.015, z + 2.5, m.road);
            for (const side of [-1, 1]) {
                cylinder(.22, .12, x + side * 1.65, .02, z + 2.65, m.stone);
                cylinder(.07, .72, x + side * 1.65, .14, z + 2.65, m.light);
                rock(.16, x + side * 1.65, .87, z + 2.65, m.gold);
                box(.85, .07, .22, x + side * 1.1, .25, z + 3.1, m.wood);
                for (const dx of [-.3, .3]) box(.05, .25, .05, x + side * 1.1 + dx, 0, z + 3.1, m.wood);
            }
        }
        if (type === 'academy') {
            box(.7, .04, .22, x - 1.2, .15, z + 1.1, m.wood);
            for (const dx of [-.28, .28]) box(.035, .15, .05, x - 1.2 + dx, 0, z + 1.1, m.wood);
        }
    }
    const group = k.finish(), surfaces=createCitySurfaces(plots,faction);
    if(surfaces.children.length)group.add(surfaces);
    group.name = 'Paved city districts and working yards'; return group;
}

export function createEmptyCityPlot(faction: Faction, riverside = false) {
    const k = cityKit(faction), { m, box, cylinder } = k;
    if (riverside) {
        box(1.8,.04,.7,-.15,.12,0,m.timber);
        for(const x of [-.95,.65])for(const z of [-.3,.3])cylinder(.035,.38,x,-.1,z,m.wood);
        const dock=k.finish();dock.name='Available riverside building site';return dock;
    }
    m.earth.color.lerp(m.road.color, .5);
    box(2.7, .025, 2.35, 0, -.015, 0, m.earth);
    for (const x of [-1.35, 1.35]) for (const z of [-1.175, 1.175]) {
        box(.45, .025, .05, x - Math.sign(x) * .2, .02, z, m.light);
        box(.05, .025, .45, x, .02, z - Math.sign(z) * .2, m.light);
        cylinder(.025, .18, x, .02, z, m.wood);
    }
    const group = k.finish(); group.name = 'Available building plot'; return group;
}

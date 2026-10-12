import * as THREE from 'three';
import { cityKit } from './modelKit';
import { type CityPlot } from './layout';
import type { Faction } from '../../../factions/domain/factions';

/** Shared material batches dress actual built plots. No decorative building fills an empty slot. */
export function createCityDistricts(plots: CityPlot[], faction: Faction) {
    const k = cityKit(faction), { m, box, cylinder, rock } = k;
    m.road.color.lerp(m.light.color, .35);
    for (const plot of plots) {
        if (!plot.level || plot.type === 'wall') continue;
        const { x, z, type } = plot, main = type === 'market', inside = plot.slot !== undefined && plot.slot < 16;
        const width = main ? 4.3 : inside ? 3.2 : 3.5, depth = main ? 3.65 : 3.2;
        box(width, .045, depth, x, -.02, z, m.road);
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
        if (type === 'lumber') {
            box(3.6, .018, 1.65, x - .5, -.01, z + 2.6, m.earth);
            for (let i = 0; i < 5; i++) {
                const log = cylinder(.1, 1, x - 1.8 + i * .23, .1, z + 2.4, m.timber);
                log.rotation.z = Math.PI / 2;
            }
        }
        if (type === 'quarry') for (let i = 0; i < 8; i++) rock(.32 + i % 3 * .16, x + 2 + i % 3 * .65, -.04, z - 2 + Math.floor(i / 3) * .65, i % 2 ? m.light : m.darkStone);
        if (type === 'farm') {
            for (const [dx, dz] of [[-2.45, .3], [0, 3.45]]) {
                box(2.4, .025, 2.5, x + dx, -.015, z + dz, m.earth);
                for (let row = 0; row < 9; row++) box(2.15, .09 + plot.level * .009, .09, x + dx, .01, z + dz - 1.1 + row * .25, m.wheat);
            }
        }
        if (type === 'academy') {
            box(.7, .04, .22, x - 1.2, .15, z + 1.1, m.wood);
            for (const dx of [-.28, .28]) box(.035, .15, .05, x - 1.2 + dx, 0, z + 1.1, m.wood);
        }
    }
    const group = k.finish(); group.name = 'Paved city districts and working yards'; return group;
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

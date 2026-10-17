import type { Faction } from '../../../factions/domain/factions';
import { visualLevel } from './buildingModels';
import { cityKit } from './modelKit';
import { cityFootprint, riverX } from './layout';

/** Open gateways and water arches; thicker walls keep the playable plots clear. */
export function createCityWalls(value: number, mainLevel = 0, faction: Faction = 'roman', animated = false) {
    const level = visualLevel(value), k = cityKit(faction, animated), { m, box, cylinder, cone } = k;
    m.light.color.lerp(m.stone.color, .3); m.stone.color.multiplyScalar(.95);
    const f = cityFootprint(mainLevel);
    // The scene anchors this object at the historical northern wall selector.
    const left = f.left + .4, right = f.right + .4, back = 0, front = f.front + 9;
    const river = riverX(f.front) + .4, northRiver = riverX(f.back) + .4;
    const wallHeight = (foreground: boolean) => foreground ? .48 + level * .15 : .57 + level * .19;
    function section(x1: number, z1: number, x2: number, z2: number, nx: number, nz: number, foreground = false) {
        const length = Math.hypot(x2 - x1, z2 - z1); if (length < .05) return;
        const angle = -Math.atan2(z2 - z1, x2 - x1), h = wallHeight(foreground), x = (x1 + x2) / 2, z = (z1 + z2) / 2;
        if (!level) { box(length, .045, .26, x, -.005, z, m.darkStone, angle); return; }
        box(length, .12, level < 3 ? .4 : .72, x, 0, z, level < 3 ? m.earth : m.darkStone, angle);
        if (level <= 2) {
            const count = Math.ceil(length / .28);
            for (let i = 0; i < count; i++) {
                const t = (i + .5) / count, px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t;
                box(.23, h, .25, px, .08, pz, i % 4 ? m.wood : m.timber, angle); cone(.16, .2, px, h + .08, pz, m.timber);
            }
            for (const y of [.24, h * .72]) box(length, .09, .3, x - nx * .03, y, z - nz * .03, m.timber, angle);
        } else {
            box(length, h, .54, x, .1, z, m.stone, angle);
            box(length, .085, .66, x, h + .06, z, m.light, angle);
            // Inset wall walk and parapet: the top no longer reads as a razor edge.
            box(length, .16, .17, x + nx * .24, h + .14, z + nz * .24, m.stone, angle);
            const count = Math.ceil(length / .67);
            for (let i = 0; i < count; i++) {
                const t = (i + .5) / count;
                box(.29, .22, .23, x1 + (x2 - x1) * t + nx * .24, h + .3, z1 + (z2 - z1) * t + nz * .24, m.light, angle);
            }
            // Sparse stone courses and projecting buttresses break up long flat runs.
            box(length, .035, .565, x, .36, z, m.darkStone, angle);
            const bays = Math.ceil(length / 3.2);
            for (let i = 1; i < bays; i++) {
                const t = i / bays, px = x1 + (x2 - x1) * t + nx * .23, pz = z1 + (z2 - z1) * t + nz * .23;
                box(.28, h * .78, .44, px, .1, pz, m.darkStone, angle);
                box(.34, .09, .48, px, .1 + h * .78, pz, m.stone, angle);
            }
        }
    }
    function bastion(x: number, z: number, foreground: boolean, riverside = false) {
        const h = wallHeight(foreground) + .5, r = riverside ? .32 : .49;
        box(r * 2.45, .18, r * 2.45, x, 0, z, level < 3 ? m.wood : m.darkStone);
        if (level < 3) { box(r * 1.8, h, r * 1.8, x, .15, z, m.wood); k.roof(r * 2.6, .33, r * 2.6, x, h + .15, z, m.slate); }
        else { k.tower(x, z, h, r); cylinder(r * 1.04, .1, x, h * .43, z, m.darkStone); }
        if (level >= 4 && !riverside) k.flag(x, h + .18, z, .65);
    }
    function waterPassage(x: number, z: number) {
        if (!level) return;
        if (level < 3) {
            for (const side of [-1, 1]) box(.16, .94, .3, x + side * .94, 0, z, m.wood);
            box(2.1, .17, .34, x, .9, z, m.timber); return;
        }
        for (const side of [-1, 1]) box(.23, .48, .62, x + side * .96, .02, z, m.darkStone);
        for (let i = 0; i < 11; i++) {
            const angle = i * Math.PI / 10;
            const stone = box(.28, .22, .62, x + Math.cos(angle) * .94, .38 + Math.sin(angle) * .78, z, i % 2 ? m.stone : m.light);
            stone.rotation.z = angle - Math.PI / 2;
        }
    }
    const gateWidth = 3.1 + level * .12, gateX = .4, eastGate = 11.4;
    section(left, back, -.7, back, 0, -1);
    section(.7, back, northRiver - 1.08, back, 0, -1);
    section(northRiver + 1.08, back, right, back, 0, -1);
    section(left, back, left, front, -1, 0);
    section(right, back, right, eastGate - .8, 1, 0);
    section(right, eastGate + .8, right, front, 1, 0);
    section(left, front, gateX - gateWidth / 2, front, 0, 1, true);
    section(gateX + gateWidth / 2, front, river - 1.08, front, 0, 1, true);
    section(river + 1.08, front, right, front, 0, 1, true);
    waterPassage(northRiver, back); waterPassage(river, front);
    if (level >= 2) {
        for (const z of [back, front]) { bastion(left, z, z === front); bastion(right + .15, z, z === front, true); }
        // Rear postern and bridge gate frame their roads without blocking them.
        for (const side of [-1, 1]) {
            box(.2, 1.05 + level * .06, .45, side * .8, 0, back, level < 3 ? m.wood : m.stone);
            box(.45, .95 + level * .05, .2, right, 0, eastGate + side * .93, level < 3 ? m.wood : m.stone);
        }
        box(1.8, .16, .5, 0, 1.05 + level * .06, back, level < 3 ? m.timber : m.light);
    }
    if (level >= 3) {
        // Wall access stays in the spare northern border, away from building lots.
        const h = wallHeight(false);
        for (let step = 0; step < 6; step++) box(.58, h * (step + 1) / 6, .24, left + .65, .08, back + 1.6 - step * .24, m.stone);
    }
    const perimeter = k.finish(), g = cityKit(faction, animated), { m: gm } = g;
    // An open twin-tower gatehouse on the front avenue. No geometry closes the road.
    const h = .95 + level * .19, spacing = gateWidth / 2 - .43;
    for (const side of [-1, 1]) {
        if (level < 3) { g.box(.3, level ? h : .2, .4, side * spacing, 0, 0, gm.wood); if (level) g.roof(.8, .3, .85, side * spacing, h, 0, gm.slate); }
        else { g.box(1.02, .18, 1.18, side * spacing, 0, 0, gm.darkStone); g.tower(side * spacing, 0, h + .35, .43); }
    }
    if (level) {
        g.box(gateWidth - .2, .22, .62, 0, h - .25, 0, level < 3 ? gm.timber : gm.stone);
        g.box(1.4, .13, .7, 0, h - .03, 0, level < 3 ? gm.wood : gm.light);
        g.box(.24, .32, .05, 0, h + .1, -.34, gm.roof);
        if (level >= 3) for (let i = 0; i < 7; i++) g.box(.035, .3, .035, -.55 + i * .185, h - .47, .1, gm.dark);
        if (level >= 4) for (const side of [-1, 1]) g.flag(side * spacing, h + .55, 0, .7);
    }
    const gate = g.finish(); gate.position.set(gateX, 0, front); gate.rotation.y = Math.PI; gate.name = 'Front city gate';
    perimeter.add(gate); perimeter.name = `City perimeter level ${level}`; return perimeter;
}

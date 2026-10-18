import type { Faction } from '../../../factions/domain/factions';
import { visualLevel } from './buildingModels';
import { cityKit } from './modelKit';
import { cityFootprint, riverX } from './layout';
import { createCityGate, createCityWaterGate } from './gateModels';

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
    const gateWidth = 3.1 + level * .12, gateX = .4, eastGate = 11.4;
    section(left, back, -1.1, back, 0, -1);
    section(1.1, back, northRiver - 1.08, back, 0, -1);
    section(northRiver + 1.08, back, right, back, 0, -1);
    section(left, back, left, front, -1, 0);
    section(right, back, right, eastGate - 1.1, 1, 0);
    section(right, eastGate + 1.1, right, front, 1, 0);
    section(left, front, gateX - gateWidth / 2, front, 0, 1, true);
    section(gateX + gateWidth / 2, front, river - 1.08, front, 0, 1, true);
    section(river + 1.08, front, right, front, 0, 1, true);
    if (level >= 2) for (const z of [back, front]) { bastion(left, z, z === front); bastion(right + .15, z, z === front, true); }
    if (level >= 3) {
        // Wall access stays in the spare northern border, away from building lots.
        const h = wallHeight(false);
        for (let step = 0; step < 6; step++) box(.58, h * (step + 1) / 6, .24, left + .65, .08, back + 1.6 - step * .24, m.stone);
    }
    const perimeter = k.finish();
    const gate = createCityGate(level, faction, animated);
    gate.position.set(gateX, 0, front); gate.rotation.y = Math.PI; gate.name = 'Front city gate';
    const rear = createCityGate(level, faction, animated, 'postern');
    rear.position.set(0, 0, back); rear.name = 'Rear city gate';
    const bridge = createCityGate(level, faction, animated, 'bridge');
    bridge.position.set(right, 0, eastGate); bridge.rotation.y = -Math.PI / 2; bridge.name = 'Bridge city gate';
    const northWater = createCityWaterGate(level, wallHeight(false), faction);
    northWater.position.set(northRiver, 0, back);
    const southWater = createCityWaterGate(level, wallHeight(true), faction);
    southWater.position.set(river, 0, front); southWater.rotation.y = Math.PI;
    perimeter.add(gate, rear, bridge, northWater, southWater);
    perimeter.name = `City perimeter level ${level}`; return perimeter;
}

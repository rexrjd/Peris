import type {Faction} from '../../../factions/domain/factions';
import { createBuildingModel, visualLevel } from './buildingModels';
import { cityKit } from './modelKit';
import { cityFootprint, riverX } from './layout';

/** Enclose the city; roads and the river retain real openings through the walls. */
export function createCityWalls(value: number, mainLevel = 0,faction:Faction='roman') {
    const level = visualLevel(value), k = cityKit(faction);
    const { m, box, cone, tower } = k;
    // Coordinates are relative to the northern gate at (-.4, -9).
    const footprint=cityFootprint(mainLevel);
    const left=footprint.left+.4,right=footprint.right+.4,back=0,front=footprint.front+9;
    const river=riverX(footprint.front)+.4;
    function section(x1: number, z1: number, x2: number, z2: number, foreground = false) {
        const length = Math.hypot(x2 - x1, z2 - z1), angle = -Math.atan2(z2 - z1, x2 - x1);
        const height = foreground ? .36 + level * .14 : .4 + level * .23;
        const centerX = (x1 + x2) / 2, centerZ = (z1 + z2) / 2;
        if (!level) { box(length, .055, .2, centerX, 0, centerZ, m.darkStone, angle); return; }
        if (level <= 2) {
            const count = Math.ceil(length / .26);
            for (let i = 0; i < count; i++) {
                const t = (i + .5) / count, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
                box(.2, height, .2, x, 0, z, m.wood, angle); cone(.14, .16, x, height, z, m.timber);
            }
            if (level === 2) for (const y of [.2, height * .68]) box(length, .08, .24, centerX, y, centerZ, m.timber, angle);
        } else {
            box(length, height, .32, centerX, 0, centerZ, m.stone, angle);
            box(length, .1, .38, centerX, height - .1, centerZ, m.light, angle);
            const count = Math.ceil(length / .55);
            for (let i = 0; i < count; i++) {
                const t = (i + .5) / count;
                box(.24, .2, .38, x1 + (x2 - x1) * t, height, z1 + (z2 - z1) * t, m.light, angle);
            }
        }
    }
    const gateWidth = 2.9 + level * .08;
    section(left, back, -gateWidth / 2, back);
    section(gateWidth / 2, back, 8.95, back);
    section(10.5, back, right, back); // Northern water passage.
    section(left, back, left, front);
    section(right, back, right, front);
    section(left, front, -.65, front, true);
    section(.85, front, river-.9, front, true);
    section(river+.9, front, right, front, true); // Southern water passage.
    if (level >= 2) for (const x of [left, right]) for (const z of [back, front]) {
        const height = z === front ? .95 + level * .16 : 1.05 + level * .24;
        if (level === 2) {
            box(.5, height, .5, x, 0, z, m.wood); k.roof(.7, .3, .7, x, height, z);
        } else tower(x, z, height, .34, level === 4);
    }
    if (level >= 3) for (const x of [-.75, .95]) tower(x, front, 1.2 + level * .1, .23);
    if (level === 5) for (const x of [left, right]) k.flag(x, 2.35, back);
    const perimeter = k.finish();
    const gate = createBuildingModel('wall', level,faction);
    // Flatten both groups so every wall segment uses the existing building picker.
    perimeter.add(...[...gate.children]);
    perimeter.name = `City perimeter level ${level}`;
    return perimeter;
}

import * as THREE from 'three';
import type { Faction } from '../../../factions/domain/factions';
import { cityKit } from './modelKit';
import { visualLevel } from './buildingModels';

export type CityResource = 'lumber' | 'quarry' | 'farm' | 'fishery';
export const isCityResource = (type: string | null): type is CityResource => type === 'lumber' || type === 'quarry' || type === 'farm' || type === 'fishery';

/** City-only working silhouettes. The world map keeps its bounded field models. */
export function createCityResource(type: CityResource, value: number, faction: Faction = 'roman', animated = false) {
    const level = visualLevel(value), k = cityKit(faction, animated);
    const { m, box, cylinder, cone, house, roof } = k;
    if (!level) {
        box(2.4, .025, 2.2, 0, -.015, 0, m.earth);
        for (const x of [-1.1, 1.1]) for (const z of [-1, 1]) box(.055, .2, .055, x, 0, z, m.wood);
    } else if (type === 'lumber') {
        house(-.45, -.5, 1.55, 1.2, .8 + level * .07, level >= 4, m.slate);
        // Open cutting shed, big flywheel and bark-on logs are readable from above.
        for (const x of [.55, 1.55]) for (const z of [-.75, .25]) box(.085, .95, .085, x, 0, z, m.wood);
        roof(1.2, .28, 1.2, 1.05, .95, -.25, m.roofLight);
        box(1.2, .09, .45, .9, .35, .65, m.wood);
        for (const x of [.45, 1.35]) box(.08, .35, .4, x, 0, .65, m.wood);
        for (let i = 0; i < 3 + level; i++) {
            const x = -.95 + (i % 3) * .12, y = .15 + Math.floor(i / 3) * .24, z = .62 + (i % 3) * .26;
            const bark = cylinder(.135, 1.25, x, 0, z, m.wood); bark.rotation.z = Math.PI / 2; bark.position.y = y;
            for (const end of [-1, 1]) { const cut = cylinder(.105, .018, x + end * .63, 0, z, m.timber); cut.rotation.z = Math.PI / 2; cut.position.y = y; }
        }
        if (level >= 2) {
            const wheel = new THREE.Group(); wheel.position.set(1.18, .57, .31); k.group.add(wheel);
            const rim = cylinder(.46, .12, 0, 0, 0, m.dark); rim.rotation.x = Math.PI / 2; rim.position.y = 0; wheel.add(rim);
            for (let i = 0; i < 8; i++) {
                const angle = i * Math.PI / 4, spoke = box(.07, .72, .045, 0, -.36, .075, m.timber); spoke.rotation.z = angle; wheel.add(spoke);
                const tooth = box(.12, .13, .15, Math.sin(angle) * .46, Math.cos(angle) * .46 - .065, 0, m.wood); tooth.rotation.z = -angle; wheel.add(tooth);
            }
            const hub = cylinder(.09, .07, 0, 0, .11, m.gold); hub.rotation.x = Math.PI / 2; hub.position.y = 0; wheel.add(hub); k.motion(wheel, 'spinSlow');
        }
        if (level >= 3) { box(.24, 1.5, .25, -.85, 0, -.65, m.darkStone); box(.32, .08, .33, -.85, 1.5, -.65, m.stone); }
        if (level >= 4) for (let i = 0; i < 4; i++) box(.12, .1, 1.15, 1.12 + i * .14, i * .1, -1.1, m.timber);
        if (level >= 5) { roof(1.7, .25, .8, -.6, 1.1, 1.0, m.slate); for (const x of [-1.35, .15]) box(.065, 1.1, .065, x, 0, 1.25, m.wood); k.flag(-.7, 1.4, -.9, .65); }
    } else if (type === 'quarry') {
        // Broad stepped cut faces, rather than a heap of round stones.
        for (let tier = 0; tier < 2 + Math.floor(level / 2); tier++) {
            const width = 3.35 - tier * .45, z = -.6 - tier * .22;
            box(width, .27, 1.75 - tier * .29, -.05 + tier * .08, tier * .27, z, tier % 2 ? m.stone : m.darkStone);
            for (let cut = 0; cut < 4; cut++) box(.025, .22, .02, -width / 2 + .4 + cut * width / 4, tier * .27 + .025, z + (1.75 - tier * .29) / 2 + .012, m.darkStone);
        }
        for (let i = 0; i < 4; i++) k.rock(.22 + i % 2 * .12, -1.3 + i * .77, .5 + level * .1, -1.15, m.stone);
        for (let i = 0; i < level + 2; i++) box(.31, .23, .38, .65 + i % 3 * .35, Math.floor(i / 3) * .24, 1, m.light);
        if (level >= 2) {
            const h = 1.5 + level * .13;
            box(.17, h, .17, -.5, 0, .15, m.wood); box(2.15, .16, .19, .2, h - .16, .15, m.timber);
            const brace = box(.1, .95, .1, -.18, h - .97, .15, m.wood); brace.rotation.z = -.55;
            cylinder(.025, h - .62, 1.05, .62, .15, m.dark);
            const pulley = cylinder(.13, .11, 1.05, h - .27, .15, m.dark); pulley.rotation.x = Math.PI / 2;
            k.motion(box(.39, .34, .41, 1.05, .33, .15, m.stone), 'lift');
        }
        if (level >= 3) { house(-1.05, .8, .7, .62, .52, false, m.slate); box(.6, .08, .35, -.8, .3, 1.25, m.wood); }
        if (level >= 4) for (const x of [-.13, .13]) { box(.045, .045, .95, x, .025, .9, m.dark); }
        if (level >= 5) { box(.55, .22, .5, 0, .1, .95, m.timber); for (const x of [-.3, .3]) { const wheel = cylinder(.12, .06, x, .02, 1.0, m.dark); wheel.rotation.z = Math.PI / 2; } k.flag(-.5, 2.15, .15, .65); }
    } else if (type === 'farm') {
        house(.35, -.6, 1.45, 1.1, .78 + level * .055, level >= 4, m.roof);
        // Barn doors and an open loading canopy make this distinct from housing.
        box(.6, .58, .045, .35, 0, -.025, m.wood);
        for (const x of [.08, .62]) box(.035, .58, .055, x, 0, 0, m.timber);
        roof(1.55, .15, .6, .35, .72, .3, m.roofLight);
        for (const x of [-.3, 1]) box(.055, .72, .055, x, 0, .5, m.wood);
        for (let i = 0; i < Math.min(4, level + 1); i++) { cylinder(.15, .24, .65 + i % 2 * .33, Math.floor(i / 2) * .24, 1.02, m.wheat); }
        if (level >= 2) {
            const x = -1.12, z = -.48, h = 1.35 + level * .13;
            cylinder(.32 + level * .018, h, x, 0, z, level >= 3 ? m.light : m.timber); roof(.92, .45, .92, x, h, z, m.slate);
            const sails = new THREE.Group(); sails.position.set(x, h * .74, z + .48); k.group.add(sails);
            for (const angle of [Math.PI / 4, -Math.PI / 4]) {
                const spar = box(1.95, .075, .065, 0, -.0375, 0, m.wood); spar.rotation.z = angle; sails.add(spar);
                for (const side of [-1, 1]) { const sail = box(.65, .2, .035, Math.cos(angle) * side * .58, Math.sin(angle) * side * .58 - .1, .05, m.light); sail.rotation.z = angle; sails.add(sail); }
            }
            const hub = cylinder(.1, .1, 0, 0, .1, m.gold); hub.rotation.x = Math.PI / 2; hub.position.y = 0; sails.add(hub); k.motion(sails, 'spinSlow');
        }
        if (level >= 3) { cylinder(.25, 1.25, 1.4, 0, -.75, m.wheat); cone(.34, .32, 1.4, 1.25, -.75, m.slate); }
        if (level >= 4) { box(.55, .25, .5, -1.0, 0, 1.0, m.wheat); box(.65, .25, .5, -1.02, .25, 1.0, m.wheat); }
        if (level >= 5) k.flag(.7, 1.38, -.7, .7);
    } else {
        // A real bankside hut, landing and moored boat; river flows underneath.
        house(-1.03, -.38, .85, 1.05, .65 + level * .04, level >= 4, m.slate);
        for (let i = 0; i < 10; i++) box(1.55, .075, .13, .15, .16, -.62 + i * .15, m.timber);
        for (const x of [-.56, .85]) for (const z of [-.65, .8]) { cylinder(.055, .65, x, -.2, z, m.wood); cylinder(.085, .055, x, .45, z, m.timber); }
        box(1.05, .08, .55, -.85, .14, .4, m.wood);
        box(.45, .13, 1.25, .1, .04, 1.4, m.wood);
        for (const x of [-.22, .22]) box(.065, .16, 1.12, .1 + x, .12, 1.4, m.timber);
        for (const z of [1.1, 1.7]) box(.45, .055, .1, .1, .2, z, m.timber);
        if (level >= 2) { box(.035, .85, .035, .5, .25, .25, m.wood); k.motion(box(.8, .035, .035, .83, 1.05, .25, m.timber, -.2), 'fishing'); }
        if (level >= 3) { roof(1.1, .18, .8, .05, 1.15, -.3, m.roofLight); for (const x of [-.45, .55]) box(.045, .95, .045, x, .2, -.6, m.wood); }
        for (let i = 0; i < level; i++) cylinder(.1, .18, -1.4 + i % 3 * .23, Math.floor(i / 3) * .18, .65, m.timber);
        if (level >= 4) for (let i = 0; i < 6; i++) box(.03, .45, .03, -.62 + i * .22, .55, -.7, m.light);
        if (level >= 5) k.flag(-1.05, 1.15, -.65, .6);
    }
    if (level) k.heraldry(level);
    const model = k.finish(); model.name = `City ${type} level ${level}`;
    model.userData.citySmoke = type === 'lumber' && level >= 3 ? [-.85, 1.6, -.65] : null;
    return model;
}

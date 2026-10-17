import type { Faction } from '../../../factions/domain/factions';
import { cityKit } from './modelKit';

/** City-only garrison: a broad drill yard and substantial rear/side wings. */
export function createCityBarracks(level: number, faction: Faction, animated = false) {
    const k = cityKit(faction, animated), { m, box, cylinder, house, tower } = k;
    const stone = level >= 3;
    box(3.05, .04, 3.1, 0, -.02, -.03, m.road);
    if (faction === 'orc') for (const x of [-.7,.7]) house(x,-.8,1.15,.85,.92+level*.09,stone,m.slate);
    else house(0, -1, 2.65, .9, .92 + level * .09, stone, m.slate);
    for (const x of [-.92, 0, .92]) box(.24, .6, .035, x, .04, -.53, m.dark);
    house(-1.05, -.12, .55, 1.03, .62 + level * .045, stone);
    box(2.2, .022, 1.55, .18, .028, .6, m.earth);
    // Targets and racks are visible even while nobody is training.
    for (const x of [-.65, .25, 1.1]) {
        cylinder(.035, .65, x, .05, -.36, m.wood);
        const target = cylinder(.17, .045, x, .43, -.34, m.wheat); target.rotation.x = Math.PI / 2;
        const centre = cylinder(.065, .05, x, .43, -.31, m.roof); centre.rotation.x = Math.PI / 2;
    }
    if (level >= 2) {
        box(.06, .55, .06, 1.4, .02, .8, m.wood); box(.65, .06, .06, 1.15, .43, .8, m.timber);
        for (const x of [.95, 1.15, 1.35]) box(.025, .57, .025, x, .04, .8, m.dark);
        k.flag(-1.3, 1.35, -1.1, .7);
    }
    if (level >= 3) for (const x of [-1.35, 1.35]) tower(x, -1.08, 1.85, .23);
    if (level >= 4) {
        house(1.18, -.75, .52, .65, 1.1, true, m.roofLight);
        for (const x of [-1.5, 1.5]) box(.07, .27, 1.5, x, .03, .7, m.stone);
    }
    if (level >= 5) {
        tower(0, -1.18, 2.8, .32, true); k.flag(0, 3.02, -1.18, .85);
        for (const x of [-.55, .55]) box(.13, .45, .045, x, 1.12, -.53, m.gold);
    }
    k.heraldry(level);
    const model = k.finish(); model.name = `City barracks level ${level}`; return model;
}

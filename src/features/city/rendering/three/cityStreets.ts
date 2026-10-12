import { cityFootprint, riverX, type CityPlot } from './layout';
import { slotCount } from '../../domain/slots';

export type CityStreet = { from: [number, number]; to: [number, number]; width: number };
/** Landscape coordinates. Buildings face their cross-street instead of a radial hub. */
export function cityStreets(mainLevel: number): CityStreet[] {
    const footprint = cityFootprint(mainLevel), rows = Math.ceil(slotCount(mainLevel) / 4);
    const streets: CityStreet[] = [];
    const road = (x: number, z: number, x2: number, z2: number, width = .5) => streets.push({ from: [x, z], to: [x2, z2], width });
    road(0, -4.2, 0, footprint.front, mainLevel >= 2 ? 1.1 : .8);
    road(-.4, -12, -.4, -7.6, .8);
    for (let row = 0; row < rows; row++) road(-7.6, -.25 + row * 4, 7.6, -.25 + row * 4, .65);
    road(-7.6, -.25, -7.6, footprint.front - 1.2, .42);
    road(7.6, -.25, 7.6, footprint.front - 1.2, .42);
    road(7.6, 2.4, 11.4, 2.4, .58);
    road(0, footprint.front, 0, footprint.outsideRoad, .8);
    road(-12, footprint.outsideRoad, 13, footprint.outsideRoad, .7);
    road(-9.9, -2.3, -9.9, footprint.outsideRoad, .6);
    road(-9.9, -2.3, -12, -2.3, .5);
    road(-9.9, 6.7, -12, 6.7, .5);
    road(11.6, -2.3, 11.6, footprint.outsideRoad, .6);
    road(11.6, -2.3, 13, -2.3, .5);
    road(0, footprint.outsideRoad, riverX(footprint.fishingZ)-.85, footprint.fishingZ, .6);
    return streets;
}

/** The same streets guide visual walkers; they stop at entrances, clear of roofs. */
export function cityWalkRoute(plot: CityPlot, growth: number, mainLevel: number): [number, number][] {
    const f = cityFootprint(mainLevel), x = plot.x / growth, z = plot.z / growth;
    if (plot.type === 'market') return [[0, -.25], [0, -4.2]];
    if (plot.slot !== undefined && plot.slot < 16) return [[0, -.25], [0, z + 1.75], [x, z + 1.75], [x, z + 1.35]];
    if (plot.slot === 16) return [[0, -.25], [0, f.front], [0, f.outsideRoad], [x-.85, z]];
    const lane = x < 0 ? -9.9 : 11.6;
    return [[0, -.25], [0, f.front], [0, f.outsideRoad], [lane, f.outsideRoad], [lane, z + 1.7], [x, z + 1.7]];
}
export function cityTerrainHeight(x: number, z: number, mainLevel: number) {
    const flat = Math.abs(x) < 18 && z > -12 && z < cityFootprint(mainLevel).fishingZ + 2;
    if (flat || Math.abs(x - riverX(z)) < 1.3) return -.04;
    return Math.max(0, -z - 14) * .07 + Math.max(0, Math.abs(x) - 18) * .035 + Math.sin(x * .12) * Math.sin(z * .16) * .1 - .04;
}

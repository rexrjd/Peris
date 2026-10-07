import { type BuildingType } from '../../domain/types';

/** Stable world positions keep landmarks recognisable as the city develops. */
export const CITY_PLOTS: { type: BuildingType; x: number; z: number; radius: number }[] = [
    { type: 'wall', x: -.4, z: -6.8, radius: 2.25 },
    { type: 'lumber', x: -6.4, z: -4.3, radius: 1.9 },
    { type: 'quarry', x: 6.5, z: -4.3, radius: 1.9 },
    { type: 'market', x: -.3, z: 1.2, radius: 2.2 },
    { type: 'barracks', x: 6.5, z: 2.6, radius: 1.9 },
    { type: 'farm', x: -6.4, z: 2.6, radius: 2 },
    { type: 'storehouse', x: -2.3, z: 7.4, radius: 1.85 },
    { type: 'stables', x: 4.8, z: 8, radius: 1.9 },
];

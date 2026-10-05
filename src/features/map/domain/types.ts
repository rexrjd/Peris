import { type Terrain } from '../../battle/domain/types';
export type Camp = {
    id: number;
    name: string;
    x: number;
    y: number;
    tier: number;
    terrain: Terrain;
    infantry: number;
    archers: number;
    cavalry: number;
    description: string;
};
export type MapSelection = {
    kind: 'camp' | 'settlement' | 'army';
    id: number;
} | null;

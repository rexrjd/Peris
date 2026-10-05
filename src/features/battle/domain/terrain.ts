import { type Terrain } from './types';
export function terrainAt(terrain: Terrain, x: number, y: number): {
    kind: string;
    speed: number;
    cover: number;
    height: number;
} {
    if (terrain === 'woods' && ((x > 420 && x < 630 && y > 65 && y < 310) || (x > 690 && x < 960 && y > 405 && y < 665)))
        return { kind: 'Forest', speed: .68, cover: .6, height: 0 };
    if (terrain === 'highlands' && ((x - 650) ** 2 / 190 ** 2 + (y - 285) ** 2 / 135 ** 2 < 1))
        return { kind: 'High ground', speed: .85, cover: 1, height: 1 };
    if (terrain === 'river' && Math.abs(x - (600 + Math.sin(y / 110) * 32)) < 42 && (y < 306 || y > 395))
        return { kind: 'Shallows', speed: .42, cover: 1, height: 0 };
    return { kind: 'Open ground', speed: 1, cover: 1, height: 0 };
}

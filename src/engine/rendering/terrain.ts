import { type Terrain } from '../../features/battle/domain/types';
import { WORLD_H, WORLD_W } from '../../features/map/domain/dimensions';
import { FIELD_H, FIELD_W } from '../../features/battle/domain/dimensions';
import { seeded } from '../../shared/math/random';
import { gameImage } from '../../shared/rendering/assets';
import { ellipse } from '../../shared/rendering/primitives';
import { drawMapTerrain } from '../../features/map/rendering/terrain';
import { drawBattleTerrain } from '../../features/battle/rendering/terrain';
export function makeTerrain(mode: 'world' | 'battle', terrain: Terrain = 'plains'): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = mode === 'world' ? WORLD_W : FIELD_W;
    canvas.height = mode === 'world' ? WORLD_H : FIELD_H;
    const c = canvas.getContext('2d')!, w = canvas.width, h = canvas.height, rng = seeded(mode === 'world' ? 98213 : 7230 + terrain.length);
    c.fillStyle = mode === 'world' ? '#aaa879' : '#969568';
    c.fillRect(0, 0, w, h);
    const grad = c.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#d0bd8025');
    grad.addColorStop(.5, '#61704738');
    grad.addColorStop(1, '#c2ad613a');
    c.fillStyle = grad;
    c.fillRect(0, 0, w, h);
    const ground = gameImage('ground');
    if (ground.complete && ground.naturalWidth) {
        c.save();
        c.globalAlpha = .74;
        c.filter = 'blur(.65px)';
        c.drawImage(ground, 0, 0, w, h);
        c.restore();
        c.fillStyle = mode === 'world' ? '#d1be8c22' : '#63775622';
        c.fillRect(0, 0, w, h);
    }
    for (let i = 0; i < 6000; i++) {
        const x = rng() * w, y = rng() * h, r = rng() * 13 + 1;
        ellipse(c, x, y, r, r * .42, rng() > .5 ? '#e5d6950c' : '#263c2709');
    }
    for (let i = 0; i < 1400; i++) {
        const x = rng() * w, y = rng() * h;
        c.strokeStyle = rng() > .6 ? '#656f4128' : '#cfbd7735';
        c.lineWidth = .8;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 2, y - 3);
        c.stroke();
    }
    if (mode === 'world')
        drawMapTerrain(c, w, h, rng);
    else
        drawBattleTerrain(c, w, h, rng, terrain);
    const vignette = c.createRadialGradient(w / 2, h / 2, h * .15, w / 2, h / 2, w * .65);
    vignette.addColorStop(0, '#151e1700');
    vignette.addColorStop(1, '#19241b50');
    c.fillStyle = vignette;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#37443866';
    c.lineWidth = 3;
    c.strokeRect(12, 12, w - 24, h - 24);
    return canvas;
}

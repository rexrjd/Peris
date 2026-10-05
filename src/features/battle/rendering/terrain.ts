import { type Terrain } from '../domain/types';
import { ellipse, path } from '../../../shared/rendering/primitives';
import { tree } from '../../../shared/rendering/environment';
export function drawBattleTerrain(c: CanvasRenderingContext2D, w: number, h: number, rng: () => number, terrain: Terrain) {
    if (terrain === 'highlands') {
        for (let i = 8; i > 0; i--) {
            ellipse(c, 650, 285, 190 + i * 9, 135 + i * 6, `rgba(192,171,111,${.025 + i * .009})`);
        }
        const ridge = c.createRadialGradient(610, 225, 20, 650, 285, 225);
        ridge.addColorStop(0, '#dcce9770');
        ridge.addColorStop(.5, '#b6ac7950');
        ridge.addColorStop(1, '#5b654800');
        c.fillStyle = ridge;
        c.fillRect(420, 85, 480, 400);
        for (let i = 3; i >= 0; i--) {
            c.strokeStyle = '#d1c18c45';
            c.lineWidth = 1;
            c.beginPath();
            c.ellipse(650, 285, 190 - i * 30, 135 - i * 22, 0, 0, Math.PI * 2);
            c.stroke();
        }
    }
    if (terrain === 'river') {
        const river = [];
        for (let y = -30; y < h + 40; y += 15)
            river.push([600 + Math.sin(y / 110) * 32, y]);
        path(c, river, 89, '#687b6344');
        path(c, river, 77, '#647f7e');
        path(c, river, 62, '#789998');
        path(c, river.map(([x, y]) => [x - 25, y]), 2, '#c1ccb061');
        c.fillStyle = '#9f9b7b';
        c.fillRect(515, 305, 175, 91);
        c.fillStyle = '#bcb18d';
        c.fillRect(515, 313, 175, 73);
        c.strokeStyle = '#696d59';
        c.lineWidth = 4;
        c.strokeRect(515, 305, 175, 91);
        c.lineWidth = 1;
        for (let y = 320; y < 385; y += 10) {
            c.beginPath();
            c.moveTo(515, y);
            c.lineTo(690, y);
            c.stroke();
        }
    }
    const woods = terrain === 'woods' ? [[525, 185, 99, 115], [825, 535, 133, 122]] : [[40, 80, 65, 60], [1130, 645, 70, 45]];
    for (const [cx, cy, rx, ry] of woods) {
        const points = [];
        for (let i = 0; i < (terrain === 'woods' ? 130 : 40); i++) {
            const a = rng() * Math.PI * 2, r = Math.sqrt(rng());
            points.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
        }
        points.sort((a, b) => a[1] - b[1]);
        points.forEach(([x, y]) => tree(c, x, y, .5 + rng() * .5));
    }
    path(c, [[0, 350], [330, 346], [800, 348], [1200, 352]], 15, '#ccb98b32');
    for (let i = 0; i < 80; i++) {
        ellipse(c, rng() * w, rng() * h, 2 + rng() * 3, 1 + rng() * 2, '#5b65584b');
    }
    // Broken fence and field-edge stones make the landscape feel inhabited.
    for (const [x, y] of [[45, 470], [1085, 95]])
        for (let i = 0; i < 8; i++) {
            c.strokeStyle = '#676249';
            c.lineWidth = 1.5;
            c.beginPath();
            c.moveTo(x + i * 11, y - 6);
            c.lineTo(x + i * 11, y + 4);
            c.stroke();
            if (i < 7) {
                c.strokeStyle = '#9c926e';
                c.beginPath();
                c.moveTo(x + i * 11, y - 3);
                c.lineTo(x + (i + 1) * 11, y - 3);
                c.stroke();
            }
        }
}

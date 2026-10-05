import { path } from '../../../shared/rendering/primitives';
import { house, tree } from '../../../shared/rendering/environment';
import { environmentSprite } from '../../../shared/rendering/assets';
export function drawMapTerrain(c: CanvasRenderingContext2D, w: number, h: number, rng: () => number) {
    // Roads, irrigated fields, coastal ridges, and individually shaded tree clusters.
    path(c, [[155, 285], [305, 405], [420, 445], [655, 485], [910, 550], [1050, 660]], 23, '#56573b22');
    path(c, [[155, 285], [305, 405], [420, 445], [655, 485], [910, 550], [1050, 660]], 11, '#c3b585');
    path(c, [[305, 405], [460, 155], [605, 280], [790, 160], [1050, 280]], 9, '#c4b385');
    path(c, [[655, 485], [605, 280]], 8, '#c9b689');
    for (let i = 0; i < 22; i++) {
        const x = 160 + rng() * 220, y = 490 + rng() * 150;
        c.save();
        c.translate(x, y);
        c.rotate(-.25);
        c.fillStyle = i % 2 ? '#9c9b60' : '#b7a069';
        c.fillRect(-16, -9, 32, 18);
        c.strokeStyle = '#6e744744';
        c.lineWidth = 1;
        for (let k = -12; k < 15; k += 4) {
            c.beginPath();
            c.moveTo(k, -8);
            c.lineTo(k, 8);
            c.stroke();
        }
        c.restore();
    }
    const river = [];
    for (let y = -40; y < h + 50; y += 25)
        river.push([565 + Math.sin(y / 115) * 35, y]);
    path(c, river, 35, '#5a665947');
    path(c, river, 24, '#658e95');
    path(c, river, 18, '#769ba0');
    path(c, river.map(([x, y]) => [x - 6, y]), 2, '#c2d1ba66');
    c.save();
    c.translate(535, 425);
    c.rotate(.08);
    c.fillStyle = '#b4ac89';
    c.fillRect(-22, -9, 75, 20);
    c.strokeStyle = '#676d56';
    c.lineWidth = 3;
    c.strokeRect(-22, -9, 75, 20);
    c.restore();
    const forests = [[100, 100, 150, 85], [390, 105, 125, 90], [810, 340, 120, 90], [1000, 115, 110, 90], [410, 670, 100, 45], [100, 595, 95, 110]];
    for (const [cx, cy, rx, ry] of forests) {
        const points = [];
        for (let i = 0; i < 65; i++) {
            const a = rng() * Math.PI * 2, r = Math.sqrt(rng());
            points.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r, .55 + rng() * .6]);
        }
        points.sort((a, b) => a[1] - b[1]);
        for (const [x, y, size] of points)
            tree(c, x, y, size);
    }
    for (let i = 0; i < 30; i++) {
        const x = 680 + rng() * 170, y = 25 + rng() * 90, size = 20 + rng() * 30;
        const hill = environmentSprite('hill');
        if (hill) {
            const width = size * 1.6, height = width * hill.height / hill.width;
            c.drawImage(hill, x - width / 2, y - height + size * .4, width, height);
            continue;
        }
        c.fillStyle = '#898b71';
        c.beginPath();
        c.moveTo(x - size, y + size * .4);
        c.lineTo(x, y - size * .8);
        c.lineTo(x + size, y + size * .4);
        c.closePath();
        c.fill();
        c.fillStyle = '#b6b59c';
        c.beginPath();
        c.moveTo(x - size, y + size * .4);
        c.lineTo(x, y - size * .8);
        c.lineTo(x + 5, y + size * .4);
        c.closePath();
        c.fill();
    }
    const labels = [[260, 85, 'O A K W O O D'], [300, 600, 'THE WESTERN FIELDS'], [868, 70, 'THE HIGH COUNTRY'], [898, 696, 'ASHEN MARCHES']] as const;
    for (const [x, y, label] of labels) {
        c.font = 'italic 15px Georgia';
        c.fillStyle = '#3f4a3f77';
        c.textAlign = 'center';
        c.fillText(label, x, y);
    }
    for (let i = 0; i < 10; i++)
        house(c, 585 + rng() * 45, 278 + rng() * 25, .55, 'house', '#6e6553');
    for (let i = 0; i < 14; i++)
        house(c, 145 + rng() * 95, 250 + rng() * 75, .32 + rng() * .2, 'house', '#9c684a');
}

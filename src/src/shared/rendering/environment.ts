import { environmentSprite } from './assets';
import { ellipse } from './primitives';
import { seeded } from '../math/random';
export function tree(c: CanvasRenderingContext2D, x: number, y: number, size = 1, pine = false) {
    const sprite = environmentSprite('oak');
    if (sprite && !pine) {
        const width = 29 * size, height = width * sprite.height / sprite.width;
        c.drawImage(sprite, x - width / 2, y - height + 6 * size, width, height);
        return;
    }
    c.save();
    c.translate(x, y);
    c.scale(size, size);
    ellipse(c, 4, 5, 10, 5, '#202c2545');
    c.strokeStyle = '#65563a';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, 2);
    c.lineTo(0, -9);
    c.stroke();
    if (pine) {
        c.fillStyle = '#354933';
        c.beginPath();
        c.moveTo(0, -25);
        c.lineTo(-9, -5);
        c.lineTo(10, -5);
        c.closePath();
        c.fill();
        c.fillStyle = '#4e6240';
        c.beginPath();
        c.moveTo(0, -25);
        c.lineTo(-6, -7);
        c.lineTo(0, -7);
        c.closePath();
        c.fill();
    }
    else {
        const rng = seeded(Math.round(x * 37 + y * 13)), shade = c.createRadialGradient(-4, -17, 1, 0, -10, 14);
        shade.addColorStop(0, '#929166');
        shade.addColorStop(.4, '#5e7145');
        shade.addColorStop(1, '#293e2d');
        ellipse(c, 1, -9, 13, 13, '#233c2c');
        ellipse(c, 0, -12, 12, 12, shade);
        for (let i = 0; i < 18; i++) {
            const a = rng() * 6.28, r = rng() * 10;
            ellipse(c, Math.cos(a) * r, Math.sin(a) * r - 12, 2 + rng() * 3, 2 + rng() * 2, ['#91a06b70', '#7b895950', '#b4b67d40', '#263d2e66'][i % 4]);
        }
    }
    c.restore();
}
export function house(c: CanvasRenderingContext2D, x: number, y: number, scale = 1, kind = 'house', accent = '#a14d37') {
    const sprite = kind === 'keep' ? environmentSprite('keep') : null;
    if (sprite) {
        const width = 65 * scale, height = width * sprite.height / sprite.width;
        c.drawImage(sprite, x - width / 2, y - height + 7 * scale, width, height);
        return;
    }
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    ellipse(c, 5, 4, 19, 7, '#20231d4a');
    c.fillStyle = '#b9ae8b';
    c.fillRect(-13, -17, 25, 21);
    c.fillStyle = '#938e75';
    c.fillRect(6, -17, 6, 21);
    c.fillStyle = accent;
    c.beginPath();
    c.moveTo(-17, -17);
    c.lineTo(-3, -29);
    c.lineTo(16, -19);
    c.lineTo(2, -11);
    c.closePath();
    c.fill();
    c.fillStyle = '#ca8054';
    c.beginPath();
    c.moveTo(-17, -17);
    c.lineTo(-3, -29);
    c.lineTo(2, -11);
    c.closePath();
    c.fill();
    c.fillStyle = '#4e493b';
    c.fillRect(-7, -7, 5, 11);
    c.fillRect(4, -10, 4, 5);
    if (kind === 'keep') {
        c.fillStyle = '#c2bda0';
        c.fillRect(-18, -37, 11, 38);
        c.fillRect(12, -35, 10, 38);
        c.fillStyle = '#8e947f';
        c.fillRect(-10, -37, 3, 38);
        c.fillRect(19, -35, 3, 38);
        c.fillStyle = '#d2c9ab';
        for (let i = 0; i < 3; i++) {
            c.fillRect(-19 + i * 5, -41, 3, 7);
            c.fillRect(11 + i * 5, -39, 3, 7);
        }
        c.strokeStyle = '#5e563b';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, -30);
        c.lineTo(0, -57);
        c.stroke();
        c.fillStyle = accent;
        c.beginPath();
        c.moveTo(0, -56);
        c.lineTo(16, -52);
        c.lineTo(0, -46);
        c.closePath();
        c.fill();
    }
    c.restore();
}

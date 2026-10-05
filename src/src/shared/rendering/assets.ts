import { type UnitType } from '../../features/army/domain/types';
const paths = { ground: '/art/shared/meadow-ground.png', soldiers: '/art/battle/field-soldiers.png', props: '/art/shared/environment-props.png' } as const;
const cache = new Map<string, HTMLImageElement>();
export function gameImage(name: keyof typeof paths) {
    let image = cache.get(name);
    if (!image) {
        image = new Image();
        image.src = paths[name];
        cache.set(name, image);
    }
    return image;
}
const propFrames = { oak: [0, 54, 541, 566], keep: [544, 45, 517, 554], camp: [1079, 95, 450, 500], hill: [1537, 37, 511, 592] } as const;
export function environmentSprite(type: keyof typeof propFrames) {
    const key = `prop:${type}`, cached = sprites.get(key);
    if (cached)
        return cached;
    const atlas = gameImage('props');
    if (!atlas.complete || !atlas.naturalWidth)
        return null;
    const [x, y, w, h] = propFrames[type], canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = Math.round(128 * h / w);
    canvas.getContext('2d')!.drawImage(atlas, x, y, w, h, 0, 0, canvas.width, canvas.height);
    sprites.set(key, canvas);
    return canvas;
}
const frames: Record<UnitType, number[]> = { infantry: [58, 115, 613, 415], archers: [750, 165, 464, 405], cavalry: [1250, 146, 798, 401] };
const sprites = new Map<string, HTMLCanvasElement>();
export function unitSprite(type: UnitType, own: boolean) {
    const key = `${type}:${own}`, cached = sprites.get(key);
    if (cached)
        return cached;
    const atlas = gameImage('soldiers');
    if (!atlas.complete || !atlas.naturalWidth)
        return null;
    const [x, y, w, h] = frames[type], canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = Math.round(96 * h / w);
    const ctx = canvas.getContext('2d')!;
    if (!own)
        ctx.filter = 'grayscale(.7) sepia(.3) brightness(.85)';
    ctx.drawImage(atlas, x, y, w, h, 0, 0, canvas.width, canvas.height);
    sprites.set(key, canvas);
    return canvas;
}

/** Map-owned art: troop and battlefield atlases remain independent. */
let atlas: HTMLImageElement | undefined;
let continental: HTMLImageElement | undefined;
export function continentalArt() {
    if (!continental && typeof Image !== 'undefined') {
        continental = new Image(); continental.src = '/art/map/continental-overview-v1.png';
    }
    return continental;
}
export function mapOverviewReady() { const image = continentalArt(); return !!image?.complete && !!image.naturalWidth; }
export function mapArt() {
    if (!atlas && typeof Image !== 'undefined') {
        atlas = new Image(); atlas.src = '/art/map/frontier-atlas-v1.png';
    }
    return atlas;
}
export function mapArtReady() { const image = mapArt(); return !!image?.complete && !!image.naturalWidth; }
export function drawMapSprite(c: CanvasRenderingContext2D, index: number, x: number, y: number, width: number, height = width): boolean {
    const image = mapArt();
    if (!image?.complete || !image.naturalWidth) return false;
    const sw = image.naturalWidth / 4, sh = image.naturalHeight / 4;
    c.drawImage(image, index % 4 * sw, Math.floor(index / 4) * sh, sw, sh, x, y, width, height);
    return true;
}

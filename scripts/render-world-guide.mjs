// Render the exact seeded coastline/biomes as a PNG guide for the map artist.
// Run: node --import tsx scripts/render-world-guide.mjs [output.png]
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { getCell, FIELD_COLORS } from '../src/features/map/domain/worldGrid.ts';
import { WORLD_COLS, WORLD_ROWS } from '../src/features/map/domain/dimensions.ts';
const width = 1600, height = 1600, pixels = Buffer.alloc((width * 3 + 1) * height);
const fieldWidth = width / WORLD_COLS, fieldHeight = height / WORLD_ROWS;
for (let row = 0; row < WORLD_ROWS; row++) for (let col = 0; col < WORLD_COLS; col++) {
  const cell = getCell(col - WORLD_COLS / 2, row - WORLD_ROWS / 2), color = FIELD_COLORS[cell.terrain];
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  for (let y = 0; y < fieldHeight; y++) for (let x = 0; x < fieldWidth; x++) {
    const offset = (row * fieldHeight + y) * (width * 3 + 1) + 1 + (col * fieldWidth + x) * 3;
    rgb.forEach((value, channel) => { pixels[offset + channel] = value; });
  }
}
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc(Buffer.concat([name, bytes])));
  return Buffer.concat([size, name, bytes, checksum]);
}
const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
const output = path.resolve(process.argv[2] || 'tmp/world-map/continent-guide.png');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
console.log(output);

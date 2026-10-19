import type { Faction } from '../../factions/domain/factions';
import { cityRandom, type CityEnvironment } from '../domain/environment';
import { cityBiome } from './cityBiome';
import { PAINTED_CITY, type PaintedCityPlot } from './paintedLayout';

export const terrainColor = (value: string | number) => typeof value === 'string' ? value : `#${value.toString(16).padStart(6, '0')}`;

/** Original vector countryside, regenerated from public geography, never a background photograph. */
export function villageCountrysideSvg(faction: Faction, environment: CityEnvironment, plots: PaintedCityPlot[], id: string) {
    const biome = cityBiome(faction, environment), random = (n: number) => cityRandom(environment, 5000 + n);
    const ground = terrainColor(biome.ground), hill = terrainColor(biome.hill), green = terrainColor(biome.green), leaf = terrainColor(biome.leaf);
    const parts: string[] = [];
    parts.push(`<defs><linearGradient id="${id}-land" x2=".25" y2="1"><stop stop-color="${hill}"/><stop offset=".6" stop-color="${ground}"/><stop offset="1" stop-color="${ground}"/></linearGradient></defs><rect width="1200" height="900" fill="url(#${id}-land)"/>`);
    for (let n = 0; n < 85; n++) {
        const x = random(n * 9) * 1200, y = random(n * 9 + 1) * 900, rx = 16 + random(n * 9 + 2) * 90;
        parts.push(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${rx * .45}" fill="${n % 3 ? hill : leaf}" opacity="${.035 + random(n * 9 + 3) * .075}"/>`);
    }
    // Low, layered ridges distinguish highlands, snow and sand without covering the settlement.
    for (let layer = 0; layer < 3; layer++) {
        const mountain = environment.terrain === 'mountain' || environment.terrain === 'snow';
        const peaks = Array.from({ length: 15 }, (_, i) => `${i * 100 - 100} ${35 + layer * 35 + random(900 + layer * 20 + i) * (mountain ? 160 : 55)}`).join('L');
        parts.push(`<path d="M-100 -30H1300V${50 + layer * 60}L${peaks}Z" fill="${layer % 2 ? hill : ground}" opacity="${.35 - layer * .07}"/>`);
    }
    if (environment.water !== 'none') {
        const phase = random(1000) * Math.PI * 2, water: string[] = [];
        // Reserve the quarry's entire bank, including its future levels and shadows.
        const bankX = (y: number) => {
            const quarryBend = Math.exp(-(((y - 400) / 125) ** 2)) * 145;
            return quarryBend + (environment.water === 'coast'
                ? 1100 - Math.max(0, y - 150) * .12 + Math.sin(y * .008 + phase) * 8
                : 1075 + Math.sin((y - 720) * .009 + phase) * 16 - Math.sin(phase) * 16);
        };
        for (let y = -50; y <= 950; y += 20) water.push(`${y === -50 ? 'M' : 'L'}${bankX(y)} ${y}`);
        const path = water.join('');
        if (environment.water === 'coast') parts.push(`<path data-city-shore d="${path}H1300V-50Z" fill="#b5b294" stroke="#c8c3a1" stroke-width="20"/><path data-city-water-surface d="${path}H1300V-50Z" fill="#77a4a6"/>`);
        else parts.push(`<path data-city-river d="${path}" fill="none" stroke="#b3b398" stroke-width="94"/><path data-city-water-surface d="${path}" fill="none" stroke="#79a4a3" stroke-width="76"/><path d="${path}" fill="none" stroke="#91b9b1" stroke-width="50" opacity=".45"/>`);
        parts.push('<g class="painted-city-water">');
        for (let n = 0; n < 24; n++) {
            const y = 35 + n * 37, x = bankX(y) + (environment.water === 'coast' ? 20 : -10);
            parts.push(`<path d="M${x} ${y}q15 5 32-1" fill="none" stroke="#d6e7dc" stroke-width="1.4" opacity=".5"/>`);
        }
        parts.push('</g>');
    }
    const count = Math.round(biome.trees * .26);
    for (let n = 0; n < count; n++) {
        const x = random(1200 + n * 5) * 1200, y = random(1201 + n * 5) * 900, scale = .65 + random(1202 + n * 5) * .7;
        if (environment.water !== 'none' && x > 995) continue;
        if (plots.some(plot => Math.abs(x - plot.x - PAINTED_CITY.offsetX) < plot.size / 2 + 30 && Math.abs(y - plot.y - PAINTED_CITY.offsetY) < plot.size / 2 + 38)) continue;
        const crown = biome.tree === 'pine' ? `<path d="M0-37L-15-9H-9L-18 0H18L9-9H15Z" fill="${green}"/><path d="M0-37L-9-20H9Z" fill="${environment.terrain === 'snow' ? ground : leaf}"/>`
            : biome.tree === 'palm' ? `<path d="M0-25Q-18-45-26-26Q-12-34 0-25Q12-43 27-26Q13-34 0-25Q-3-48 9-43Q3-34 0-25Z" fill="${green}"/>`
            : biome.tree === 'bare' ? '<path d="M0 0V-32M0-12L-13-26M0-18L14-31" stroke="#686253" stroke-width="4" fill="none"/>'
            : `<ellipse cy="-20" rx="18" ry="20" fill="${green}"/><ellipse cx="-5" cy="-26" rx="12" ry="14" fill="${leaf}"/><ellipse cx="9" cy="-19" rx="10" ry="13" fill="${green}"/>`;
        parts.push(`<g transform="translate(${x} ${y}) scale(${scale})"><ellipse cy="4" rx="19" ry="7" fill="#333d2c" opacity=".12"/><path d="M0 3V-24" stroke="#7d7154" stroke-width="4"/>${crown}</g>`);
    }
    for (let n = 0; n < 65; n++) {
        const x = random(3000 + n * 3) * 1200, y = random(3001 + n * 3) * 900;
        if (environment.water !== 'none' && x > 995) continue;
        parts.push(`<path d="M${x} ${y}l6-7 10 1 4 7-10 4Z" fill="${hill}" opacity=".55"/>`);
    }
    return parts.join('');
}

import { FACTIONS, type Faction } from '../../factions/domain/factions';
import { cityBoundary, type PaintedCityPlot } from './paintedLayout';

export const cityColor = (value: number) => `#${value.toString(16).padStart(6, '0')}`;

/** Outside lanes meet below the enclosure. Only the central lane crosses its gate. */
export const VILLAGE_ROADS = {
    entrance: 'M500 690V625Q500 490 500 345',
    outside: [
        'M500 660Q260 678 100 610V516Q80 370 92 220',
        'M500 660Q735 675 944 650V550Q958 420 940 265',
    ],
} as const;

// Trusted presentation data only. No server text or player names enter this SVG markup.
export function villageWallSvg(faction: Faction, level: number, id: string): string {
    const b = cityBoundary(faction), p = FACTIONS[faction], c = cityColor;
    const living = b.material === 'living', timber = b.material === 'timber' || b.material === 'bamboo';
    const base = living ? p.timber : timber ? p.wood : b.material === 'bone' ? p.light : b.material === 'obsidian' ? p.darkStone : p.stone;
    const light = living ? p.leaf : timber ? p.timber : p.light;
    if (level < 1) return `<path data-city-boundary="${b.shape}" data-wall-material="${b.material}" d="${b.path}" fill="none" stroke="${c(base)}" stroke-width="3" stroke-dasharray="8 8" opacity=".45"/>`;
    const mask = `${id}-gate`, brick = `${id}-brick`;
    const facing = timber || b.material === 'bone' ? 'stroke-dasharray="5 3"' : '';
    return `<defs><mask id="${mask}"><rect width="1000" height="680" fill="white"/><rect x="476" y="589" width="48" height="70" fill="black"/></mask><pattern id="${brick}" width="28" height="14" patternUnits="userSpaceOnUse"><rect width="28" height="14" fill="${c(base)}"/><path d="M0 0H28M0 7H28M7 0V7M21 7V14" stroke="${c(p.darkStone)}" stroke-width=".8" opacity=".48"/></pattern></defs>
        <g data-city-boundary="${b.shape}" data-wall-material="${b.material}" mask="url(#${mask})" fill="none" stroke-linejoin="round">
        <path d="${b.path}" transform="translate(0 10)" stroke="#263128" stroke-width="26" opacity=".18"/>
        <path d="${b.path}" transform="translate(0 6)" stroke="${c(timber ? p.wood : p.darkStone)}" stroke-width="22" ${facing}/>
        <path d="${b.path}" stroke="${living ? c(base) : timber || b.material === 'bone' || b.material === 'obsidian' ? c(base) : `url(#${brick})`}" stroke-width="20" ${facing}/>
        <path d="${b.path}" transform="translate(0 -5)" stroke="${c(light)}" stroke-width="${living ? 17 : timber ? 3 : 10}" ${living ? 'stroke-dasharray="18 12" stroke-linecap="round"' : timber ? 'stroke-dasharray="2 6"' : ''}/>
        ${living ? `<path d="${b.path}" transform="translate(0 -8)" stroke="${c(p.green)}" stroke-width="9" stroke-dasharray="8 22" stroke-linecap="round"/>` : timber ? `<path d="${b.path}" transform="translate(0 3)" stroke="${c(p.timber)}" stroke-width="2"/>` : `<path d="${b.path}" transform="translate(0 -8)" stroke="${c(base)}" stroke-width="7" stroke-dasharray="9 12"/>`}
        </g>`;
}

export type VillageActivity = { key: string; kind: 'patrol' | 'training' | 'gathering'; x: number; y: number; delay: number; source: string };

/** Decorative residents are independent of actual troop counts; never persist or issue commands. */
export function villageActivities(plots: PaintedCityPlot[]): VillageActivity[] {
    const result: VillageActivity[] = [];
    if (plots.some(p => p.key === 'wall' && p.level > 0)) {
        result.push({ key: 'guard:0', kind: 'patrol', x: 0, y: 0, delay: -4, source: 'wall' }, { key: 'guard:1', kind: 'patrol', x: 0, y: 0, delay: -42, source: 'wall' });
    }
    const sources = [plots.find(p => p.type === 'barracks' && p.level > 0), plots.find(p => p.key === 'market' && p.level > 0), plots.find(p => p.type === 'housing' && p.level > 0)].filter((p): p is PaintedCityPlot => !!p);
    for (const plot of sources) {
        for (let i = 0; i < 2; i++) {
            const radius = plot.size / 2 + 17;
            const candidates = [[radius, -12 + i * 24], [-radius, -12 + i * 24], [i ? 15 : -15, radius + 10], [i ? 15 : -15, -radius]];
            const position = candidates.map(([dx, dy]) => ({ x: plot.x + dx, y: plot.y + dy })).find(({ x, y }) =>
                plots.every(other => Math.abs(x - other.x) > other.size / 2 + 10 || y < other.y - other.size / 2 - 3 || y - 24 > other.y + other.size / 2 + 3)
                && result.filter(a => a.kind !== 'patrol').every(a => Math.abs(x - a.x) > 17 || Math.abs(y - a.y) > 28));
            if (position) result.push({ key: `${plot.key}:${i}`, kind: plot.type === 'barracks' ? 'training' : 'gathering', ...position, delay: -i * 1.7, source: plot.key });
        }
    }
    return result;
}

export function villageNpcSvg(faction: Faction, kind: VillageActivity['kind'], variant = 0): string {
    const p = FACTIONS[faction], c = cityColor, armed = kind !== 'gathering';
    const short = faction === 'dwarf' || faction === 'gnome', broad = faction === 'orc' || faction === 'pandaren' || faction === 'dwarf';
    const height = short ? .8 : faction === 'elf' ? 1.12 : 1, width = broad ? 1.25 : 1;
    const skin = c(p.skin), cloth = c(variant ? p.slate : p.roof), steel = c(p.light);
    const head = faction === 'pandaren' ? `<circle cx="-4" cy="-23" r="2.3" fill="#34332d"/><circle cx="4" cy="-23" r="2.3" fill="#34332d"/><ellipse cy="-20" rx="5" ry="4.6" fill="${skin}"/><path d="M-3-20h1M2-20h1" stroke="#34332d" stroke-width="2.8"/><circle cy="-18" r="1" fill="#34332d"/>` : `<ellipse cy="-20" rx="${broad ? 4.8 : 3.8}" ry="4.3" fill="${skin}"/><path d="M-2-20h.6M1-20h.6" stroke="#352e29" stroke-width="1"/>
        ${faction === 'elf' ? `<path d="M-3-21l-4-2 3 6M3-21l4-2-3 6" fill="${skin}"/>` : faction === 'orc' ? '<path d="M-3-17l1-3 1 3M1-17l1-3 1 3" fill="#eee0bd"/>' : faction === 'demon' ? '<path d="M-3-23q-5-8-2-8l5 7M3-23q5-8 2-8l-5 7" fill="#d0a47e"/>' : faction === 'undead' ? '<path d="M-2-20h1M1-20h1" stroke="#476a50" stroke-width="2.5"/><path d="M-2-17h4" stroke="#777c69" stroke-dasharray="1 1"/>' : faction === 'dwarf' ? `<path d="M-4-17q0 9 4 8 4 1 4-8l-4 2Z" fill="${c(p.timber)}"/>` : faction === 'gnome' ? `<path d="M-4-22l4-7 4 7" fill="${cloth}"/><path d="M-3-20h2M1-20h2" stroke="${c(p.gold)}" stroke-width="2.5"/>` : ''}
        ${armed && !['pandaren','gnome','demon','undead'].includes(faction) ? `<path d="M-4-22q0-6 8 0v2h-2v-3h-4v3h-2Z" fill="${c(p.gold)}"/>${faction === 'spartan' || faction === 'roman' ? `<path d="M-1-25v-4h3v5" stroke="${cloth}" stroke-width="2"/>` : faction === 'persian' ? `<path d="M-4-23q4-6 8 0" stroke="${steel}" stroke-width="3"/>` : faction === 'egyptian' ? `<path d="M-4-23v7M4-23v7" stroke="${c(p.slate)}" stroke-width="2"/>` : ''}` : ''}`;
    return `<ellipse cy="1" rx="8" ry="2.5" fill="#253426" opacity=".22"/><g transform="scale(${width} ${height})"><g class="city-npc-legs" stroke="#413c31" stroke-width="2.6" stroke-linecap="round"><path class="city-npc-leg" d="M-2-7L-3 0"/><path class="city-npc-leg" d="M2-7L3 0"/></g><path d="M-4-16Q0-18 4-16L5-7H-5Z" fill="${armed ? c(p.darkStone) : cloth}" stroke="${cloth}" stroke-width="1.5"/><path d="M-4-10H4" stroke="${c(p.gold)}" stroke-width="1"/>${head}<path d="M-4-15L-6-10" stroke="${skin}" stroke-width="2.5" stroke-linecap="round"/><g class="city-npc-arm"><path d="M4-15L7-11" stroke="${skin}" stroke-width="2.5" stroke-linecap="round"/>${armed ? `<path d="M8-2V-27" stroke="${c(p.wood)}" stroke-width="1.5"/><path d="M8-32l-2 6h4Z" fill="${steel}"/>` : `<circle cx="7" cy="-11" r="1.5" fill="${skin}"/>`}</g>${armed ? `<ellipse cx="-6" cy="-12" rx="4" ry="5" fill="${cloth}" stroke="${c(p.gold)}" stroke-width="1"/><path d="M-6-15v6M-8-12h4" stroke="${steel}" stroke-width=".6"/>` : ''}</g>`;
}

export function villageActivitySvg(faction: Faction, plots: PaintedCityPlot[]): string {
    return villageActivities(plots).map((a, i) => {
        const npc = `<g class="city-npc city-npc-${a.kind}" data-npc-race="${faction}" data-city-activity="${a.kind}" data-activity-source="${a.source}" style="--npc-delay:${a.delay}s">${villageNpcSvg(faction, a.kind, i % 2)}</g>`;
        return a.kind === 'patrol' ? `<g transform="translate(500 345) scale(1.055) translate(-500 -345)"><g class="city-npc-travel" style="offset-path:path('${cityBoundary(faction).path}');animation-delay:${a.delay}s">${npc}</g></g>` : `<g transform="translate(${a.x} ${a.y})">${npc}</g>`;
    }).join('');
}

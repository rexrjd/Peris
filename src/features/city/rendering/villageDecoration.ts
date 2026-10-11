import { FACTIONS, type Faction } from '../../factions/domain/factions';
import { cityBoundary, type PaintedCityPlot } from './paintedLayout';
import { VILLAGE_WORK_AREAS, villagePatrolRoutes } from './villageWalkways';

export const cityColor = (value: number) => `#${value.toString(16).padStart(6, '0')}`;

/** Field traffic uses the north gate; the main entrance remains on the south side. */
export const VILLAGE_ROADS = {
    entrance: 'M560 815Q505 760 500 625Q500 490 500 345',
    north: 'M560 -15Q500 -15 500 65L500 345',
    outside: [] as readonly string[],
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
    return `<defs><mask id="${mask}"><rect width="1000" height="680" fill="white"/><rect x="476" y="589" width="48" height="70" fill="black"/><rect x="476" y="25" width="48" height="80" fill="black"/></mask><pattern id="${brick}" width="28" height="14" patternUnits="userSpaceOnUse"><rect width="28" height="14" fill="${c(base)}"/><path d="M0 0H28M0 7H28M7 0V7M21 7V14" stroke="${c(p.darkStone)}" stroke-width=".8" opacity=".48"/></pattern></defs>
        <g data-city-boundary="${b.shape}" data-wall-material="${b.material}" mask="url(#${mask})" fill="none" stroke-linejoin="round">
        <path d="${b.path}" transform="translate(0 10)" stroke="#263128" stroke-width="26" opacity=".18"/>
        <path d="${b.path}" transform="translate(0 6)" stroke="${c(timber ? p.wood : p.darkStone)}" stroke-width="22" ${facing}/>
        <path d="${b.path}" stroke="${living ? c(base) : timber || b.material === 'bone' || b.material === 'obsidian' ? c(base) : `url(#${brick})`}" stroke-width="20" ${facing}/>
        <path d="${b.path}" transform="translate(0 -5)" stroke="${c(light)}" stroke-width="${living ? 17 : timber ? 3 : 10}" ${living ? 'stroke-dasharray="18 12" stroke-linecap="round"' : timber ? 'stroke-dasharray="2 6"' : ''}/>
        ${living ? `<path d="${b.path}" transform="translate(0 -8)" stroke="${c(p.green)}" stroke-width="9" stroke-dasharray="8 22" stroke-linecap="round"/>` : timber ? `<path d="${b.path}" transform="translate(0 3)" stroke="${c(p.timber)}" stroke-width="2"/>` : `<path d="${b.path}" transform="translate(0 -8)" stroke="${c(base)}" stroke-width="7" stroke-dasharray="9 12"/>`}
        </g>`;
}

export type VillageActivity = { key: string; kind: 'patrol' | 'training' | 'gathering' | 'lumbering' | 'mining' | 'harvesting' | 'fishing'; x: number; y: number; delay: number; source: string };

/** Decorative residents are independent of actual troop counts; never persist or issue commands. */
export function villageActivities(plots: PaintedCityPlot[]): VillageActivity[] {
    const result: VillageActivity[] = [];
    if (plots.some(p => p.key === 'wall' && p.level > 0)) {
        result.push({ key: 'guard:0', kind: 'patrol', x: 0, y: 0, delay: -4, source: 'wall' }, { key: 'guard:1', kind: 'patrol', x: 0, y: 0, delay: -42, source: 'wall' });
    }
    const sources = [plots.find(p => p.type === 'barracks' && p.level > 0), plots.find(p => p.key === 'market' && p.level > 0), plots.find(p => p.type === 'housing' && p.level > 0), ...plots.filter(p => p.level > 0 && ['lumber','quarry','farm','fishery'].includes(p.key))].filter((p): p is PaintedCityPlot => !!p);
    for (const plot of sources) {
        const work = ({lumber:'lumbering',quarry:'mining',farm:'harvesting',fishery:'fishing'} as const)[plot.key as 'lumber'|'quarry'|'farm'|'fishery'];
        for (let i = 0; i < (work ? 1 : 2); i++) {
            const radius = plot.size / 2 + (work ? 30 : 17);
            const candidates = [[radius, -12 + i * 24], [-radius, -12 + i * 24], [i ? 15 : -15, radius + 12], [i ? 15 : -15, -radius]];
            const workstation = work ? VILLAGE_WORK_AREAS[plot.key as keyof typeof VILLAGE_WORK_AREAS] : undefined;
            const position = [...(workstation?[workstation]:[]),...candidates.map(([dx, dy]) => ({ x: plot.x + dx, y: plot.y + dy }))].find(({ x, y }) =>
                (workstation ? x===workstation.x && y===workstation.y :
                x > 18 && x < 975 && y > 30 && y < 666
                )
                &&
                plots.every(other => Math.abs(x - other.x) > other.size / 2 + 10 || y < other.y - other.size / 2 - 3 || y - 24 > other.y + other.size / 2 + 3)
                && result.filter(a => a.kind !== 'patrol').every(a => Math.abs(x - a.x) > 17 || Math.abs(y - a.y) > 28));
            if (position) result.push({ key: `${plot.key}:${i}`, kind: work ?? (plot.type === 'barracks' ? 'training' : 'gathering'), ...position, delay: -i * 1.7, source: plot.key });
        }
    }
    return result;
}

export function villageNpcSvg(faction: Faction, kind: VillageActivity['kind'], variant = 0): string {
    const p = FACTIONS[faction], c = cityColor, armed = kind === 'patrol' || kind === 'training';
    const short = faction === 'dwarf' || faction === 'gnome', broad = faction === 'orc' || faction === 'pandaren' || faction === 'dwarf';
    const height = short ? .8 : faction === 'elf' ? 1.12 : 1, width = broad ? 1.25 : 1;
    const skin = c(p.skin), cloth = c(variant ? p.slate : p.roof), steel = c(p.light);
    const head = faction === 'pandaren' ? `<circle cx="-4" cy="-23" r="2.3" fill="#34332d"/><circle cx="4" cy="-23" r="2.3" fill="#34332d"/><ellipse cy="-20" rx="5" ry="4.6" fill="${skin}"/><path d="M-3-20h1M2-20h1" stroke="#34332d" stroke-width="2.8"/><circle cy="-18" r="1" fill="#34332d"/>` : `<ellipse cy="-20" rx="${broad ? 4.8 : 3.8}" ry="4.3" fill="${skin}"/><path d="M-2-20h.6M1-20h.6" stroke="#352e29" stroke-width="1"/>
        ${faction === 'elf' ? `<path d="M-3-21l-4-2 3 6M3-21l4-2-3 6" fill="${skin}"/>` : faction === 'orc' ? '<path d="M-3-17l1-3 1 3M1-17l1-3 1 3" fill="#eee0bd"/>' : faction === 'demon' ? '<path d="M-3-23q-5-8-2-8l5 7M3-23q5-8 2-8l-5 7" fill="#d0a47e"/>' : faction === 'undead' ? '<path d="M-2-20h1M1-20h1" stroke="#476a50" stroke-width="2.5"/><path d="M-2-17h4" stroke="#777c69" stroke-dasharray="1 1"/>' : faction === 'dwarf' ? `<path d="M-4-17q0 9 4 8 4 1 4-8l-4 2Z" fill="${c(p.timber)}"/>` : faction === 'gnome' ? `<path d="M-4-22l4-7 4 7" fill="${cloth}"/><path d="M-3-20h2M1-20h2" stroke="${c(p.gold)}" stroke-width="2.5"/>` : ''}
        ${armed && !['pandaren','gnome','demon','undead'].includes(faction) ? `<path d="M-4-22q0-6 8 0v2h-2v-3h-4v3h-2Z" fill="${c(p.gold)}"/>${faction === 'spartan' || faction === 'roman' ? `<path d="M-1-25v-4h3v5" stroke="${cloth}" stroke-width="2"/>` : faction === 'persian' ? `<path d="M-4-23q4-6 8 0" stroke="${steel}" stroke-width="3"/>` : faction === 'egyptian' ? `<path d="M-4-23v7M4-23v7" stroke="${c(p.slate)}" stroke-width="2"/>` : ''}` : ''}`;
    const tool = kind === 'mining' ? `<path d="M7-10L13-23" stroke="${c(p.wood)}" stroke-width="2"/><path d="M8-24q8-3 11 4" stroke="${steel}" stroke-width="2.3" fill="none"/>`
        : kind === 'lumbering' ? `<path d="M6-10h17v3H6Z" fill="${steel}"/><path d="M6-7l2 2 2-2 2 2 2-2 2 2 2-2 2 2 2-2" fill="none" stroke="${c(p.darkStone)}" stroke-width=".8"/>`
        : kind === 'harvesting' ? `<path d="M7-10L17-26" stroke="${c(p.wood)}" stroke-width="1.5"/><path d="M16-26q13-2 14 4q-7-2-13-1Z" fill="${steel}"/>`
        : kind === 'fishing' ? `<path d="M7-10q8-12 18-14" stroke="${c(p.wood)}" stroke-width="1.5" fill="none"/><path d="M25-24q8 8 6 22" stroke="#cbd3b6" stroke-width=".65" fill="none"/>`
        : `<circle cx="7" cy="-11" r="1.5" fill="${skin}"/>`;
    const id=`npc-${faction}-${kind}-${variant}`,body=armed?c(p.darkStone):cloth;
    return `<defs><linearGradient id="${id}-cloth" x1="0" x2="1"><stop stop-color="${body}"/><stop offset=".45" stop-color="${cloth}"/><stop offset="1" stop-color="${c(p.darkStone)}"/></linearGradient><radialGradient id="${id}-face" cx=".3" cy=".25"><stop stop-color="${c(p.light)}" stop-opacity=".65"/><stop offset=".45" stop-color="${skin}"/><stop offset="1" stop-color="${skin}"/></radialGradient></defs><ellipse cy="1" rx="8" ry="2.5" fill="#253426" opacity=".18"/><g transform="scale(${width} ${height})"><g class="city-npc-legs" stroke="#413c31" stroke-width="2.6" stroke-linecap="round"><path class="city-npc-leg" d="M-2-7L-3 0"/><path class="city-npc-leg" d="M2-7L3 0"/></g><path d="M-4-16Q0-19 4-16L5-7Q0-5-5-7Z" fill="url(#${id}-cloth)" stroke="${cloth}" stroke-width=".8"/><path d="M-2-15l1 6" stroke="${c(p.light)}" stroke-width=".7" opacity=".4"/><path d="M-4-10Q0-9 4-10" stroke="${c(p.gold)}" stroke-width="1"/>${head.replace(`fill="${skin}"`,`fill="url(#${id}-face)"`)}<path d="M-4-15L-6-10" stroke="${skin}" stroke-width="2.5" stroke-linecap="round"/><g class="city-npc-arm"><path d="M4-15L7-11" stroke="${skin}" stroke-width="2.5" stroke-linecap="round"/>${armed ? `<path d="M8-2V-27" stroke="${c(p.wood)}" stroke-width="1.5"/><path d="M8-32l-2 6h4Z" fill="${steel}"/>` : tool}</g>${armed ? `<ellipse cx="-6" cy="-12" rx="4" ry="5" fill="${cloth}" stroke="${c(p.gold)}" stroke-width="1"/><path d="M-6-15v6M-8-12h4" stroke="${steel}" stroke-width=".6"/>` : ''}</g>`;
}

/** Small moving props beside the site, rather than rotating its baked building image. */
function workplaceSvg(faction: Faction, kind: VillageActivity['kind']): string {
    const p=FACTIONS[faction],c=cityColor;
    if(kind==='lumbering')return `<g data-work-prop="sawmill"><path d="M9-5h23v4H9Z" fill="${c(p.wood)}"/><path d="M12-1v7M28-1v7" stroke="${c(p.timber)}" stroke-width="3"/><path d="M11-5h19" stroke="${c(p.timber)}" stroke-width="4"/><g transform="translate(29 -12)"><g class="city-work-wheel"><circle r="7" fill="${c(p.darkStone)}" stroke="${c(p.timber)}" stroke-width="2"/><path d="M-6 0H6M0-6V6M-4-4L4 4M4-4L-4 4" stroke="${c(p.gold)}" stroke-width="1"/><circle r="2" fill="${c(p.timber)}"/></g></g></g>`;
    if(kind==='mining')return `<g data-work-prop="stone-mason"><path d="M11-5l12-2 6 6-3 7-15-1Z" fill="${c(p.stone)}" stroke="${c(p.darkStone)}" stroke-width=".8"/><path d="M12-4l9 2 4-3M21-2v6" stroke="${c(p.light)}" fill="none"/><g class="city-work-dust" fill="${c(p.light)}"><circle cx="15" cy="-8" r="1.4"/><circle cx="20" cy="-6" r="1"/><circle cx="25" cy="-9" r="1.3"/></g></g>`;
    if(kind==='harvesting')return `<g data-work-prop="wheat"><ellipse cx="24" cy="3" rx="19" ry="6" fill="${c(p.earth)}" opacity=".7"/>${Array.from({length:8},(_,i)=>`<g transform="translate(${12+i*3} ${i%2*3})"><g class="city-work-wheat" style="animation-delay:${-i*.35}s"><path d="M0 3Q2-6 1-13" stroke="${c(p.gold)}" stroke-width="1.2" fill="none"/><path d="M1-5l-3-2M1-8l3-2M1-10l-3-2M1-12l2-2" stroke="#d3b56b" stroke-width="2"/></g></g>`).join('')}<path d="M-18 2q-7-9 0-13q7 5 5 13Z" fill="#9a7848" stroke="#d5b67a"/><path d="M-21-1h7" stroke="#634c30"/></g>`;
    if(kind==='fishing')return `<g data-work-prop="fishing"><ellipse cx="28" cy="3" rx="12" ry="4" fill="${c(p.water)}" opacity=".75"/><g class="city-work-float"><path d="M26-2h5l-2 4Z" fill="${c(p.roof)}"/><path d="M28-5v3" stroke="${c(p.light)}"/></g><path d="M-15 2v-6q-8-9-14 0v6Z" fill="${c(p.wood)}" stroke="${c(p.timber)}"/></g>`;
    return '';
}

export function villageActivitySvg(faction: Faction, plots: PaintedCityPlot[]): string {
    return villageActivities(plots).map((a, i) => {
        const npc = `<g class="city-npc city-npc-${a.kind}" data-npc-race="${faction}" data-city-activity="${a.kind}" data-activity-source="${a.source}" style="--npc-delay:${a.delay}s">${villageNpcSvg(faction, a.kind, i % 2)}</g>`;
        const route=villagePatrolRoutes(faction)[i%2];
        return a.kind === 'patrol' ? `<g class="city-npc-travel" data-patrol-surface="${route.surface}" style="offset-path:path('${route.path}');animation-delay:${a.delay}s">${npc}</g>` : `<g transform="translate(${a.x} ${a.y})">${workplaceSvg(faction,a.kind)}${npc}</g>`;
    }).join('');
}

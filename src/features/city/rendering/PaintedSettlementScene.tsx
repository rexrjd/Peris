import { useEffect, useId, useState, type CSSProperties } from 'react';
import { FACTIONS, type Faction } from '../../factions/domain/factions';
import { BUILDINGS } from '../domain/buildings';
import type { BuildingType } from '../domain/types';
import { SLOT_BUILDINGS, type CitySlot, type SlotType } from '../domain/slots';
import { BuildingArtwork } from './BuildingArtwork';
import { PAINTED_CITY, cityBoundary, paintedCityLayout, paintedPlotName, type PaintedCityPlot } from './paintedLayout';
import { VILLAGE_ROADS, villageActivitySvg, villageWallSvg } from './villageDecoration';

export type PaintedSettlementSceneProps = {
    selected: string;
    onSelect: (key: string) => void;
    levels: Record<string, number>;
    slots: CitySlot[];
    faction?: Faction;
};

const color = (value: number) => `#${value.toString(16).padStart(6, '0')}`;
const trees = [[55,100],[98,88],[160,96],[197,111],[70,287],[65,340],[69,403],[43,533],[87,586],[128,594],[196,619],[267,637],[655,64],[732,60],[791,89],[843,92],[954,116],[978,176],[973,405],[949,448],[941,571],[960,616],[725,627]];

function details(plot: PaintedCityPlot) {
    if (!plot.type) return `Plot ${(plot.slot ?? 0) + 1} is available. Choose a building.`;
    const building = plot.type in SLOT_BUILDINGS ? SLOT_BUILDINGS[plot.type as SlotType] : BUILDINGS[plot.type as BuildingType];
    return `${plot.level > 0 ? `Level ${plot.level}.` : 'Not built yet.'} ${building.effect}${plot.slot === 16 ? ' Riverside site outside the wall.' : ''}`;
}

/** Terrain and city furniture are separate from the persisted buildings and plots. */
function VillageGround({ faction, wallLevel, plots, textureId }: { faction: Faction; wallLevel: number; plots: PaintedCityPlot[]; textureId: string }) {
    const palette = FACTIONS[faction], boundary = cityBoundary(faction), { centerX, centerY } = PAINTED_CITY;
    const river = 'M890 -20 C858 130 929 265 894 365 S857 480 855 700';
    return <svg className="painted-city-ground" viewBox="0 0 1000 680" aria-hidden="true">
        <defs>
            <pattern id={textureId} width="300" height="300" patternUnits="userSpaceOnUse"><image href="/art/shared/meadow-ground.png" width="300" height="300" opacity=".26"/></pattern>
            <linearGradient id={`${textureId}-river`} x1="0" y1="0" x2="1" y2="0"><stop stopColor={color(palette.water)}/><stop offset=".5" stopColor="#aec7b4"/><stop offset="1" stopColor={color(palette.water)}/></linearGradient>
            <clipPath id={`${textureId}-inside`}><path d={boundary.path}/></clipPath>
        </defs>
        <rect width="1000" height="680" fill={color(palette.ground)}/>
        <rect width="1000" height="680" fill={`url(#${textureId})`}/>
        <path d="M0 35Q155 120 230 20T530 0L1000 0V68Q865 129 765 62T505 70T230 124T0 87Z" fill={color(palette.hill)} opacity=".4"/>
        <path d="M0 595Q155 567 265 660T680 632T1000 584V680H0Z" fill={color(palette.hill)} opacity=".32"/>
        <path d={river} fill="none" stroke={color(palette.road)} strokeWidth="45"/>
        <path d={river} fill="none" stroke={`url(#${textureId}-river)`} strokeWidth="28"/>
        <path className="painted-city-water" d={river} fill="none" stroke="#d3e9d7" strokeWidth="2" strokeDasharray="17 73" opacity=".5"/>
        {trees.map(([x, y], index) => <g key={index} transform={`translate(${x} ${y})`}>
            <ellipse cy="10" rx="20" ry="8" fill="#263b2d" opacity=".14"/>
            <path d="M-3 8L0-19 4 8" stroke={color(palette.wood)} strokeWidth="3"/>
            <ellipse cy="-12" rx={17 + index % 5} ry="20" fill={color(palette.green)}/>
            <ellipse cx="-6" cy="-17" rx="12" ry="15" fill={color(palette.leaf)}/>
        </g>)}
        <path d={boundary.path} fill={color(palette.earth)} opacity=".56"/>
        <path d={boundary.path} fill={color(palette.ground)} opacity=".63"/>
        <g fill="none" stroke={color(palette.road)} strokeLinecap="round">
            <path data-city-road="gate-entrance" d={VILLAGE_ROADS.entrance} strokeWidth="20"/>
            {VILLAGE_ROADS.outside.map((path, i) => <path data-city-road="outside" key={i} d={path} strokeWidth="14" opacity=".85"/>)}
            <g clipPath={`url(#${textureId}-inside)`} data-city-road="inside">
            <ellipse cx={centerX} cy={centerY} rx="198" ry="133" strokeWidth="13" opacity=".75"/>
            <ellipse cx={centerX} cy={centerY} rx="93" ry="60" strokeWidth="9" opacity=".6"/>
            {plots.filter(plot => plot.slot !== undefined && plot.slot < 16).map(plot => <path key={plot.key} d={`M500 345Q${(500 + plot.x) / 2} ${plot.y + 18} ${plot.x} ${plot.y}`} strokeWidth="8" opacity=".65"/>)}
            </g>
        </g>
        <g dangerouslySetInnerHTML={{ __html: villageWallSvg(faction, wallLevel, textureId) }}/>
        <g transform="translate(861 657)"><path d="M-26-7H27V10H-26Z" fill={color(palette.timber)}/><path d="M-25-3H26M-25 3H26" stroke={color(palette.wood)} strokeWidth="2"/></g>
    </svg>;
}

function Gate({ faction, level }: { faction: Faction; level: number }) {
    const p = FACTIONS[faction], stone = !['timber','living','bamboo'].includes(cityBoundary(faction).material);
    if (['orc','gnome','pandaren'].includes(faction)) return <svg className="painted-city-gate" viewBox="0 0 120 120" aria-hidden="true"><ellipse cx="60" cy="98" rx="40" ry="10" fill="#263b2d" opacity=".18"/>{[27,37,81,91].map(x => <g key={x}><path d={`M${x} 97V44L${x+5} 31 ${x+10} 44V97Z`} fill={color(p.wood)} stroke={color(p.timber)}/><path d={`M${x+3} 48V92`} stroke={color(p.timber)}/></g>)}<path d="M38 49H83V60H38Z" fill={color(p.timber)}/><path d="M42 34Q60 6 77 34" stroke={color(p.light)} strokeWidth="5" fill="none"/><path d="M30 67H47M80 67H96" stroke={color(p.darkStone)} strokeWidth="3"/></svg>;
    if (faction === 'elf') return <svg className="painted-city-gate" viewBox="0 0 120 120" aria-hidden="true"><path d="M27 100Q40 76 36 51Q32 31 61 22Q92 33 85 58Q82 82 96 100M25 101Q18 58 42 39M95 101Q111 58 83 36" fill="none" stroke={color(p.timber)} strokeWidth="6"/><path d="M31 45Q8 12 41 18Q62-4 86 18Q115 18 87 48Q81 15 62 26Q41 20 31 45Z" fill={color(p.leaf)}/><path d="M56 20L61 8 66 20 61 32Z" fill={color(p.water)}/></svg>;
    return <svg className="painted-city-gate" viewBox="0 0 120 120" aria-hidden="true">
        <ellipse cx="60" cy="94" rx="38" ry="11" fill="#263b2d" opacity=".18"/>
        {[24, 81].map(x => <g key={x}><path d={`M${x} 94V44L${x+12} 40 ${x+20} 46V94Z`} fill={color(p.stone)} stroke={color(p.darkStone)} strokeWidth="2"/><path d={`M${x+14} 48V91`} stroke={color(p.darkStone)} strokeWidth="5" opacity=".45"/><path d={`M${x} 61H${x+14}M${x} 75H${x+14}M${x+7} 48V61M${x+7} 75V90`} stroke={color(p.darkStone)} strokeWidth=".8"/>{stone && <path d={`M${x - 2} 49V35H${x + 4}V43H${x + 10}V35H${x + 20}V49`} fill={color(p.light)}/>}</g>)}
        <path d="M39 51H84V61H39Z" fill={color(stone ? p.stone : p.wood)}/>
        <path d="M45 65V89M79 65V89" stroke={color(p.wood)} strokeWidth="3"/>
        {level >= 2 && <g className="painted-city-banner"><path d="M89 47V17" stroke={color(p.wood)} strokeWidth="2"/><path d="M90 18L109 21 106 31 90 28Z" fill={color(p.roof)}/><path d="M99 22V27" stroke={color(p.gold)} strokeWidth="2"/></g>}
    </svg>;
}

export function PaintedSettlementScene({ selected, onSelect, levels, slots, faction = 'roman' }: PaintedSettlementSceneProps) {
    const textureId = `city-terrain-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const plots = paintedCityLayout(levels, slots), palette = FACTIONS[faction];
    const [hidden, setHidden] = useState(false);
    useEffect(() => {
        const update = () => setHidden(document.hidden);
        update(); document.addEventListener('visibilitychange', update);
        return () => document.removeEventListener('visibilitychange', update);
    }, []);
    return <div className="painted-settlement-scene" data-hidden={hidden} data-faction={faction} data-city-shape={cityBoundary(faction).shape} aria-label="Painted isometric village with selectable buildings and empty construction plots" style={{ '--city-road': color(palette.road), '--city-accent': color(palette.gold) } as CSSProperties}>
        <VillageGround faction={faction} wallLevel={levels.wall ?? 0} plots={plots} textureId={textureId}/>
        <svg className="painted-city-activity" viewBox="0 0 1000 680" aria-hidden="true" dangerouslySetInnerHTML={{ __html: villageActivitySvg(faction, plots) }}/>
        <div className="painted-city-plots" aria-label="Village buildings and construction plots">
            {[...plots].sort((a, b) => a.y - b.y).map(plot => {
                const name = paintedPlotName(plot), description = details(plot);
                const built = !!plot.type && plot.level > 0;
                return <button key={plot.key} type="button" data-building={plot.key} className={`painted-city-plot ${selected === plot.key ? 'selected' : ''} ${built ? 'built' : 'unbuilt'} ${plot.key === 'market' ? 'main-hall' : ''} ${plot.x < 180 ? 'tooltip-left' : plot.x > 820 ? 'tooltip-right' : ''} ${plot.y > 550 ? 'tooltip-above' : ''}`} style={{ left: `${plot.x / 10}%`, top: `${plot.y / 6.8}%`, width: `${plot.size / 10}%`, zIndex: Math.round(plot.y) } as CSSProperties} aria-label={`${name}, ${description}`} title={`${name} — ${description}`} aria-pressed={selected === plot.key} onClick={() => onSelect(plot.key)}>
                    <span className="painted-city-footprint" aria-hidden="true"/>
                    {!built ? <span className="painted-city-foundation" aria-hidden="true"><i/><i/><i/><i/></span>
                        : plot.key === 'wall' ? <Gate faction={faction} level={plot.level}/>
                        : <BuildingArtwork type={plot.type!} level={plot.level} faction={faction} fallback="icon"/>}
                    {built && ['smithy', 'housing'].includes(plot.type!) && <span className="painted-city-smoke" aria-hidden="true"><i/><i/></span>}
                    {built && plot.type === 'mage_tower' && <span className="painted-city-magic" aria-hidden="true"/>}
                    <span className="city-level-badge" aria-hidden="true">{built ? plot.level : '+'}</span>
                    <span className="city-landmark-tooltip" aria-hidden="true"><strong>{name}</strong><small>{description}</small></span>
                </button>;
            })}
        </div>
    </div>;
}

import { FACTIONS, factionOf } from '../../factions/domain/factions';
import type { Faction } from '../../factions/domain/factions';

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/** A tiny native illustration: no additional canvas or downloaded art per city. */
export function CityVignette({ faction, level, buildings = 3 }: { faction?: Faction; level: number; buildings?: number }) {
    const race = factionOf(faction), colors = FACTIONS[race];
    const roof = hex(colors.roofLight), stone = hex(colors.light), shade = hex(colors.darkStone);
    const tower = (x: number, y: number, scale: number, keep = false) => <g transform={`translate(${x} ${y}) scale(${scale})`}>
        <path d="M-16 0 0 8 16 0 0-8Z" fill="#000" opacity=".13" transform="translate(4 2)"/>
        <path d="M-13-25 0-18 0 5-13-2Z" fill={stone}/><path d="M0-18 13-25 13-2 0 5Z" fill={shade}/>
        <path d={race === 'egyptian' ? 'M-16-25 0-52 16-25 0-17Z' : race === 'pandaren' ? 'M-20-29-14-26 0-43 14-26 20-29 16-22 0-15-16-22Z' : race === 'elf' || race === 'undead' || race === 'demon' ? 'M-16-25 0-55 16-25 0-17Z' : 'M-16-25 0-40 16-25 0-17Z'} fill={roof}/>
        <path d="M-16-25 0-40 0-17Z" fill="#fff" opacity=".1"/>
        <path d="M-8-15-4-13-4-6-8-8Z" fill="#493f3b" opacity=".6"/>
        {keep && <><path d="M0-39V-61" stroke={stone} strokeWidth="1.5"/><path d="M1-60 15-55 1-51Z" fill="#e3b174"/>{level >= 3 && <path d="M-13-24V-32M13-24V-32" stroke={stone} strokeWidth="5"/>}</>}
    </g>;
    return <svg className="atlas-city-art" viewBox="0 0 240 145" aria-hidden="true">
        <path d="M17 92 120 42 224 93 121 144Z" fill="#a88d66" opacity=".14"/>
        <path d="M20 87 120 37 220 87 120 137Z" fill="#e2d4b5"/>
        <path d="M20 87 120 137V144L20 94Z" fill="#baa482"/><path d="M120 137 220 87V94L120 144Z" fill="#968771"/>
        <path d="M49 87 120 52 193 87 121 122Z" fill="#c9bfa3"/><path d="M43 96 157 40M88 120 202 64" stroke="#ebe1cc" strokeWidth="5"/>
        {[[-70, 0], [75, -5], [-40, -27]].map(([x, y], i) => <g key={i} transform={`translate(${120 + x} ${83 + y})`}><path d="M0 0V-13" stroke="#8f7a60" strokeWidth="2"/><path d="M-9-9 0-31 9-9 0-5Z" fill="#8a9a9c"/><path d="M0-31 9-9 0-5Z" fill="#64777e"/></g>)}
        {buildings > 0 && tower(91, 102, .72)}{buildings > 1 && tower(156, 107, .62)}{buildings > 2 && tower(157, 74, .67)}{buildings > 4 && tower(69, 78, .6)}{buildings > 6 && tower(130, 124, .48)}
        {tower(121, 88, .9 + Math.min(5, level) * .08, true)}
        {level >= 2 && <path d="M43 88V80L120 42 197 80V88M43 88 120 126 197 88" fill="none" stroke="#938f84" strokeWidth="3"/>}
    </svg>;
}

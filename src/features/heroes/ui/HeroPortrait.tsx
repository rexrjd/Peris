import { useId } from 'react';
import { FACTIONS, factionOf, type Faction } from '../../factions/domain/factions';
import type { EquipmentSlot, HeroClass } from '../domain/heroes';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
/** Native geometric art keeps portraits crisp and gives each faction its own character. */
export function HeroPortrait({ heroClass = 'knight', faction, compact = false }: { heroClass?: HeroClass; faction?: Faction; compact?: boolean }) {
    const id = useId().replace(/:/g, ''), race = factionOf(faction), palette = FACTIONS[race];
    const skin = hex(palette.skin), trim = hex(palette.gold), cloth = heroClass === 'mage' ? '#747092' : heroClass === 'ranger' ? '#607e91' : '#a76d58';
    const beard = race === 'dwarf' || race === 'gnome', elf = race === 'elf', horns = race === 'demon', tusks = race === 'orc';
    return <svg className={`command-portrait ${compact ? 'compact' : ''}`} viewBox="0 0 200 220" aria-hidden="true">
        <defs><linearGradient id={`${id}-bg`} x2=".8" y2="1"><stop stopColor={cloth} stopOpacity=".4"/><stop offset="1" stopColor="#151a24"/></linearGradient></defs>
        <path d="M100 2 191 49V171L100 220 9 171V49Z" fill={`url(#${id}-bg)`}/><path d="M100 15 178 56V164L100 207 22 164V56Z" fill="none" stroke={trim} opacity=".24"/>
        <path d="M28 208 41 160 78 142H124L161 163 175 208Z" fill={cloth}/><path d="M100 147 126 147 162 167 176 209H100Z" fill="#000" opacity=".22"/>
        <path d="M69 61 100 45 132 62 139 105 122 139 101 153 79 140 62 104Z" fill={skin}/><path d="M100 47 132 63 139 105 122 139 101 153Z" fill="#000" opacity=".18"/>
        {elf && <><path d="M65 86 43 70 62 115Z" fill={skin}/><path d="M134 86 157 70 138 115Z" fill={skin}/></>}
        {heroClass === 'knight' ? <><path d="M62 84 66 53 101 30 136 53 140 85 128 77 118 64H84L73 77Z" fill="#a5afb8"/><path d="M101 30 136 53 140 85 128 77 118 64H101Z" fill="#697581"/><path d="M75 53 101 40 126 54M101 36V65" fill="none" stroke={trim} strokeWidth="4"/><path d="M32 170 58 155 83 161 75 183 39 194Z" fill="#96a0ab"/><path d="M120 163 143 154 166 171 158 194 130 184Z" fill="#63717f"/><path d="M78 184 100 173 125 184 119 213H83Z" fill="#84909c"/></> : heroClass === 'ranger' ? <><path d="M52 101 60 58 100 31 140 58 149 106 132 88 126 69 100 54 75 69 69 89Z" fill={cloth}/><path d="M100 31 140 58 149 106 132 88 126 69 100 54Z" fill="#354958"/><path d="M43 177 92 152 104 172 74 209H27Z" fill="#6b8b9d"/><path d="M80 163 122 204" stroke={trim} strokeWidth="9"/><path d="M151 117Q194 166 151 216M151 117V216" fill="none" stroke={trim} strokeWidth="4"/></> : <><path d="M53 94 75 48 100 18 126 48 149 94 100 66Z" fill={cloth}/><path d="M100 18 126 48 149 94 100 66Z" fill="#48465e"/><path d="M60 94 100 76 141 94" fill="none" stroke={trim} strokeWidth="4"/><path d="M79 150 100 178 123 150 113 197H89Z" fill="#9891b5"/><path d="M157 104V218" stroke={trim} strokeWidth="7"/><path d="M158 72 173 93 158 112 143 93Z" fill="#b5b0ec"/><path d="M158 72V112L143 93Z" fill="#e3dcff"/></>}
        {horns && <><path d="M69 62 49 33 51 74 65 83Z" fill={trim}/><path d="M132 62 152 33 150 74 136 83Z" fill={trim}/></>}
        <path d="M76 93 89 94M112 94 125 92" stroke="#252a32" strokeWidth="4"/><path d="M97 93 91 114H103" fill="none" stroke="#4d4039" opacity=".5" strokeWidth="3"/><path d="M86 127H112" stroke="#534038" strokeWidth="3"/>
        {race === 'pandaren' && <><path d="M67 86 88 85 96 101 76 110Z M109 102 116 85 135 87 127 111Z" fill="#272e37"/><path d="M91 115 101 111 111 115 100 123Z" fill="#272e37"/></>}
        {race === 'undead' && <><path d="M76 91 90 91 86 106 78 107Z M111 91 126 91 123 107 115 106Z" fill="#686078"/><path d="M83 123H118L111 143H90Z" fill="#515362"/><path d="M92 126V138M101 126V140M110 126V138" stroke={skin} strokeWidth="3"/></>}
        {tusks && <><path d="M79 130 76 115 89 131Z M113 131 126 115 123 133Z" fill="#e9dfc3"/></>}
        {beard && <><path d="M71 113 86 123 100 128 115 123 130 113 124 151 100 173 76 151Z" fill={race === 'dwarf' ? '#af805a' : '#d0bb9f'}/><path d="M100 128V173L124 151 130 113 115 123Z" fill="#000" opacity=".14"/><path d="M89 156H111" stroke={trim} strokeWidth="4"/></>}
        <path d="M100 186 110 196 100 206 90 196Z" fill={trim}/>
    </svg>;
}

export function ArtifactGlyph({ slot, magic = false }: { slot: EquipmentSlot; magic?: boolean }) {
    return <svg className={`artifact-glyph ${magic ? 'arcane' : ''}`} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round" aria-hidden="true">
        {slot === 'weapon' && (magic ? <><path d="M17 53 44 15M38 5 51 10 48 25 35 20Z"/><path d="m41 9 6 3-2 9-6-2Z" fill="currentColor" opacity=".3"/></> : <><path d="M16 52 48 9 53 8 53 14 21 56ZM13 36 30 49M13 52l6 5"/><path d="M45 13 20 47" opacity=".35"/></>)}
        {slot === 'armour' && <><path d="m21 10-12 9 7 14 7-3-3 23h24l-3-23 7 3 7-14-12-9-11 7Z"/><path d="M23 20h18M23 30h18M23 41h18" opacity=".4"/></>}
        {slot === 'head' && <><path d="M12 37V25C12 4 52 4 52 25v12l-8 15H20ZM12 26h40M23 28v18M41 28v18M28 32h8M32 9V2"/><path d="M16 41h32" opacity=".4"/></>}
        {slot === 'boots' && <><path d="M13 10h15v28l6 10v6H9V42l4-7ZM36 10h15v28l7 10v6H36V40ZM13 19h15M36 19h15"/></>}
        {slot === 'charm' && <><path d="M15 9Q32 44 49 9M32 23v9M32 30l15 12-15 15-15-15Z"/><path d="m32 36 8 7-8 8-8-8Z" fill="currentColor" opacity=".25"/></>}
    </svg>;
}

import { heroPortraitUrl } from '../domain/portraits';
import { type Faction } from '../../factions/domain/factions';
import type { EquipmentSlot, HeroClass } from '../domain/heroes';

/** Shared identity artwork for the roster, commander dossier and strategic army marker. */
export function HeroPortrait({heroClass='knight',faction,compact=false}:{heroClass?:HeroClass;faction?:Faction;compact?:boolean}) {
    return <img className={`command-portrait painted ${compact?'compact':''}`} src={heroPortraitUrl(faction,heroClass)} alt="" loading="lazy" decoding="async"/>;
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

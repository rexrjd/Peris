import type {Faction} from '../../factions/domain/factions';

/** Original Peris civic titles. This role has no cell in the combat atlas. */
export const DIPLOMAT_NAMES:Record<Faction,string>={roman:'Senator',spartan:'Ephor',persian:'Shah’s Envoy',egyptian:'Vizier',orc:'Oathspeaker',elf:'Grove Emissary',dwarf:'Clan Lawkeeper',gnome:'Charter Minister',pandaren:'Jade Mandarin',undead:'Sepulchral Legate',demon:'Infernal Chancellor'};
/** Literal URLs are also consumed by the standalone asset packager. */
export const DIPLOMAT_PORTRAITS:Record<Faction,string>={
 roman:'/art/battle/diplomats-v2/roman.webp',
 spartan:'/art/battle/diplomats-v2/spartan.webp',
 persian:'/art/battle/diplomats-v2/persian.webp',
 egyptian:'/art/battle/diplomats-v2/egyptian.webp',
 orc:'/art/battle/diplomats-v2/orc.webp',
 elf:'/art/battle/diplomats-v2/elf.webp',
 dwarf:'/art/battle/diplomats-v2/dwarf.webp',
 gnome:'/art/battle/diplomats-v2/gnome.webp',
 pandaren:'/art/battle/diplomats-v2/pandaren.webp',
 undead:'/art/battle/diplomats-v2/undead.webp',
 demon:'/art/battle/diplomats-v2/demon.webp',
};

export function DiplomatPortrait({faction}:{faction:Faction}){
 return <img data-diplomat-faction={faction} src={DIPLOMAT_PORTRAITS[faction]} alt="" aria-hidden="true" style={{width:'100%',height:'100%',display:'block',objectFit:'contain'}}/>;
}

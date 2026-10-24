import {FACTIONS, type Faction} from '../../factions/domain/factions';

/** Original Peris civic titles and vector artwork. This role has no atlas cell. */
export const DIPLOMAT_NAMES:Record<Faction,string>={roman:'Senator',spartan:'Ephor',persian:'Shah’s Envoy',egyptian:'Vizier',orc:'Oathspeaker',elf:'Grove Emissary',dwarf:'Clan Lawkeeper',gnome:'Charter Minister',pandaren:'Jade Mandarin',undead:'Sepulchral Legate',demon:'Infernal Chancellor'};
const hex=(color:number)=>`#${color.toString(16).padStart(6,'0')}`;
export function DiplomatPortrait({faction}:{faction:Faction}){
 const palette=FACTIONS[faction],gold=hex(palette.gold),robe=hex(palette.roof),skin=hex(palette.skin);
 const angular=['dwarf','orc','demon'].includes(faction),crown=faction==='persian'||faction==='egyptian'||faction==='pandaren';
 return <svg data-diplomat-faction={faction} viewBox="0 0 96 96" aria-hidden="true" focusable="false" style={{width:'100%',height:'100%',display:'block'}}>
  <rect x="2" y="2" width="92" height="92" rx={angular?8:25} fill={hex(palette.darkStone)} stroke={gold} strokeWidth="2"/>
  <path d="M13 78V32L48 12l35 20v46" fill="none" stroke={gold} opacity=".35" strokeWidth="2"/>
  <path d={angular?'M19 87 25 58 48 50 71 58 77 87Z':'M17 87Q22 55 48 51Q74 55 79 87Z'} fill={robe} stroke={gold} strokeWidth="2"/>
  <path d="m36 54 12 29 12-29-12 9Z" fill={hex(palette.light)}/>
  <path d="M33 33Q33 16 48 16Q63 16 63 33v11Q60 59 48 60Q36 59 33 44Z" fill={skin}/>
  {faction==='elf'&&<path d="m33 35-9-7 10 18m29-11 9-7-10 18" fill={skin}/>}
  {faction==='demon'&&<path d="M35 25 27 12l-1 14 9 9m26-10 8-13 1 14-9 9" fill={gold}/>}
  {faction==='pandaren'&&<><circle cx="34" cy="24" r="8" fill="#282a28"/><circle cx="62" cy="24" r="8" fill="#282a28"/><ellipse cx="40" cy="38" rx="5" ry="7" fill="#373b37"/><ellipse cx="56" cy="38" rx="5" ry="7" fill="#373b37"/></>}
  <path d={crown?'M31 29v-9l8 4 9-13 9 13 8-4v9Z':'M30 31Q28 15 48 14Q68 15 66 31l-12-8-14 2Z'} fill={robe} stroke={gold} strokeWidth="2"/>
  <path d="M39 38h3m12 0h3M44 48q4 3 8 0" fill="none" stroke={hex(palette.darkStone)} strokeWidth="2" strokeLinecap="round"/>
  {faction==='dwarf'&&<path d="m34 44 5 15 9 9 9-9 5-15-14 7Z" fill={gold}/>}
  {faction==='undead'&&<path d="M38 36h6v5h-6m14-5h6v5h-6m-7 9h6" fill="#39433c"/>}
  <path d="m26 67 33-9 7 22-33 9Z" fill="#f0ddb0" stroke={gold} strokeWidth="2"/>
  <path d="m34 70 19-5m-17 10 13-4" stroke="#96733f" strokeWidth="2"/>
  <circle cx="55" cy="78" r="6" fill={robe} stroke={gold} strokeWidth="1.5"/>
  <path d="m55 74 3 4-3 4-3-4Z" fill={gold}/>
  <circle cx="26" cy="68" r="4" fill={skin}/><circle cx="66" cy="77" r="4" fill={skin}/>
 </svg>;
}

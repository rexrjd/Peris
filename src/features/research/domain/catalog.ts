import data from './catalog.json' with {type:'json'};
import type {Technology} from './types';
export const TECHNOLOGIES=data as unknown as Technology[];
export const TECHNOLOGY_BY_ID=new Map(TECHNOLOGIES.map(t=>[t.id,t]));
export const ERAS=['Foundations','Craftsmanship','Scholarship','Innovation','Mastery'];
export const BRANCHES=['warfare','archery','cavalry','siege','agriculture','industry','engineering','commerce','knowledge','leadership','heritage'];
export const technologyImage=(id:string)=>`/art/research/v1/${id}.webp`;
export const EFFECT_LABELS:Record<string,string>={attack:'Troop attack',defence:'Troop defence',infantry_attack:'Infantry attack',infantry_defence:'Infantry defence',archers_attack:'Archer attack',archers_defence:'Archer defence',cavalry_attack:'Cavalry attack',cavalry_defence:'Cavalry defence',training:'Training speed',construction:'Construction speed',march:'March speed',carry:'Loot capacity',food:'Food production',wood:'Timber production',stone:'Stone production',gold:'Gold production',trade:'Trading post income',storage:'Storage capacity',science:'Science production',research_speed:'Research speed',culture:'Culture production',hero_xp:'Hero experience',spell_power:'Spell power',mana:'Mana capacity',siege:'Siege power',unlock_spearmen:'Unlock Spearmen',unlock_elite:'Unlock Elite infantry',unlock_scout:'Unlock Scouts',unlock_heavyCavalry:'Unlock Heavy cavalry',unlock_ram:'Unlock Rams',unlock_catapult:'Unlock Catapults'};
export const effectText=(key:string,value:number)=>key.startsWith('unlock_')?EFFECT_LABELS[key]:`+${Math.round(value*100)}% ${EFFECT_LABELS[key]??key}`;

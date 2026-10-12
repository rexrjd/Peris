import type { Faction } from '../../factions/domain/factions';
export type Technology = {id:string;name:string;branch:string;era:number;stage:number;lane:number;faction:Faction|null;cost:number;seconds:number;requires:string[];effects:Record<string,number>;description:string;atlas:string;art_index:number};
export type AccountScience = {owner_id:string;points:number;updated_at:string;active_id:string|null;active_since:string|null;active_rate:number};
export type ResearchProgress = {owner_id:string;technology_id:string;seconds:number;completed_at:string|null};

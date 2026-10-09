import type {Faction} from '../../features/factions/domain/factions';
import type { BuildingType } from '../../features/city/domain/types';
import type { SlotType } from '../../features/city/domain/slots';
import type { FieldBuilding } from '../../features/map/domain/territory';
import type { UnitType } from '../../features/army/domain/types';
import type { Battle, BattleOrder } from '../../features/battle/domain/types';
import type { World } from './world';
type BaseCommand = {type:'setFaction';faction:Faction} | {type:'debugCity';action:'resources'|'demolish'|'finish'|'level'|'population'|'culture';target?:string;value?:number} | {type:'researchSpell';spell:string;} | {type:'castSpell';battleId:number;spell:string;target?:number;} | {
    type: 'claimField'; col: number; row: number;
} | {
    type: 'buildField'; col: number; row: number; item: FieldBuilding;
} | {
    type: 'buildSlot'; slot: number; item: SlotType;
} | {
    type: 'upgradeSlot'; slot: number;
} | {
    type: 'upgrade';
    item: BuildingType;
} | {
    type: 'recruit';
    item: UnitType;
    quantity: number;
} | {
    type: 'move';
    x: number;
    y: number;
    route?: [number, number][];
} | {
    type: 'raid';
    campId: number;
    route?: [number, number][];
} | {
    type: 'ready';
    battleId: number;
} | {
    type: 'order';
    battleId: number;
    order: BattleOrder;
} | {
    type: 'retreat';
    battleId: number;
} | {
    type: 'rally';
    battleId: number;
} | {
    type: 'claim';
    questId: string;
} | {
    type: 'rename';
    name: string;
} | {
    type: 'challenge';
    ownerId: string;
} | {
    type: 'respond';
    id: number;
    accept: boolean;
} | { type: 'trainSettlers'; quantity: number } | { type: 'foundCity'; col: number; row: number; name: string; route?: [number, number][] } | { type: 'recruitHero'; name: string; heroClass: 'knight' | 'ranger' | 'mage' } | { type: 'heroSkill'; heroId: number; stat: 'attack' | 'defence' | 'power' | 'knowledge' } | { type: 'equipArtifact'; heroId: number; artifactId: number; equip: boolean } | { type: 'transferTroops'; targetArmyId: number; infantry: number; archers: number; cavalry: number } | { type: 'rebaseArmy' };
export type Command = BaseCommand & { settlementId?: number; armyId?: number };
export type LocalCommandContext = {
    world: World;
    settlementId?: number;
    armyId?: number;
    playerId: string;
    nextId: () => number;
    active: Battle | undefined;
    now: string;
    paused: (value: boolean) => void;
    finalize: (id: number) => void;
};

import type {Faction} from '../../features/factions/domain/factions';
import type { BuildingType } from '../../features/city/domain/types';
import type { SlotType } from '../../features/city/domain/slots';
import type { FieldBuilding } from '../../features/map/domain/territory';
import type { ArmyTroops } from '../../features/army/domain/types';
import type { RecruitUnit } from '../../features/army/domain/roster';
import type { Battle, BattleOrder } from '../../features/battle/domain/types';
import type { World } from './world';
type BaseCommand = {type:'sendResources';settlementId:number;targetCityId:number;resources:import('./resources').Resources;route?:[number,number][]} | {type:'startResearch';technologyId:string} | {type:'pauseResearch'} | {type:'debugResearch';action:'points'|'complete'} | {type:'readAllReports'} | {type:'readReports';reportIds:number[]} | {type:'setFaction';faction:Faction} | {type:'debugCity';action:'resources'|'demolish'|'finish'|'level'|'population'|'culture';target?:string;value?:number} | {type:'researchSpell';spell:string;} | {type:'castSpell';battleId:number;spell:string;target?:number;} | {
    type:'raidCity';targetCityId:number;siegeTarget?:import('../../features/city/domain/siege').SiegeTarget;route?:[number,number][];troops?:ArmyTroops;
} | {
    type: 'manageCampaignFarmTargets'; ids: number[]; action: 'move' | 'delete'; listId?: number;
} | {
    type: 'setCampaignFarmListEnabled'; id: number; enabled: boolean;
} | {
    type: 'applyCampaignFarmListTroops'; id: number;
} | {
    type: 'saveCampaignFarmList'; id?: number; name: string; troops: ArmyTroops; casualtiesOnly: boolean;
} | {
    type: 'saveCampaignFarm'; id?: number; listId: number; campId: number; armyId: number; troops: ArmyTroops; intervalSeconds?: number; enabled?: boolean;
} | {
    type: 'deleteCampaignFarm'; id: number;
} | {
    type: 'deleteCampaignFarmList'; id: number;
} | {
    type: 'startCampaignFarmList'; id: number; routes?: { targetId: number; path: [number, number][] }[];
} | {
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
    item: RecruitUnit;
    quantity: number;
    destination?: 'legion' | 'garrison';
} | {
    type: 'researchUnit'; item: RecruitUnit;
} | {
    type: 'move';
    x: number;
    y: number;
    route?: [number, number][];
    troops?: ArmyTroops;
} | {
    type: 'raid';
    campId: number;
    route?: [number, number][];
    troops?: ArmyTroops;
} | {
    type: 'cancelMarch';
    armyId: number;
    sentAt: string;
} | {
    type: 'collectGarrison'; armyId: number; troops?: ArmyTroops;
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
} | { type:'reinforceGuild'; settlementId:number; targetCityId:number; armyId?:number; troops:ArmyTroops; route:[number,number][] } | { type:'recallGuildReinforcements'; reinforcementId:number } | { type: 'reinforceCity'; settlementId: number; targetCityId: number; troops: ArmyTroops; route?: [number, number][] } | { type: 'manageCityGarrison'; settlementId: number; armyId: number; action: 'station' | 'withdraw'; troops: ArmyTroops } | { type: 'trainSettlers'; quantity: number } | { type: 'foundCity'; col: number; row: number; name: string; route?: [number, number][] } | { type: 'recruitHero'; name: string; heroClass: 'knight' | 'ranger' | 'mage' } | { type: 'heroSkill'; heroId: number; stat: 'attack' | 'defence' | 'power' | 'knowledge' } | { type: 'equipArtifact'; heroId: number; artifactId: number; equip: boolean } | { type: 'transferTroops'; targetArmyId: number; infantry: number; archers: number; cavalry: number; troops?: ArmyTroops } | { type: 'rebaseArmy' };
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

import type {ArmyTroops} from '../../army/domain/types';
import type {Faction} from '../../factions/domain/factions';
import type {Resources} from '../../../shared/model/resources';
export type ScoutingMode='resources'|'defences';
export type ScoutingMission={
 id:number;owner_id:string;source_settlement_id:number;source_army_id:number;target_city_id:number|null;target_camp_id:number|null;target_owner_id:string|null;target_name:string;faction:Faction;mode:ScoutingMode;
 initial_scouts:number;scouts:number;status:'outbound'|'returning'|'completed'|'cancelled';origin_x:number;origin_y:number;target_x:number;target_y:number;
 sent_at:string;departure_at:string;arrival_at:string;cancel_until:string;march_path:[number,number][];march_distance:number;report_battle_id?:number|null;
};
export type ScoutingResult={
 mission_id:number;mode:ScoutingMode;target:{kind:'city'|'camp';id:number;name:string;owner_id?:string|null;faction:Faction;x:number;y:number};observed_at:string;
 scouts_sent:number;scouts_lost:number;scouts_survived:number;detected:boolean;success:boolean;reason?:string;troops?:ArmyTroops;resources?:Resources;defences?:{wall:number;main:number};sender_name?:string;
};

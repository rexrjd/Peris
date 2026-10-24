import type {World} from '../../../shared/model/world';
import {mainLevel,slotLevels} from '../../city/domain/slots';
import {unitRule,worldBalanceVersion,type RecruitmentBuilding} from './unitBalance';
import type {RecruitUnit} from './roster';
export const trainingBuildingName=(building:RecruitmentBuilding)=>({main:'Main building',barracks:'Barracks',stables:'Stables',workshop:'Workshop'})[building];
export function unitTrainingLevel(w:World,sid:number,unit:RecruitUnit){
 const building=unitRule(unit,worldBalanceVersion(w)).building;
 if(building==='main'){const level=mainLevel(w,sid);return level>=2?level:0;}
 return slotLevels(w,sid,building);
}

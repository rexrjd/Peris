import type {World} from '../../../shared/model/world';
import {settleLocal} from '../../campaign/domain/settlement';
/** Scouting shares the canonical chronological queue and crop-supply boundaries. */
export function advanceScouting(w:World,owner:string,until:number,_nextId:()=>number){settleLocal(w,owner,until);}

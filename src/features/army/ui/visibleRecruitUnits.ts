import type {World} from '../../../shared/model/world';
import {RECRUIT_UNITS} from '../domain/roster';
/** Capability metadata is intentionally absent on older shared-world servers. */
export const visibleRecruitUnits=(world:World)=>RECRUIT_UNITS.filter(unit=>unit!=='diplomat'||world.conquest_version===1);

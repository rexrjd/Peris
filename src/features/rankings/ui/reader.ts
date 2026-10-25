import type {RankingPeriod, RankingsResponse} from '../domain/types';
export type RankingsState={data:RankingsResponse|null;loading:boolean;error:Error|null};
/** One mounted period owns one read session; late results cannot cross its lifetime. */
export function startRankingsRead(read:(period:RankingPeriod)=>Promise<RankingsResponse>,period:RankingPeriod,publish:(state:RankingsState)=>void) {
  let stopped=false,busy=false,data:RankingsResponse|null=null;
  return {
    async refresh(){
      if(stopped||busy)return;
      busy=true;publish({data,loading:true,error:null});
      try {
        const next=await read(period);
        if(next.period!==period)throw new Error('The world returned standings for a different week. Please retry.');
        if(!stopped){data=next;publish({data,loading:false,error:null});}
      } catch(error) {
        if(!stopped)publish({data,loading:false,error:error instanceof Error?error:new Error('Could not load standings. Please retry.')});
      } finally {busy=false;}
    },
    stop(){stopped=true;},
  };
}

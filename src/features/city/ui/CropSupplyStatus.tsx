import type {Settlement} from '../domain/types';

/** Read-only warning: casualties always come from the authoritative simulation. */
export function CropSupplyStatus({city}:{city:Settlement}){
 if(city.food_troop_upkeep===undefined)return null;
 const deficit=city.food_rate<0,losses=city.starvation_losses??0;
 if(!deficit&&!losses)return null;
 return <div className={deficit?'city-report-warning':'command-muted'} role="status" aria-label="Crop supply status"><span>
 {deficit?(city.food<=.001?city.food_troop_upkeep>0?'Starvation: food reserves are empty. Send crop or increase food production.':'Food reserves are empty. Resident growth is paused.':`Crop reserves last about ${Math.max(1,Math.ceil(city.food/-city.food_rate))} game minutes at the current balance.`):'Crop supply has recovered.'}
 {losses>0&&` ${losses.toLocaleString()} soldiers lost to starvation in this city.`}
 </span></div>;
}

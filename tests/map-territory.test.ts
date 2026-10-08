import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { settleLocal } from '../src/features/campaign/domain/settlement';
import { refreshCityEconomy } from '../src/features/city/domain/slots';
import { queueSlot } from '../src/features/city/domain/slotCommands';
import { accrueResources } from '../src/features/city/domain/economy';
import { cellCenter, getCell } from '../src/features/map/domain/worldGrid';
import { claimMapField, queueMapField, mapClaimReason, territoryPopulation, territoryAllowance, fieldRate, fieldModifier, fieldCost, externalFieldRates, type FieldBuilding } from '../src/features/map/domain/territory';
import { RESOURCES, type Resources } from '../src/shared/model/resources';
import type { LocalCommandContext } from '../src/shared/model/commands';

const START = Date.parse('2030-01-01T00:00:00.000Z');
const initialClaims = [[0,1],[0,2],[0,3],[1,1]] as const;
function fixture() {
    const world = createSolo('Field keeper'), town = world.settlements[0];
    world.server_now = town.resources_updated_at = new Date(START).toISOString();
    const context: LocalCommandContext = { world, playerId: 'solo-ruler', now: world.server_now, nextId: () => 1 + Math.max(0,...world.orders.map(order => order.id)), active: undefined, paused: () => {}, finalize: () => {} };
    return { world, town, context };
}
function clock(f: ReturnType<typeof fixture>, seconds: number) {
    settleLocal(f.world, f.context.playerId, START + seconds * 1000);
    f.context.now = new Date(START + seconds * 1000).toISOString();
}
function claimFour(f: ReturnType<typeof fixture>) {
    for (const [col,row] of initialClaims) claimMapField(f.context,col,row);
}
const resources = (f: ReturnType<typeof fixture>): Resources => Object.fromEntries(RESOURCES.map(key => [key,f.town[key]])) as Resources;
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual-expected) < 1e-7, `${actual} should equal ${expected}`);

test('the first four live claims are empty neighboring land and do not create resources or city construction', () => {
    const f = fixture(), before = structuredClone(f.world);
    f.world.players[0].upgrades = 100;
    assert.match(mapClaimReason(f.world,f.context.playerId,-1,2)!,/first four/);
    f.world.players[0].upgrades = 0;
    claimFour(f);
    assert.equal(f.world.map_plots!.length,4);
    assert.ok(f.world.map_plots!.every(plot => plot.building_type === null && plot.level === 0 && fieldRate(plot) === 0));
    assert.deepEqual(resources(f),Object.fromEntries(RESOURCES.map(key => [key,before.settlements[0][key]])));
    assert.deepEqual(f.world.buildings,before.buildings);
    assert.deepEqual(f.world.city_slots,before.city_slots);
    assert.deepEqual(f.world.orders,[]);
    assert.deepEqual(externalFieldRates(f.world.map_plots!,f.town.id),{wood:0,stone:0,food:0,gold:0});
    const claimed = structuredClone(f.world);
    for(const [col,row] of [[200,1],[1.5,1],[NaN,1],[Infinity,1],[1,2],[2,3]]) assert.throws(() => claimMapField(f.context,col,row));
    assert.deepEqual(f.world,claimed,'Rejected claims preserve the world');
    assert.match(mapClaimReason(f.world,f.context.playerId,-1,2)!,/population/);
});

test('live claim protection includes rival starting rings and ownership aliases across either seam', () => {
    const f = fixture();
    f.world.settlements.push({...f.town,id:2,owner_id:'rival',...cellCenter(2,1)});
    assert.match(mapClaimReason(f.world,f.context.playerId,1,1)!,/protects its starting land/);
    assert.match(mapClaimReason(f.world,f.context.playerId,2,1)!,/contains a settlement/);
    assert.match(mapClaimReason(f.world,f.context.playerId,2,3)!,/campaign site/);
    Object.assign(f.town,cellCenter(99,99));
    Object.assign(f.world.settlements[1],cellCenter(-99,99));
    assert.match(mapClaimReason(f.world,f.context.playerId,100,99)!,/protects its starting land/);
    assert.match(mapClaimReason(f.world,f.context.playerId,-100,99)!,/protects its starting land/);
    f.world.settlements.pop();
    claimMapField(f.context,100,99);
    assert.deepEqual([f.world.map_plots![0].col,f.world.map_plots![0].row],[-100,99]);
    assert.match(mapClaimReason(f.world,f.context.playerId,-100,99)!,/already owned/);
    const prior=structuredClone(f.world);
    assert.throws(()=>claimMapField(f.context,-100,99));
    assert.deepEqual(f.world,prior);
    let sea: {col:number;row:number} | undefined;
    for(let row=-100;row<100&&!sea;row++)for(let col=-100;col<100;col++) if(getCell(col,row).terrain==='water'){sea={col,row};break;}
    assert.ok(sea);
    assert.match(mapClaimReason(f.world,f.context.playerId,sea.col,sea.row)!,/dry land/);
});

test('population unlocks bounded connected territory and canonical seam neighbors count as connected land', () => {
    const f=fixture();claimFour(f);
    assert.equal(territoryPopulation(f.world,f.context.playerId),80);
    assert.equal(territoryAllowance(119),4);
    f.world.players[0].upgrades=4;
    assert.equal(territoryPopulation(f.world,f.context.playerId),120);
    assert.equal(territoryAllowance(120),5);
    assert.match(mapClaimReason(f.world,f.context.playerId,5,6)!,/Connect/);
    assert.match(mapClaimReason(f.world,f.context.playerId,8,2)!,/within 6/);
    claimMapField(f.context,-1,4);
    assert.equal(f.world.map_plots!.length,5,'Diagonal connection to the existing claim is viable');
    assert.match(mapClaimReason(f.world,f.context.playerId,-2,5)!,/population/);
    f.world.players[0].upgrades=8;
    assert.equal(territoryAllowance(territoryPopulation(f.world,f.context.playerId)),6);
    claimMapField(f.context,-2,5);
    const seam=fixture();Object.assign(seam.town,cellCenter(99,99));
    for(const [col,row] of [[100,99],[99,100],[98,99],[98,98]]) claimMapField(seam.context,col,row);
    seam.world.players[0].upgrades=4;
    claimMapField(seam.context,101,99);
    assert.deepEqual([seam.world.map_plots!.at(-1)!.col,seam.world.map_plots!.at(-1)!.row],[-99,99]);
});

test('invalid construction changes no ownership, queue or costs; insufficient stores allow only normal accrual', () => {
    const f=fixture();claimFour(f);
    const before=structuredClone(f.world);
    for(const [col,row,item] of [[0.5,1,'lumber'],[NaN,1,'farm'],[99,99,'lumber'],[0,1,'invalid']] as const) assert.throws(()=>queueMapField(f.context,col,row,item as FieldBuilding));
    assert.deepEqual(f.world,before);
    queueMapField(f.context,200,1,'lumber');
    const queued=structuredClone(f.world);
    assert.throws(()=>queueMapField(f.context,0,1,'lumber'),/already underway/);
    assert.throws(()=>queueMapField(f.context,0,1,'quarry'),/existing resource building/);
    assert.deepEqual(f.world,queued);
    const poor=fixture();claimFour(poor);
    for(const key of RESOURCES) poor.town[key]=0;
    poor.context.now=new Date(START+60000).toISOString();
    const natural=structuredClone(poor.town);accrueResources(natural,START+60000);
    assert.throws(()=>queueMapField(poor.context,0,1,'lumber'),/More resources/);
    assert.deepEqual(poor.town,natural);
    assert.deepEqual(poor.world.orders,[]);
    assert.equal(poor.world.map_plots![0].building_type,null);
    assert.equal(poor.world.players[0].upgrades,0);
});

test('first construction reserves level zero but produces only after its exact completion time', () => {
    const f=fixture();claimFour(f);
    const before=resources(f),cost=fieldCost('lumber',0);
    queueMapField(f.context,0,1,'lumber');
    const plot=f.world.map_plots![0];
    assert.equal(plot.level,0);assert.equal(plot.building_type,'lumber');assert.equal(fieldRate(plot),0);
    refreshCityEconomy(f.world,f.town.id);
    assert.equal(f.town.wood_rate,14);
    for(const key of RESOURCES) assert.equal(f.town[key],before[key]-cost[key]);
    clock(f,14.999);
    assert.equal(plot.level,0);assert.equal(f.world.players[0].upgrades,0);
    near(f.town.wood,before.wood-cost.wood+14*14.999/60);
    clock(f,15);
    assert.equal(plot.level,1);assert.equal(f.world.players[0].upgrades,1);
    const extra=fieldRate(plot);assert.ok(extra>0);
    assert.equal(f.town.wood_rate,14+extra);
    near(f.town.wood,before.wood-cost.wood+14*15/60);
    clock(f,60);
    near(f.town.wood,before.wood-cost.wood+14+extra*45/60);
    const settled=structuredClone(f.world);clock(f,60);assert.deepEqual(f.world,settled,'Settling a completion twice cannot pay or grow twice');
});

test('parallel field and city completions accrue chronologically while fisheries and separate capacities survive', () => {
    const f=fixture();claimFour(f);
    f.world.city_slots=[{settlement_id:f.town.id,slot_index:0,building_type:'warehouse',level:2},{settlement_id:f.town.id,slot_index:1,building_type:'granary',level:3},{settlement_id:f.town.id,slot_index:16,building_type:'fishery',level:1}];
    refreshCityEconomy(f.world,f.town.id);
    assert.equal(f.town.capacity,10000);assert.equal(f.town.food_capacity,12500);assert.equal(f.town.food_rate,26);
    queueMapField(f.context,0,1,'lumber');
    clock(f,5);queueMapField(f.context,0,2,'farm');
    clock(f,10);queueSlot(f.context,{type:'upgradeSlot',slot:16});queueMapField(f.context,0,3,'quarry');
    const atTen=resources(f);
    assert.deepEqual(f.world.orders.map(o=>Date.parse(o.finish_at)-START),[15000,20000,35000,25000]);
    f.world.orders.reverse();clock(f,60);
    const [lumber,farm,quarry]=f.world.map_plots!;
    near(f.town.wood,atTen.wood+14*50/60+fieldRate(lumber)*45/60);
    near(f.town.stone,atTen.stone+12*50/60+fieldRate(quarry)*35/60);
    near(f.town.food,atTen.food+26*50/60+fieldRate(farm)*40/60+8*25/60);
    near(f.town.gold,atTen.gold+3*50/60);
    assert.equal(f.town.food_rate,34+fieldRate(farm));
    assert.equal(f.town.capacity,10000);assert.equal(f.town.food_capacity,12500);
    assert.equal(f.world.players[0].upgrades,4);assert.deepEqual(f.world.orders,[]);
    const expected=resources(f);refreshCityEconomy(f.world,f.town.id);refreshCityEconomy(f.world,f.town.id);
    assert.deepEqual(resources(f),expected,'Refreshing recomputes rates without producing stock');
    assert.equal(f.town.wood_rate,14+fieldRate(lumber),'Repeated refresh does not compound external rates');
    for(const key of RESOURCES)f.town[key]=(key==='food'?f.town.food_capacity!:f.town.capacity)-1;
    clock(f,120);
    for(const key of RESOURCES)assert.equal(f.town[key],key==='food'?12500:10000);
});

test('completed construction unlocks claims and upgrades stop at five without changing city storage', () => {
    const f=fixture();claimFour(f);
    for(const key of RESOURCES)f.town[key]=5000;
    for(const [index,item] of ['lumber','farm','quarry','market'].entries()) queueMapField(f.context,initialClaims[index][0],initialClaims[index][1],item as FieldBuilding);
    assert.equal(territoryAllowance(territoryPopulation(f.world,f.context.playerId)),4);
    clock(f,15);
    assert.equal(f.world.players[0].upgrades,4);
    assert.equal(territoryAllowance(territoryPopulation(f.world,f.context.playerId)),5);
    claimMapField(f.context,-1,4);
    const lumber=f.world.map_plots![0];
    while(lumber.level<5){
        const completed=lumber.level,rate=f.town.wood_rate;
        queueMapField(f.context,lumber.col,lumber.row,'lumber');
        assert.equal(lumber.level,completed);assert.equal(f.town.wood_rate,rate);
        const end=Date.parse(f.world.orders.find(o=>o.kind==='field')!.finish_at);
        clock(f,(end-START)/1000);
        assert.equal(lumber.level,completed+1);
    }
    assert.equal(f.world.players[0].upgrades,8);
    assert.equal(territoryAllowance(territoryPopulation(f.world,f.context.playerId)),6);
    assert.equal(f.town.capacity,5000);assert.equal(f.town.food_capacity,5000);
    const full=structuredClone(f.world);
    assert.throws(()=>queueMapField(f.context,lumber.col,lumber.row,'lumber'),/maximum level/);
    assert.deepEqual(f.world,full);
});

test('live field bonuses use the existing four city resources and retain the exact mountain farm penalty', () => {
    assert.equal(fieldModifier('mountain','farm'),.75);
    assert.equal(fieldModifier('grassland','farm'),1.1);
    assert.deepEqual(RESOURCES,['wood','stone','food','gold']);
    for(const item of ['lumber','quarry','farm','market'] as const){
        const trial=fixture();claimFour(trial);queueMapField(trial.context,0,1,item);clock(trial,15);
        const rates=externalFieldRates(trial.world.map_plots!,trial.town.id);
        assert.equal(Object.values(rates).filter(rate=>rate>0).length,1);
        assert.ok(fieldRate(trial.world.map_plots![0])>0);
    }
});

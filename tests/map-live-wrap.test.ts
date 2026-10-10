import test from 'node:test'
import assert from 'node:assert/strict'
import { createSolo } from '../src/features/campaign/domain/newRealm'
import { getCell, cellCenter, cellAt, isWalkable, isVersion3Walkable, isLegacyWalkable, HISTORIC_MAP_STARTS, worldHeight } from '../src/features/map/domain/worldGrid'
import { CELL_SIZE, WORLD_MAP_VERSION, WORLD_MAP_SEED, WORLD_W, wrapWorldCoordinate, wrappedWorldDelta, wrappedCellDistance } from '../src/features/map/domain/dimensions'
import { findMarchPath } from '../src/features/map/domain/pathfinding'
import { marchArmy } from '../src/features/map/domain/commands'
import { armyPosition, armyRouteRemaining, completeTravel } from '../src/features/map/domain/movement'
import { validateSave } from '../src/platform/storage/saves'
import type { LocalCommandContext } from '../src/shared/model/commands'

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} should equal ${expected}`)
const contextFor = (world: ReturnType<typeof createSolo>, now = '2030-01-01T00:00:00.000Z'): LocalCommandContext => ({world,now,playerId:'solo-ruler',nextId:()=>1,active:undefined,paused:()=>{},finalize:()=>{}})

test('live v4 geography is periodic while historical v3/400 walkability remains bounded', () => {
  assert.equal(WORLD_MAP_VERSION, 4)
  assert.equal(WORLD_MAP_SEED, 1346720329)
  assert.equal(wrapWorldCoordinate(12800), -12800)
  assert.equal(wrappedWorldDelta(12736, -12736), CELL_SIZE)
  assert.deepEqual(getCell(99, 99), getCell(299, -301))
  assert.deepEqual(cellCenter(100, -101), cellCenter(-100, 99))
  assert.deepEqual(cellAt(12864, -12864), getCell(-100, 99))
  assert.equal(isVersion3Walkable(100, 0), false)
  assert.equal(isLegacyWalkable(200, 0), false)
  for (const coordinate of [-100,-83.25,-.5,44.7,99.9]) {
    near(worldHeight(-100,coordinate),worldHeight(100,coordinate))
    near(worldHeight(coordinate,-100),worldHeight(coordinate,100))
    const epsilon=.0001
    const before=(worldHeight(100-epsilon,coordinate)-worldHeight(100-epsilon*2,coordinate))/epsilon
    const after=(worldHeight(-100+epsilon*2,coordinate)-worldHeight(-100+epsilon,coordinate))/epsilon
    assert.ok(Math.abs(before-after)<.01)
  }
  for (const invalid of [Infinity,NaN,-Infinity]) assert.throws(()=>cellAt(invalid,0),/finite/)
})

test('the live realm retains broad land and varied resource terrain after protecting historical starts', context => {
  const begun=performance.now(),counts=new Map<string,number>()
  for(let row=-100;row<100;row++)for(let col=-100;col<100;col++) {
    const cell=getCell(col,row)
    counts.set(cell.terrain,(counts.get(cell.terrain)??0)+1)
    if(cell.terrain==='water') assert.ok(worldHeight(col+.5,row+.5)<-.04)
  }
  const land=1-(counts.get('water')??0)/40000
  context.diagnostic(`${(land*100).toFixed(2)}% land; ${HISTORIC_MAP_STARTS.length} protected historic centers; ${(performance.now()-begun).toFixed(1)}ms to audit40000 cells`)
  assert.ok(land>=.85&&land<=.94,`Land proportion ${land} remains playable without flattening the seas`)
  for(const terrain of ['forest','mountain','grassland','desert','marsh','snow','darkland']) assert.ok((counts.get(terrain)??0)>100,`${terrain} offers meaningful sites`)
})

test('every historic spawn and campaign starter ring stays dry without relocating positions', () => {
  assert.ok(HISTORIC_MAP_STARTS.length>1000)
  for (const center of HISTORIC_MAP_STARTS) for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
    const cell=getCell(center.col+dx,center.row+dy)
    assert.notEqual(cell.terrain,'water')
    assert.ok(worldHeight(center.col+dx+.5,center.row+dy+.5)>0)
  }
  const original=createSolo('Preserved')
  assert.deepEqual(original.camps.filter(c=>!c.bandit).map(c=>[c.x,c.y]),[[305,405],[460,155],[655,485],[790,160],[910,550],[605,280]])
  assert.deepEqual([original.settlements[0].x,original.settlements[0].y],[155,285])
})

test('corner and edge marches use canonical neighbor pairs and the short wrapped distance', () => {
  const from=cellCenter(99,99),to=cellCenter(-100,-100),route=findMarchPath(from,to)
  assert.ok(route)
  assert.deepEqual(route.path,[[from.x,from.y],[to.x,to.y]])
  near(route.distance,Math.SQRT2*CELL_SIZE)
  assert.deepEqual(findMarchPath(from,{x:to.x+WORLD_W,y:to.y-WORLD_W}),route)
  const distant=findMarchPath(cellCenter(1,2),cellCenter(-46,-39))
  assert.ok(distant)
  let distance=0
  for(let i=0;i<distant.path.length;i++) {
    const [x,y]=distant.path[i],col=Math.floor(x/CELL_SIZE),row=Math.floor(y/CELL_SIZE)
    assert.ok(x>=-12800&&x<12800&&y>=-12800&&y<12800&&isWalkable(col,row))
    if(!i)continue
    const previous=distant.path[i-1],pc=Math.floor(previous[0]/CELL_SIZE),pr=Math.floor(previous[1]/CELL_SIZE)
    assert.ok(wrappedCellDistance({col,row},{col:pc,row:pr})<=1)
    if(pc!==col&&pr!==row){assert.ok(isWalkable(pc,row));assert.ok(isWalkable(col,pr))}
    distance+=Math.hypot(wrappedWorldDelta(previous[0],x),wrappedWorldDelta(previous[1],y))
  }
  near(distant.distance,distance)
})

test('new commands mark v4 routes and preserve state when invalid destinations fail', () => {
  const world=createSolo('Seam'),army=world.armies[0],from=cellCenter(99,99),to=cellCenter(-100,-100),context=contextFor(world)
  Object.assign(army,{status:'idle',start_x:from.x,start_y:from.y,target_x:from.x,target_y:from.y})
  const before=structuredClone(army)
  assert.throws(()=>marchArmy(context,{type:'move',x:NaN,y:0}),/destination/)
  assert.deepEqual(army,before)
  marchArmy(context,{type:'move',x:to.x+WORLD_W,y:to.y-WORLD_W})
  assert.equal(army.march_map_version,4)
  assert.equal(army.target_x,to.x);assert.equal(army.target_y,to.y)
  near(army.march_distance!,Math.SQRT2*CELL_SIZE)
  near(Date.parse(army.arrival_at)-Date.parse(context.now),Math.floor(army.march_distance!/22*1000))
})

test('v4 armies interpolate over seams while untagged old routes retain linear history', () => {
  const world=createSolo('Traveller'),army=world.armies[0],start=cellCenter(99,99),end=cellCenter(-100,-100),time=Date.parse('2030-01-01T00:00:00.000Z')
  Object.assign(army,{status:'moving',start_x:start.x,start_y:start.y,target_x:end.x,target_y:end.y,departure_at:new Date(time).toISOString(),arrival_at:new Date(time+20_000).toISOString(),march_path:[[start.x,start.y],[end.x,end.y]],march_distance:Math.SQRT2*CELL_SIZE,march_map_version:4})
  assert.deepEqual(armyPosition(army,time+10_000),{x:-12800,y:-12800})
  assert.deepEqual(armyRouteRemaining(army,time+10_000),[[-12800,-12800],[end.x,end.y]])
  delete army.march_map_version
  assert.deepEqual(armyPosition(army,time+10_000),{x:0,y:0})
  army.march_map_version=4
  completeTravel(army,time+20_000)
  assert.equal(army.march_path,null)
  assert.deepEqual(armyPosition(army,time+20_000),end)
})

test('save validation distinguishes tagged wrapped routes from preserved legacy route geometry', () => {
  const world=createSolo('Saved'),army=world.armies[0],start=cellCenter(99,99),end=cellCenter(-100,-100)
  Object.assign(army,{status:'moving',start_x:start.x,start_y:start.y,target_x:end.x,target_y:end.y,march_path:[[start.x,start.y],[end.x,end.y]],march_distance:Math.SQRT2*CELL_SIZE,march_map_version:4})
  assert.doesNotThrow(()=>validateSave(world))
  delete army.march_map_version
  assert.throws(()=>validateSave(world))
  army.march_map_version=4;army.march_distance!+=WORLD_W
  assert.throws(()=>validateSave(world))
  const legacy=createSolo('Old'),old=legacy.armies[0]
  Object.assign(old,{status:'moving',start_x:-15000,start_y:3000,target_x:-14872,target_y:3000,march_path:[[-15000,3000],[-14872,3000]],march_distance:128})
  assert.equal(validateSave(legacy).armies[0].start_x,-15000)
  assert.equal(validateSave(legacy).armies[0].march_map_version,undefined)
  old.march_map_version=4
  assert.throws(()=>validateSave(legacy))
  old.march_path=null;old.march_distance=null
  assert.throws(()=>validateSave(legacy),'New version tags require canonical army positions even without a route')
})

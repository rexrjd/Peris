import { BATTLE_TERRAINS } from '../../features/battle/domain/terrain';
import { normalizeRealm } from '../../features/empire/domain/normalization';
import { ARTIFACTS, HERO_CLASSES, HERO_STATS, heroPoints, heroThreshold, MAX_HERO_LEVEL } from '../../features/heroes/domain/heroes';
import {settleLocal} from '../../features/campaign/domain/settlement';
import {isFaction} from '../../features/factions/domain/factions';
import { citySlots, refreshCityEconomy, SLOT_BUILDINGS, mainLevel, slotCount, slotMaxLevel } from '../../features/city/domain/slots';
import {spellById} from '../../features/magic/domain/spells';
import { SAVE_KEY, readSolo } from './solo';
import { type World } from '../../shared/model/world';
import { CELL_SIZE, WORLD_COLS, WORLD_ROWS, WORLD_MAP_VERSION, WORLD_MIN_X, WORLD_MAX_X, wrappedWorldDelta, wrappedCellDistance, wrapWorldCell } from '../../features/map/domain/dimensions';
import { isWalkable, isVersion3Walkable, isLegacyWalkable } from '../../features/map/domain/worldGrid';
import { FIELD_BUILDINGS, TERRITORY_RULES, territoryAllowance, territoryPopulation } from '../../features/map/domain/territory';
// v6 campaigns predate the 200-field map. Keep every legacy position and route
// unchanged on import/export; new movement uses the canonical periodic geography.
const SAVE_MIN = -25600, SAVE_MAX = 25600;
const backupKey = 'peris-campaign-backup';
export function backupSolo() { try {
    const old = localStorage.getItem(SAVE_KEY);
    if (old)
        localStorage.setItem(backupKey, old);
}
catch { /* Current save remains intact. */ } }
export function readBackup(): World | null { try {
    return validateSave(JSON.parse(localStorage.getItem(backupKey) || 'null'));
}
catch {
    return null;
} }
function validateLegacySave(data: unknown): World {
    const w = data as World, invalid = () => { throw new Error('This file is not a valid Peris campaign save.'); };
    if (!w || w.version !== 6 || !Array.isArray(w.players) || w.players.length !== 1 || w.players[0].id !== 'solo-ruler')
        invalid();
    for (const key of ['settlements', 'armies', 'buildings', 'camps', 'orders', 'battles', 'formations', 'reports', 'progress', 'claims', 'challenges'] as const)
        if (!Array.isArray(w[key]) || w[key].length > 15000 || w[key].some(row => !row || typeof row !== 'object'))
            invalid();
    if (w.settlements.length !== 1 || w.armies.length !== 1 || w.buildings.length !== 8 || w.camps.length < 6 || w.camps.length > 2000)
        invalid();
    if(new Set(w.camps.map(c=>c.id)).size!==w.camps.length||w.camps.some(c=>!Number.isSafeInteger(c.id)||c.id<1||typeof c.name!=='string'||c.name.length>100||!Number.isFinite(c.x)||!Number.isFinite(c.y)||!BATTLE_TERRAINS.includes(c.terrain)||c.faction!==undefined&&!isFaction(c.faction)||c.bandit!==undefined&&typeof c.bandit!=='boolean'||[c.infantry,c.archers,c.cavalry].some(n=>!Number.isInteger(n)||n<0||n>1000)||!Number.isInteger(c.tier)||c.tier<1||c.tier>5))invalid();
    if(w.debug_enabled!==undefined&&typeof w.debug_enabled!=='boolean')invalid();
    const town = w.settlements[0], army = w.armies[0], player = w.players[0];
    if(town.faction!==undefined&&!isFaction(town.faction))invalid();
    if (town.owner_id !== 'solo-ruler' || army.owner_id !== 'solo-ruler' || typeof player.display_name !== 'string' || !player.display_name.trim() || typeof town.name !== 'string')
        invalid();
    for (const n of [town.wood, town.stone, town.food, town.gold, town.capacity, town.wood_rate, town.stone_rate, town.gold_rate, army.infantry, army.archers, army.cavalry, player.prestige, player.victories, player.recruits, player.upgrades])
        if (!Number.isFinite(n) || n < 0 || n > 1e12)
            invalid();
    if(!Number.isFinite(town.food_rate)||town.food_rate< -1e6||town.food_rate>1e12)invalid();
    for(const key of ['population','population_capacity','workers_required','wood_bonus','stone_bonus','food_bonus','gold_bonus','food_gross_rate','food_upkeep','field_wood_rate','field_stone_rate','field_food_rate','field_gold_rate'] as const)if(town[key]!==undefined&&(!Number.isFinite(town[key])||town[key]!<0||town[key]!>100000))invalid();
    if(town.population!==undefined&&(town.population<10||town.population>2500))invalid();
    if (army.infantry + army.archers + army.cavalry > 1000 || !['idle', 'moving'].includes(army.status))
        invalid();
    for (const n of [town.x, army.start_x, army.target_x])
        if (!Number.isFinite(n) || n < SAVE_MIN || n >= SAVE_MAX)
            invalid();
    for (const n of [town.y, army.start_y, army.target_y])
        if (!Number.isFinite(n) || n < SAVE_MIN || n >= SAVE_MAX)
            invalid();
    if (army.march_distance != null && (!Number.isFinite(army.march_distance) || army.march_distance < 0))
        invalid();
    if (army.march_map_version != null && ![3, WORLD_MAP_VERSION].includes(army.march_map_version)) invalid();
    if (army.march_map_version === WORLD_MAP_VERSION && [army.start_x, army.start_y, army.target_x, army.target_y].some(value => value < WORLD_MIN_X || value >= WORLD_MAX_X)) invalid();
    if (army.march_path != null) {
        const route = army.march_path;
        if (!Array.isArray(route) || route.length < 2 || route.length > 2000)
            invalid();
        const wrappedRoute = army.march_map_version === WORLD_MAP_VERSION;
        let distance = 0, currentLand = true, legacyLand = true;
        for (let i = 0; i < route.length; i++) {
            const point = route[i];
            if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < SAVE_MIN || point[0] >= SAVE_MAX || point[1] < SAVE_MIN || point[1] >= SAVE_MAX)
                invalid();
            if (wrappedRoute && point.some(value => value < WORLD_MIN_X || value >= WORLD_MAX_X)) invalid();
            const col = Math.floor(point[0] / CELL_SIZE), row = Math.floor(point[1] / CELL_SIZE);
            currentLand = currentLand && (wrappedRoute ? isWalkable(col, row) : isVersion3Walkable(col, row));
            legacyLand = legacyLand && !wrappedRoute && isLegacyWalkable(col, row);
            if (i) {
                const previous = route[i - 1], oldCol = Math.floor(previous[0] / CELL_SIZE), oldRow = Math.floor(previous[1] / CELL_SIZE);
                const segment = Math.hypot(wrappedRoute ? wrappedWorldDelta(previous[0],point[0]) : point[0] - previous[0], wrappedRoute ? wrappedWorldDelta(previous[1],point[1]) : point[1] - previous[1]);
                const neighboring = wrappedRoute ? wrappedCellDistance({col,row},{col:oldCol,row:oldRow}) <= 1 : Math.abs(col - oldCol) <= 1 && Math.abs(row - oldRow) <= 1;
                if (!neighboring || segment === 0 && route.length > 2)
                    invalid();
                if (col !== oldCol && row !== oldRow) {
                    currentLand = currentLand && (wrappedRoute ? isWalkable(col, oldRow) && isWalkable(oldCol, row) : isVersion3Walkable(col, oldRow) && isVersion3Walkable(oldCol, row));
                    legacyLand = legacyLand && !wrappedRoute && isLegacyWalkable(col, oldRow) && isLegacyWalkable(oldCol, row);
                }
                distance += segment;
            }
        }
        if ((!currentLand && !legacyLand) || army.march_distance == null || Math.abs(army.march_distance - distance) > Math.max(.01, distance * 1e-8))
            invalid();
        if (army.status === 'moving' && (Math.abs(route[0][0] - army.start_x) > 1 || Math.abs(route[0][1] - army.start_y) > 1 || route.at(-1)![0] !== army.target_x || route.at(-1)![1] !== army.target_y))
            invalid();
    }
    for (const n of [army.infantry, army.archers, army.cavalry])
        if (!Number.isInteger(n))
            invalid();
    for (const b of w.buildings)
        if (!['lumber', 'quarry', 'farm', 'market', 'barracks', 'stables', 'wall', 'storehouse'].includes(b.building_type) || !Number.isInteger(b.level) || b.level < 0 || b.level > 20)
            invalid();
    if (new Set(w.buildings.map(b => b.building_type)).size !== 8)
        invalid();
    if (w.city_slots !== undefined) {
        if (!Array.isArray(w.city_slots) || w.city_slots.length>17) invalid();
        if(w.city_slots.filter(s=>s?.building_type==='mage_tower').length>1)invalid();
        const seen=new Set<number>();
        for (const slot of w.city_slots) {
            if (slot.settlement_id!==town.id || !Number.isInteger(slot.slot_index) || slot.slot_index<0 || slot.slot_index!==16 && slot.slot_index>=slotCount(mainLevel(w,town.id)) || seen.has(slot.slot_index) || !Object.hasOwn(SLOT_BUILDINGS,slot.building_type) || !Number.isInteger(slot.level) || slot.level<0 || slot.level>slotMaxLevel(slot.building_type) || (slot.building_type==='fishery') !== (slot.slot_index===16)) invalid();
            seen.add(slot.slot_index);
        }
    }
    if(w.spell_research!==undefined){
        if(!Array.isArray(w.spell_research)||w.spell_research.length>20)invalid();
        const seen=new Set<string>();for(const research of w.spell_research){if(!research||research.settlement_id!==town.id||!spellById(research.spell_id)||seen.has(research.spell_id)||!Number.isFinite(Date.parse(research.researched_at)))invalid();seen.add(research.spell_id);}
    }
    for(const f of w.formations)for(const [key,min,max] of [['magic_attack',1,1.5],['magic_defence',0,.4],['magic_speed',1,1.75]] as const)if(f[key]!==undefined&&(!Number.isFinite(f[key])||f[key]!<min||f[key]!>max))invalid();
    for(const b of w.battles)for(const key of ['mana_attacker','mana_defender','spell_ready_attacker','spell_ready_defender'] as const)if(b[key]!==undefined&&(!Number.isFinite(b[key])||b[key]!<0||b[key]!>1000))invalid();
    for(const f of w.formations)if(f.defence_multiplier!==undefined&&(!Number.isFinite(f.defence_multiplier)||f.defence_multiplier<1||f.defence_multiplier>3))invalid();
    for (const date of [town.resources_updated_at, army.departure_at, army.arrival_at, player.created_at])
        if (!Number.isFinite(Date.parse(date)))
            invalid();
    if (w.map_plots !== undefined && !Array.isArray(w.map_plots)) invalid();
    const plots = w.map_plots ?? [], plotKeys = new Set<string>();
    if (!Array.isArray(plots) || plots.length > (TERRITORY_RULES.radius * 2 + 1) ** 2 - 1 || plots.length > territoryAllowance(territoryPopulation(w, 'solo-ruler'))) invalid();
    const home = wrapWorldCell(Math.floor(town.x / CELL_SIZE), Math.floor(town.y / CELL_SIZE));
    for (const plot of plots) {
        if (!plot || typeof plot !== 'object' || !Number.isInteger(plot.col) || !Number.isInteger(plot.row) || plot.col < -WORLD_COLS / 2 || plot.col >= WORLD_COLS / 2 || plot.row < -WORLD_ROWS / 2 || plot.row >= WORLD_ROWS / 2 || plot.owner_id !== 'solo-ruler' || plot.settlement_id !== town.id || !Number.isInteger(plot.level) || plot.level < 0 || plot.level > TERRITORY_RULES.maxLevel || plot.building_type !== null && !Object.hasOwn(FIELD_BUILDINGS, plot.building_type) || plot.building_type === null && plot.level !== 0) invalid();
        const key = `${plot.col},${plot.row}`, distance = wrappedCellDistance(home, plot);
        if (plotKeys.has(key) || distance === 0 || distance > TERRITORY_RULES.radius || !isWalkable(plot.col, plot.row) || w.camps.some(c => wrappedCellDistance(plot, wrapWorldCell(Math.floor(c.x / CELL_SIZE), Math.floor(c.y / CELL_SIZE))) === 0)) invalid();
        plotKeys.add(key);
    }
    if (plots.filter(plot => wrappedCellDistance(home, plot) === 1).length < Math.min(TERRITORY_RULES.startingClaims, plots.length)) invalid();
    // A save may reorder records, so check the completed territory as a graph.
    // Canonical neighbors also connect legitimate claims on opposite map edges.
    const connected = new Set<string>(), queue = [home];
    for (let head = 0; head < queue.length; head++) for (const plot of plots) {
        const key = `${plot.col},${plot.row}`;
        if (!connected.has(key) && wrappedCellDistance(queue[head], plot) === 1) { connected.add(key); queue.push(plot); }
    }
    if (connected.size !== plots.length) invalid();
    if (w.orders.filter(o => o.kind === 'upgrade').length > 1 || w.orders.filter(o => o.kind === 'recruit').length > 3)
        invalid();
    const fieldQueues = new Set<string>();
    for (const o of w.orders) {
        if (!['upgrade', 'recruit', 'field'].includes(o.kind) || o.owner_id !== 'solo-ruler' || typeof o.item !== 'string' || !Number.isFinite(Date.parse(o.finish_at)) || !Number.isFinite(Date.parse(o.started_at)) || Date.parse(o.finish_at) < Date.parse(o.started_at) || !Number.isInteger(o.quantity) || o.quantity < 1 || o.quantity > 200) invalid();
        if (o.kind === 'field') {
            const plot = plots.find(plot => o.item === `field:${plot.col}:${plot.row}:${plot.building_type}`), key = plot && `${plot.col},${plot.row}`;
            if (!plot || !plot.building_type || plot.level >= TERRITORY_RULES.maxLevel || o.quantity !== 1 || fieldQueues.has(key!)) invalid();
            fieldQueues.add(key!);
        } else if (!(o.kind === 'upgrade' ? ['lumber', 'quarry', 'farm', 'market', 'barracks', 'stables', 'wall', 'storehouse', ...(w.city_slots??[]).map(s=>`slot:${s.slot_index}:${s.building_type}`)] : ['infantry', 'archers', 'cavalry']).includes(o.item)) invalid();
    }
    if (army.infantry + army.archers + army.cavalry + w.orders.filter(o => o.kind === 'recruit').reduce((n, o) => n + o.quantity, 0) > 1000)
        invalid();
    for(const f of w.formations)if([f.attack_ready_at,f.charge_distance].some(n=>n!==undefined&&(!Number.isFinite(n)||n<0))||f.damage_target_id!==undefined&&!Number.isSafeInteger(f.damage_target_id))invalid();
    for (const f of w.formations)
        if (!['infantry', 'archers', 'cavalry'].includes(f.unit_type) || !['idle', 'moving', 'engaged', 'routed'].includes(f.status) || [f.x, f.y, f.soldiers, f.morale, f.stamina, f.facing, f.columns].some(n => !Number.isFinite(n)) || f.soldiers < 0 || f.soldiers > 1000 || f.attack_multiplier!==undefined && (!Number.isFinite(f.attack_multiplier) || f.attack_multiplier<1 || f.attack_multiplier>4))
            invalid();
    if (w.battles.filter(b => b.status === 'active').length > 1 || w.battles.some(b => !['active', 'resolved'].includes(b.status) || !['deployment', 'combat', 'finished'].includes(b.phase) || !BATTLE_TERRAINS.includes(b.terrain)))
        invalid();
    const active = w.battles.find(b => b.status === 'active');
    if (active && (!w.formations.some(f => f.battle_id === active.id) || !Number.isFinite(active.elapsed) || active.elapsed < 0 || !['pve', 'practice'].includes(active.mode)))
        invalid();
    const normalized = structuredClone(w);
    for (const building of normalized.buildings) building.level = Math.min(5, building.level);
    normalized.city_slots ??= citySlots(normalized,town.id);
    for(const order of normalized.orders)if(order.kind==='upgrade'&&['barracks','stables','storehouse'].includes(order.item)){
        const type=order.item==='storehouse'?'warehouse':order.item,slot=normalized.city_slots.find(s=>s.settlement_id===town.id&&s.building_type===type);
        if(slot)order.item=`slot:${slot.slot_index}:${type}`;
    }
    if(normalized.settlements[0].population===undefined)settleLocal(normalized,'solo-ruler',Date.now(),false);
    refreshCityEconomy(normalized,town.id);
    return normalized;
}
/** Reuse the route/terrain validator for each independent city and army. */
export function validateSave(data: unknown): World {
    const w=data as World, invalid=()=>{throw new Error('This file is not a valid Peris campaign save.');};
    if(!w||w.version!==6||!Array.isArray(w.players)||w.players.length!==1||w.players[0]?.id!=='solo-ruler')invalid();
    for(const key of ['settlements','armies','buildings','camps','orders','battles','formations','reports','progress','claims','challenges'] as const)
        if(!Array.isArray(w[key])||w[key].length>15000||w[key].some(r=>!r||typeof r!=='object'))invalid();
    if(w.settlements.length<1||w.settlements.length>10||w.armies.length<1||w.armies.length>20)invalid();
    const cities=new Map(w.settlements.map(s=>[s.id,s])), armies=new Map(w.armies.map(a=>[a.id,a]));
    if(cities.size!==w.settlements.length||armies.size!==w.armies.length||new Set(w.buildings.map(b=>b.id)).size!==w.buildings.length||new Set(w.orders.map(o=>o.id)).size!==w.orders.length)invalid();
    for(const city of w.settlements){
        if(!Number.isSafeInteger(city.id)||city.id<1||city.owner_id!=='solo-ruler'||typeof city.name!=='string'||city.name.length>32)invalid();
        if(city.settlers!==undefined&&(!Number.isInteger(city.settlers)||city.settlers<0||city.settlers>6))invalid();
        if(city.development_points!==undefined&&(!Number.isInteger(city.development_points)||city.development_points<0||city.development_points>1e9))invalid();
    }
    for(const army of w.armies)if(!Number.isSafeInteger(army.id)||army.id<1||army.owner_id!=='solo-ruler'||!cities.has(army.home_settlement_id)||typeof army.name!=='string'||army.name.length>80)invalid();
    for(const building of w.buildings)if(!cities.has(building.settlement_id))invalid();
    for(const key of ['city_slots','spell_research','map_plots','heroes','hero_artifacts','settler_expeditions'] as const)if(w[key]!==undefined&&!Array.isArray(w[key]))invalid();
    for(const slot of w.city_slots??[])if(!cities.has(slot.settlement_id))invalid();
    for(const research of w.spell_research??[])if(!cities.has(research.settlement_id))invalid();
    const plotCells=new Set<string>();
    for(const plot of w.map_plots??[]){const key=`${plot.col},${plot.row}`;if(!cities.has(plot.settlement_id)||plotCells.has(key))invalid();plotCells.add(key);}
    const firstCity=w.settlements[0].id, firstArmy=w.armies[0].id;
    for(const order of w.orders){
        if(!cities.has(order.settlement_id??firstCity))invalid();
        if(order.kind==='recruit'&&!armies.has(order.army_id??firstArmy))invalid();
        if(order.kind==='settler'&&(order.owner_id!=='solo-ruler'||order.item!=='settlers'||!Number.isInteger(order.quantity)||order.quantity<1||order.quantity>3||!Number.isFinite(Date.parse(order.started_at))||!Number.isFinite(Date.parse(order.finish_at))||Date.parse(order.finish_at)<Date.parse(order.started_at)))invalid();
    }
    const normalized=structuredClone(w), migratedSlots=[] as NonNullable<World['city_slots']>;
    for(const city of w.settlements){
        const army=w.armies.find(a=>a.home_settlement_id===city.id)??{...w.armies[0],home_settlement_id:city.id};
        const cultureUpgrades=w.settlements.length===1?w.players[0].upgrades:city.development_points??0;
        const projected:World={...w,players:[{...w.players[0],upgrades:cultureUpgrades}],settlements:[city],armies:[army],buildings:w.buildings.filter(b=>b.settlement_id===city.id),city_slots:w.city_slots?.filter(s=>s.settlement_id===city.id),spell_research:w.spell_research?.filter(r=>r.settlement_id===city.id),map_plots:w.map_plots?.filter(p=>p.settlement_id===city.id),orders:w.orders.filter(o=>(o.settlement_id??firstCity)===city.id&&o.kind!=='settler'&&o.kind!=='recruit'),settler_expeditions:[]};
        if(w.orders.filter(o=>(o.settlement_id??firstCity)===city.id&&o.kind==='settler').length>1)invalid();
        if((city.settlers??0)+w.orders.filter(o=>(o.settlement_id??firstCity)===city.id&&o.kind==='settler').reduce((n,o)=>n+o.quantity,0)+3*(w.settler_expeditions??[]).filter(e=>e.origin_settlement_id===city.id&&e.status==='travelling').length>6)invalid();
        const result=validateLegacySave(projected);
        normalized.settlements[normalized.settlements.findIndex(s=>s.id===city.id)]=result.settlements[0];
        migratedSlots.push(...result.city_slots??[]);
    }
    normalized.city_slots??=migratedSlots;
    for(const army of w.armies){
        const city=cities.get(army.home_settlement_id)!;
        const orders=w.orders.filter(o=>o.kind==='recruit'&&(o.army_id??firstArmy)===army.id);
        const projected:World={...w,settlements:[city],armies:[army],buildings:w.buildings.filter(b=>b.settlement_id===city.id),city_slots:[],spell_research:[],map_plots:[],orders,settler_expeditions:[]};
        validateLegacySave(projected);
    }
    const player=w.players[0];
    if(player.culture_points!==undefined&&(!Number.isFinite(player.culture_points)||player.culture_points<0||player.culture_points>1e9))invalid();
    if(player.culture_updated_at!==undefined&&!Number.isFinite(Date.parse(player.culture_updated_at)))invalid();
    if(w.heroes!==undefined&&!Array.isArray(w.heroes)||w.hero_artifacts!==undefined&&!Array.isArray(w.hero_artifacts)||w.settler_expeditions!==undefined&&!Array.isArray(w.settler_expeditions))invalid();
    if((w.heroes?.length??0)>20||(w.hero_artifacts?.length??0)>200||(w.settler_expeditions?.length??0)>1000)invalid();
    const heroIds=new Set<number>(),heroArmies=new Set<number>(),artifactIds=new Set<number>(),equipment=new Set<string>();
    for(const hero of w.heroes??[]){
        if(!hero||!Number.isSafeInteger(hero.id)||hero.id<1||hero.owner_id!=='solo-ruler'||!armies.has(hero.army_id)||heroIds.has(hero.id)||heroArmies.has(hero.army_id)||typeof hero.name!=='string'||hero.name.length<2||hero.name.length>80||!Object.hasOwn(HERO_CLASSES,hero.class)||!Number.isInteger(hero.experience)||hero.experience<0||hero.experience>heroThreshold(MAX_HERO_LEVEL)||HERO_STATS.some(k=>!Number.isInteger(hero[k])||hero[k]<0||hero[k]>19)||heroPoints(hero)<0)invalid();
        heroIds.add(hero.id);heroArmies.add(hero.army_id);
    }
    for(const item of w.hero_artifacts??[]){
        if(!item||!Number.isSafeInteger(item.id)||item.id<1||artifactIds.has(item.id)||item.owner_id!=='solo-ruler'||!ARTIFACTS[item.artifact_id]||item.hero_id!==null&&!heroIds.has(item.hero_id))invalid();
        artifactIds.add(item.id);
        if(item.hero_id!==null){const key=`${item.hero_id}:${ARTIFACTS[item.artifact_id].slot}`;if(equipment.has(key))invalid();equipment.add(key);}
    }
    const expeditionIds=new Set<number>(), reservations=new Set<string>();
    for(const expedition of w.settler_expeditions??[]){
        if(!expedition||!Number.isSafeInteger(expedition.id)||expedition.id<1||expeditionIds.has(expedition.id)||expedition.owner_id!=='solo-ruler'||!cities.has(expedition.origin_settlement_id)||!Number.isInteger(expedition.col)||!Number.isInteger(expedition.row)||expedition.col< -100||expedition.col>=100||expedition.row< -100||expedition.row>=100||typeof expedition.name!=='string'||expedition.name.length<2||expedition.name.length>32||!['travelling','founded','returned'].includes(expedition.status)||!Number.isFinite(Date.parse(expedition.departure_at))||!Number.isFinite(Date.parse(expedition.arrival_at))||Date.parse(expedition.arrival_at)<Date.parse(expedition.departure_at)||!Number.isInteger(expedition.culture_cost)||expedition.culture_cost<300||expedition.culture_cost>30000)invalid();
        expeditionIds.add(expedition.id);
        if(expedition.status==='founded'&&!cities.has(expedition.settlement_id!))invalid();
        if(expedition.status==='travelling'){const key=`${expedition.col},${expedition.row}`;if(reservations.has(key))invalid();reservations.add(key);}
        const origin=cities.get(expedition.origin_settlement_id)!, end=expedition.march_path?.at(-1);
        if(!end||end[0]!==expedition.col*128+64||end[1]!==expedition.row*128+64)invalid();
        const routeArmy={...w.armies[0],home_settlement_id:origin.id,start_x:origin.x,start_y:origin.y,target_x:end![0],target_y:end![1],status:'moving' as const,departure_at:expedition.departure_at,arrival_at:expedition.arrival_at,march_path:expedition.march_path,march_map_version:WORLD_MAP_VERSION,march_distance:expedition.march_path.slice(1).reduce((n,p,i)=>n+Math.hypot(wrappedWorldDelta(expedition.march_path[i][0],p[0]),wrappedWorldDelta(expedition.march_path[i][1],p[1])),0)};
        validateLegacySave({...w,settlements:[origin],armies:[routeArmy],buildings:w.buildings.filter(b=>b.settlement_id===origin.id),city_slots:[],spell_research:[],map_plots:[],orders:[],settler_expeditions:[]});
    }
    for(const battle of w.battles)if(!armies.has(battle.attacker_army_id)||battle.defender_army_id!==null)invalid();
    // Historical receipts remain valid even when equipment is moved to another hero.
    for(const entry of [...w.battles,...w.reports]){
        const reward=entry.result?.hero_reward;
        if(reward==null)continue;
        if(typeof reward!=='object'||!Number.isSafeInteger(reward.hero_id)||reward.hero_id<1||typeof reward.hero_name!=='string'||reward.hero_name.length<2||reward.hero_name.length>80||!Object.hasOwn(HERO_CLASSES,reward.hero_class)||reward.faction!=null&&!isFaction(reward.faction)||typeof reward.inventory_full!=='boolean'||!Array.isArray(reward.artifacts)||reward.artifacts.length>20)invalid();
        for(const key of ['experience','experience_before','experience_after'] as const)if(!Number.isInteger(reward[key])||reward[key]<0||reward[key]>heroThreshold(MAX_HERO_LEVEL))invalid();
        if(reward.experience_after-reward.experience_before!==reward.experience)invalid();
        for(const when of ['before','after'] as const){const level=reward[`level_${when}`],xp=reward[`experience_${when}`];if(!Number.isInteger(level)||level<1||level>MAX_HERO_LEVEL||xp<heroThreshold(level)||level<MAX_HERO_LEVEL&&xp>=heroThreshold(level+1))invalid();}
        const receiptIds=new Set<number>();
        for(const item of reward.artifacts){if(!item||!Number.isSafeInteger(item.id)||item.id<1||receiptIds.has(item.id)||!Object.hasOwn(ARTIFACTS,item.artifact_id))invalid();receiptIds.add(item.id);}
    }
    if(w.settlements.length===1&&w.armies.length===1){
        const legacy=validateLegacySave({...w,orders:w.orders.filter(o=>o.kind!=='settler'),settler_expeditions:[]});
        normalized.settlements=legacy.settlements;normalized.buildings=legacy.buildings;normalized.city_slots=legacy.city_slots;if(legacy.map_plots!==undefined)normalized.map_plots=legacy.map_plots;normalized.players=legacy.players;normalized.armies=legacy.armies;
        normalized.orders=[...legacy.orders,...w.orders.filter(o=>o.kind==='settler')];
    }
    return normalizeRealm(normalized,normalized.server_now,false);
}
export async function importSave(file: File) { if (file.size > 12 * 1024 * 1024)
    throw new Error('Save files must be smaller than 12 MB.'); try {
    return validateSave(JSON.parse(await file.text()));
}
catch (e) {
    throw new Error(e instanceof SyntaxError ? 'Choose an exported Peris JSON save file.' : 'This file is not a valid Peris campaign save.');
} }
export function exportSave(world = readSolo()) {
    if (!world)
        return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(world, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `Peris-${world.players[0].display_name.replace(/[^a-z0-9]/gi, '-')}-save.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

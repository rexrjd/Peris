import {ensureScience,startResearch,pauseResearch,debugResearch} from '../../features/research/domain/science';
import { EngineClock } from '../clock';
import { autoCastSpells } from '../../features/magic/domain/automatic';
import { normalizeRealm } from '../../features/empire/domain/normalization';
import { isDefeated } from '../../features/city/domain/ruins';
import { trainSettlers, sendSettlers, nextEntityId } from '../../features/empire/domain/expansion';
import { recruitHero, improveHero, equipArtifact, transferTroops, rebaseArmy } from '../../features/heroes/domain/commands';
import type { Faction } from '../../features/factions/domain/factions';
import {changeFaction,debugCity} from '../../features/factions/domain/debug';
import { type GameEngine } from '../contracts';
import { type Command, type LocalCommandContext } from '../../shared/model/commands';
import { type World } from '../../shared/model/world';
import { settleLocal,activateTroopUpkeep } from '../../features/campaign/domain/settlement';
import {refreshTroopUpkeep} from '../../features/city/domain/troopSupply';
import { SAVE_KEY } from '../../platform/storage/solo';
import { stepBattle } from '../../features/battle/domain/simulation';
import { beginRaid } from '../../features/campaign/domain/raids';
import { beginCityRaid } from '../../features/campaign/domain/cityRaids';
import { startPractice } from '../../features/battle/domain/practice';
import { type Difficulty, type Terrain } from '../../features/battle/domain/types';
import { settleBattle } from '../../features/campaign/domain/battleSettlement';
import { upgradeBuilding } from '../../features/city/domain/commands';
import { researchUnit } from '../../features/army/domain/research';
import { recruitSoldiers } from '../../features/army/domain/commands';
import { cancelMarch, marchArmy, restoreRaidReserve, startRaidReturn } from '../../features/map/domain/commands';
import { commandBattle } from '../../features/battle/domain/commands';
import { claimObjective } from '../../features/campaign/domain/commands';
import { renameCity } from '../../features/city/domain/rename';
import { queueSlot } from '../../features/city/domain/slotCommands';
import { citySlots, refreshCityEconomy } from '../../features/city/domain/slots';
import {researchSpell} from '../../features/magic/domain/commands';
import { claimMapField, queueMapField } from '../../features/map/domain/territory';
import { commandCampaignFarm } from '../../features/campaign/domain/farms';
import { advanceCampFarms } from '../../features/campaign/domain/campEconomy';
import { sendCityReinforcements } from '../../features/city/domain/cityReinforcements';
import { manageCityGarrison } from '../../features/city/domain/cityGarrison';
import { collectGarrison } from '../../features/map/domain/garrisons';
import { sendResources } from '../../features/city/domain/trade';
import {commandTradeRoute} from '../../features/city/domain/tradeRoutes';
import { markAllReportsRead, markReportsRead } from '../../features/campaign/domain/reports';
export class LocalEngine implements GameEngine {
    readonly playerId = 'solo-ruler';
    readonly mode: 'solo' | 'practice';
    snapshot: World;
    private gameClock = new EngineClock({ server_now: new Date().toISOString() }, () => performance.now());
    nowGameMs = () => this.gameClock.nowGameMs();
    private listeners = new Set<() => void>();
    private timer: number;
    private last = performance.now();
    private nextSave = 0;
    private persistent: boolean;
    private alive = true;
    private nextId: number;
    private finalized = new Set<number>();
    private battleDebt=0;
    speed = 1;
    paused = false;
    saveError = false;
    constructor(world: World, persistent = true) {
        if (world.game_clock && world.game_clock.rate !== 1) throw new Error('An accelerated world cannot be loaded as a solo campaign.');
        delete world.game_clock;
        world.server_now = new Date(this.nowGameMs()).toISOString();
        normalizeRealm(world);
        ensureScience(world,this.playerId);
        for(const battle of world.battles)if(battle.status==='active'&&battle.phase==='deployment'){battle.phase='combat';battle.attacker_ready=battle.defender_ready=true;}
        this.snapshot = world;
        world.city_slots ??= citySlots(world,world.settlements[0].id);
        for (const order of world.orders) if (order.kind==='upgrade' && ['barracks','stables','storehouse'].includes(order.item)) {
            const type=order.item==='storehouse'?'warehouse':order.item;
            const slot=world.city_slots.find(s=>s.settlement_id===order.settlement_id&&s.building_type===type);
            if (slot) order.item=`slot:${slot.slot_index}:${type}`;
        }
        if(world.settlements[0].population===undefined)settleLocal(world,this.playerId,this.nowGameMs());
        for (const city of world.settlements.filter(s=>s.owner_id===this.playerId)) refreshCityEconomy(world,city.id);
        this.mode = persistent ? 'solo' : 'practice';
        this.persistent = persistent;
        this.nextId = Math.max(100, Date.now() % 100000000, nextEntityId(world));
        this.snapshot.battles.filter(b => b.status === 'resolved').forEach(b => this.finalized.add(b.id));
        const resumed=this.active();
        if(resumed?.phase==='combat')this.battleDebt=Math.min(900,Math.max(0,(this.nowGameMs()-Date.parse(resumed.last_tick_at))/1000));
        activateTroopUpkeep(world,this.nowGameMs());
        settleLocal(world, this.playerId);
        this.advanceFarms();
        this.timer = window.setInterval(() => this.tick(), 50);
        this.save();
    }
    subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
    private publish() { refreshTroopUpkeep(this.snapshot,this.nowGameMs());this.snapshot = { ...this.snapshot, server_now: new Date(this.nowGameMs()).toISOString() }; this.listeners.forEach(fn => fn()); }
    private save() { if (this.persistent)
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(this.snapshot));
            this.saveError = false;
        }
        catch {
            this.saveError = true;
        } }
    private active() { return this.snapshot.battles.find(b => b.status === 'active'); }
    private tick() {
        const now=performance.now(),elapsed=Math.max(0,(now-this.last)/1000),dt=Math.min(.5,elapsed);
        this.last = now;
        this.snapshot.server_now = new Date(this.nowGameMs()).toISOString();
        const b = this.active();
        if (b && b.phase === 'combat' && !this.paused) {
            this.battleDebt+=elapsed*this.speed;
            let remaining=Math.min(10,this.battleDebt);this.battleDebt-=remaining;
            b.last_tick_at=this.snapshot.server_now;
            while (remaining > 0 && b.status === 'active') {
                const step = Math.min(.05, remaining);
                stepBattle(b,this.snapshot.formations.filter(f=>f.battle_id===b.id),step,()=>autoCastSpells(this.snapshot,b,()=>++this.nextId,id=>this.finalize(id)));
                remaining -= step;
            }
            if (b.status === 'resolved')
                this.finalize(b.id);
        }
        if(!b||this.paused)this.battleDebt=0;
        if (Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250)) {
            settleLocal(this.snapshot, this.playerId);
            this.advanceFarms();
            for(const army of this.snapshot.armies.filter(row=>row.owner_id===this.playerId&&row.raid_city_id&&row.status==='idle'))if(!this.active()){
                if(!this.snapshot.settlements.some(city=>city.id===army.raid_city_id&&city.owner_id!==this.playerId))startRaidReturn(this.snapshot,army);
                else beginCityRaid(this.snapshot,this.playerId,army.id,()=>++this.nextId);
            }
            for (const army of this.snapshot.armies.filter(a => a.owner_id === this.playerId)) if (!this.active() && army.raid_target_id && army.status === 'idle') {
                const camp = this.snapshot.camps.find(c => c.id === army.raid_target_id);
                if (camp && (camp.bandit || !this.snapshot.progress.some(p=>p.owner_id===this.playerId&&p.camp_id===camp.id&&Date.parse(p.available_at)>this.nowGameMs()))) {
                    army.raid_target_id = null;
                    this.beginRaid(camp.id, army.id);
                } else { restoreRaidReserve(army); startRaidReturn(this.snapshot, army); }
            }
            this.publish();
        }
        if (now > this.nextSave) {
            this.nextSave = now + 2000;
            this.save();
        }
    }
    private advanceFarms() {
        if (this.mode === 'practice' || isDefeated(this.snapshot,this.playerId)) return;
        advanceCampFarms({ world: this.snapshot, playerId: this.playerId, nextId: () => ++this.nextId, active: this.active(), now: new Date(this.nowGameMs()).toISOString(), paused: () => {}, finalize: id => this.finalize(id) }, this.nowGameMs());
    }
    private beginRaid(campId: number, armyId?: number) { beginRaid(this.snapshot, this.playerId, campId, () => ++this.nextId, armyId); }
    startPractice(terrain: Terrain, difficulty: Difficulty, doctrine: 'balanced' | 'infantry' | 'cavalry' = 'balanced', faction: Faction = 'roman', enemy: Faction = 'orc') { startPractice(this.snapshot, this.playerId, () => ++this.nextId, terrain, difficulty, doctrine, faction, enemy); this.publish(); }
    private finalize(id: number) {
        if (this.finalized.has(id))
            return;
        this.finalized.add(id);
        const b = this.snapshot.battles.find(b => b.id === id)!;
        if (b.mode !== 'practice')
            settleBattle(this.snapshot, id, this.playerId, () => ++this.nextId);
        this.publish();
        this.save();
    }
    command = async (cmd: Command) => {
        if (isDefeated(this.snapshot,this.playerId)) throw new Error('This ruler has been defeated. Your cities remain as ruins.');
        settleLocal(this.snapshot, this.playerId);
        this.advanceFarms();
        const active = this.active();
        if (['claimField', 'buildField', 'researchSpell', 'upgrade', 'buildSlot', 'upgradeSlot', 'recruit', 'researchUnit', 'move', 'raid', 'raidCity', 'trainSettlers', 'foundCity', 'recruitHero', 'heroSkill', 'equipArtifact', 'transferTroops', 'rebaseArmy', 'manageCityGarrison', 'reinforceCity'].includes(cmd.type) && active)
            throw new Error('Finish the current battle first.');
        this.snapshot.server_now = new Date(this.nowGameMs()).toISOString();
        const context: LocalCommandContext = { world: this.snapshot, playerId: this.playerId, settlementId: cmd.settlementId, armyId: cmd.armyId, nextId: () => this.nextId = Math.max(this.nextId + 1, nextEntityId(this.snapshot)), active, now: new Date(this.nowGameMs()).toISOString(), paused: value => { this.paused = value; }, finalize: id => this.finalize(id) };
        switch (cmd.type) {
            case 'sendResources': sendResources(context,cmd); break;
            case 'saveTradeRoute':case 'setTradeRouteEnabled':case 'deleteTradeRoute':commandTradeRoute(context,cmd);break;
            case 'reinforceGuild': case 'recallGuildReinforcements': throw new Error('Enter the shared world to send guild reinforcements.');
            case 'startResearch': startResearch(this.snapshot,this.playerId,cmd.technologyId,Date.parse(context.now)); break;
            case 'pauseResearch': pauseResearch(this.snapshot,this.playerId,Date.parse(context.now)); break;
            case 'debugResearch': debugResearch(this.snapshot,this.playerId,cmd.action,Date.parse(context.now)); break;
            case 'readAllReports': markAllReportsRead(this.snapshot, this.playerId, context.now); break;
            case 'readReports': markReportsRead(this.snapshot, this.playerId, cmd.reportIds, context.now); break;
            case 'saveCampaignFarmList': case 'saveCampaignFarm': case 'deleteCampaignFarm': case 'deleteCampaignFarmList': case 'startCampaignFarmList': case 'manageCampaignFarmTargets': case 'setCampaignFarmListEnabled': case 'applyCampaignFarmListTroops':
                commandCampaignFarm(context, cmd); break;
            case 'trainSettlers': trainSettlers(context, cmd.quantity); break;
            case 'foundCity': sendSettlers(context, cmd.col, cmd.row, cmd.name); break;
            case 'recruitHero': recruitHero(context, cmd); break;
            case 'heroSkill': improveHero(context, cmd.heroId, cmd.stat); break;
            case 'equipArtifact': equipArtifact(context, cmd.heroId, cmd.artifactId, cmd.equip); break;
            case 'transferTroops': transferTroops(context, cmd); break;
            case 'manageCityGarrison': manageCityGarrison(context, cmd); break;
            case 'reinforceCity': sendCityReinforcements(context, cmd); break;
            case 'rebaseArmy': rebaseArmy(context); break;
            case 'claimField': claimMapField(context, cmd.col, cmd.row); break;
            case 'buildField': queueMapField(context, cmd.col, cmd.row, cmd.item); break;
            case 'setFaction':changeFaction(context,cmd);break;
            case 'debugCity':debugCity(context,cmd);break;
            case 'researchSpell':researchSpell(context,cmd);break;
            case 'castSpell':throw new Error('The AI controls battle spells automatically.');
            case 'buildSlot':
            case 'upgradeSlot': queueSlot(context,cmd); break;
            case 'upgrade':
                upgradeBuilding(context, cmd);
                break;
            case 'researchUnit': researchUnit(context, cmd); break;
            case 'recruit':
                recruitSoldiers(context, cmd);
                break;
            case 'move':
            case 'raid':
            case 'raidCity':
                marchArmy(context, cmd);
                break;
            case 'cancelMarch': cancelMarch(context, cmd); break;
            case 'collectGarrison': collectGarrison(context, cmd); break;
            case 'ready':
            case 'order':
            case 'rally':
            case 'retreat':
                commandBattle(context, cmd);
                break;
            case 'claim':
                claimObjective(context, cmd);
                break;
            case 'rename':
                renameCity(context, cmd);
                break;
            default: throw new Error('Live challenges are available in multiplayer.');
        }
        this.publish();
        this.save();
    };
    destroy = () => { if (!this.alive)
        return; this.alive = false; window.clearInterval(this.timer); this.save(); this.listeners.clear(); };
}

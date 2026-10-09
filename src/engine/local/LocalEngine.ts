import { normalizeRealm } from '../../features/empire/domain/normalization';
import { trainSettlers, sendSettlers, nextEntityId } from '../../features/empire/domain/expansion';
import { recruitHero, improveHero, equipArtifact, transferTroops, rebaseArmy } from '../../features/heroes/domain/commands';
import {changeFaction,debugCity} from '../../features/factions/domain/debug';
import { type GameEngine } from '../contracts';
import { type Command, type LocalCommandContext } from '../../shared/model/commands';
import { type World } from '../../shared/model/world';
import { settleLocal } from '../../features/campaign/domain/settlement';
import { SAVE_KEY } from '../../platform/storage/solo';
import { stepBattle } from '../../features/battle/domain/simulation';
import { beginRaid } from '../../features/campaign/domain/raids';
import { startPractice } from '../../features/battle/domain/practice';
import { type Difficulty, type Terrain } from '../../features/battle/domain/types';
import { settleBattle } from '../../features/campaign/domain/battleSettlement';
import { upgradeBuilding } from '../../features/city/domain/commands';
import { recruitSoldiers } from '../../features/army/domain/commands';
import { marchArmy } from '../../features/map/domain/commands';
import { commandBattle } from '../../features/battle/domain/commands';
import { claimObjective } from '../../features/campaign/domain/commands';
import { renameCity } from '../../features/city/domain/rename';
import { queueSlot } from '../../features/city/domain/slotCommands';
import { citySlots, refreshCityEconomy } from '../../features/city/domain/slots';
import {researchSpell,castSpell} from '../../features/magic/domain/commands';
import { claimMapField, queueMapField } from '../../features/map/domain/territory';
export class LocalEngine implements GameEngine {
    readonly playerId = 'solo-ruler';
    readonly mode: 'solo' | 'practice';
    snapshot: World;
    private listeners = new Set<() => void>();
    private timer: number;
    private last = performance.now();
    private nextSave = 0;
    private persistent: boolean;
    private alive = true;
    private nextId: number;
    private finalized = new Set<number>();
    speed = 1;
    paused = false;
    saveError = false;
    constructor(world: World, persistent = true) {
        normalizeRealm(world);
        this.snapshot = world;
        world.city_slots ??= citySlots(world,world.settlements[0].id);
        for (const order of world.orders) if (order.kind==='upgrade' && ['barracks','stables','storehouse'].includes(order.item)) {
            const type=order.item==='storehouse'?'warehouse':order.item;
            const slot=world.city_slots.find(s=>s.settlement_id===order.settlement_id&&s.building_type===type);
            if (slot) order.item=`slot:${slot.slot_index}:${type}`;
        }
        if(world.settlements[0].population===undefined)settleLocal(world,this.playerId,Date.now());
        for (const city of world.settlements.filter(s=>s.owner_id===this.playerId)) refreshCityEconomy(world,city.id);
        this.mode = persistent ? 'solo' : 'practice';
        this.persistent = persistent;
        this.nextId = Math.max(100, Date.now() % 100000000, nextEntityId(world));
        this.snapshot.battles.filter(b => b.status === 'resolved').forEach(b => this.finalized.add(b.id));
        settleLocal(world, this.playerId);
        this.timer = window.setInterval(() => this.tick(), 50);
        this.save();
    }
    subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
    private publish() { this.snapshot = { ...this.snapshot, server_now: new Date().toISOString() }; this.listeners.forEach(fn => fn()); }
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
        const now = performance.now(), dt = Math.min(.5, (now - this.last) / 1000);
        this.last = now;
        const b = this.active();
        if (b && b.phase === 'combat' && !this.paused) {
            let remaining = dt * this.speed;
            while (remaining > 0 && b.status === 'active') {
                const step = Math.min(.05, remaining);
                stepBattle(b, this.snapshot.formations.filter(f => f.battle_id === b.id), step);
                remaining -= step;
            }
            if (b.status === 'resolved')
                this.finalize(b.id);
        }
        if (Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250)) {
            settleLocal(this.snapshot, this.playerId);
            for (const army of this.snapshot.armies.filter(a => a.owner_id === this.playerId)) if (!this.active() && army.raid_target_id && army.status === 'idle') {
                const camp = this.snapshot.camps.find(c => c.id === army.raid_target_id);
                if (camp && !this.snapshot.progress.some(p=>p.owner_id===this.playerId&&p.camp_id===camp.id&&Date.parse(p.available_at)>Date.now())) {
                    army.raid_target_id = null;
                    this.beginRaid(camp.id, army.id);
                } else army.raid_target_id=null;
            }
            this.publish();
        }
        if (now > this.nextSave) {
            this.nextSave = now + 2000;
            this.save();
        }
    }
    private beginRaid(campId: number, armyId?: number) { beginRaid(this.snapshot, this.playerId, campId, () => ++this.nextId, armyId); }
    startPractice(terrain: Terrain, difficulty: Difficulty, doctrine: 'balanced' | 'infantry' | 'cavalry' = 'balanced') { startPractice(this.snapshot, this.playerId, () => ++this.nextId, terrain, difficulty, doctrine); this.publish(); }
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
        settleLocal(this.snapshot, this.playerId);
        const active = this.active();
        if (['claimField', 'buildField', 'researchSpell', 'upgrade', 'buildSlot', 'upgradeSlot', 'recruit', 'move', 'raid', 'trainSettlers', 'foundCity', 'recruitHero', 'heroSkill', 'equipArtifact', 'transferTroops', 'rebaseArmy'].includes(cmd.type) && active)
            throw new Error('Finish the current battle first.');
        const context: LocalCommandContext = { world: this.snapshot, playerId: this.playerId, settlementId: cmd.settlementId, armyId: cmd.armyId, nextId: () => this.nextId = Math.max(this.nextId + 1, nextEntityId(this.snapshot)), active, now: new Date().toISOString(), paused: value => { this.paused = value; }, finalize: id => this.finalize(id) };
        switch (cmd.type) {
            case 'trainSettlers': trainSettlers(context, cmd.quantity); break;
            case 'foundCity': sendSettlers(context, cmd.col, cmd.row, cmd.name); break;
            case 'recruitHero': recruitHero(context, cmd); break;
            case 'heroSkill': improveHero(context, cmd.heroId, cmd.stat); break;
            case 'equipArtifact': equipArtifact(context, cmd.heroId, cmd.artifactId, cmd.equip); break;
            case 'transferTroops': transferTroops(context, cmd); break;
            case 'rebaseArmy': rebaseArmy(context); break;
            case 'claimField': claimMapField(context, cmd.col, cmd.row); break;
            case 'buildField': queueMapField(context, cmd.col, cmd.row, cmd.item); break;
            case 'setFaction':changeFaction(context,cmd);break;
            case 'debugCity':debugCity(context,cmd);break;
            case 'researchSpell':researchSpell(context,cmd);break;
            case 'castSpell':castSpell(context,cmd);break;
            case 'buildSlot':
            case 'upgradeSlot': queueSlot(context,cmd); break;
            case 'upgrade':
                upgradeBuilding(context, cmd);
                break;
            case 'recruit':
                recruitSoldiers(context, cmd);
                break;
            case 'move':
            case 'raid':
                marchArmy(context, cmd);
                break;
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

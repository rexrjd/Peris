import { readArmyCultures } from './armyCultures';
import type { Faction } from '../../features/factions/domain/factions';
import { rpcCommand } from './rpcCommands';
import { MutationJournal } from './mutationJournal';
import { type GameEngine } from '../contracts';
import { type Command } from '../../shared/model/commands';
import { type World } from '../../shared/model/world';
import { armyPosition } from '../../features/map/domain/movement';
import { CELL_SIZE, WORLD_MAP_VERSION, WORLD_MAP_SEED, WORLD_COLS, WORLD_ROWS, WORLD_MIN_X, WORLD_MIN_Y, WORLD_MAX_X, WORLD_MAX_Y, wrapWorldPoint } from '../../features/map/domain/dimensions';
import { findMarchPath } from '../../features/map/domain/pathfinding';
import { isWalkable } from '../../features/map/domain/worldGrid';
import { supabase } from '../../platform/backend/supabase';
import { loginAccount } from '../../platform/backend/accounts';
import type { AccountEntry } from '../../platform/backend/accountLogin';
import type { Report } from '../../features/campaign/domain/types';
import { expiredSession } from '../../platform/backend/accountLogin';
import { rememberRuler } from '../../platform/backend/accountStorage';
import {PollBackoff,statePollInterval,isLockContention,WORLD_BUSY} from '../../platform/backend/polling';
import { EngineClock } from '../clock';
import type { RankingPeriod } from '../../features/rankings/domain/types';
import { readRankings } from '../../features/rankings/platform/client';

type MapBounds = { minX: number; minY: number; maxX: number; maxY: number };
type PublicMapSnapshot = {
    server_now: string;
    players: Pick<World['players'][number], 'id' | 'display_name'>[];
    settlements: Pick<World['settlements'][number], 'id' | 'owner_id' | 'name' | 'x' | 'y' | 'faction' | 'map_development' | 'ruined_at'>[];
    armies: World['armies'];
    map_plots: NonNullable<World['map_plots']>;
    total_players: number;
    total_settlements: number;
    settlements_truncated: boolean;
    armies_truncated: boolean;
    plots_truncated: boolean;
};
const PUBLIC_DATE = '1970-01-01T00:00:00.000Z';
const WORLD_UPGRADE = 'Install supabase/UPGRADE_TO_V9.sql for the seamless world and persistent external fields. Existing cities and faction systems are preserved. The migration checks occupied positions before changing terrain.';
function currentMap(map: World['map']) { return map?.version === WORLD_MAP_VERSION && map.cols === WORLD_COLS && map.rows === WORLD_ROWS && map.cell_size === CELL_SIZE && map.seed === WORLD_MAP_SEED; }

/** Private campaign state and bounded public map pages are kept separate. */
export class OnlineEngine implements GameEngine {
    readonly mode = 'online' as const;
    snapshot: World;
    readonly playerId: string;
    private core: World;
    private gameClock: EngineClock;
    nowGameMs = () => this.gameClock.nowGameMs();
    private armyCultures = new Map<number, Faction>();
    private culturesAt = 0;
    private cultureBattleIds = '';
    private culturesBusy = false;
    private publicMap: PublicMapSnapshot | null = null;
    private viewport: MapBounds;
    private mapRevision = 0;
    private mapBusy = false;
    private mapQueued = false;
    private mapDebounce: number | undefined;
    private mapTimer: number;
    private listeners = new Set<() => void>();
    private timer: number;
    private channel: ReturnType<typeof supabase.channel>;
    private requests = new Set<AbortController>();
    private busy = false;
    private dirty = false;
    private dirtyForced = false;
    private alive = true;
    private realtimeTimer: number | undefined;
    private coreError: string | null = null;
    private mapError: string | null = null;
    private lastCorePoll = Date.now();
    private lastMapPoll = 0;
    private coreBackoff = new PollBackoff();
    private mapBackoff = new PollBackoff();
    private cultureBackoff = new PollBackoff();
    private ticking = false;
    private reconnecting: Promise<void> | null = null;
    private recoveryTimer: number | undefined;
    private authSubscription: { unsubscribe: () => void };
    private sessionId: string;
    error: string | null = null;
    connected = false;
    private mutations: MutationJournal;
    get pendingCommand() { return this.mutations?.pending ?? null; }

    constructor(playerId: string, snapshot: World, sessionId: string = playerId) {
        this.gameClock = new EngineClock(snapshot, () => performance.now());
        this.playerId = playerId;
        this.sessionId = sessionId;
        this.core = snapshot;
        this.snapshot = snapshot;
        const pendingKey = `peris-pending-command:${playerId}`;
        this.mutations = new MutationJournal({
            read: () => { try { return JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null'); } catch { return null; } },
            write: intent => { if (intent) sessionStorage.setItem(pendingKey, JSON.stringify(intent)); else sessionStorage.removeItem(pendingKey); },
        }, intent => this.rpc('peris_submit_command', { p_request_id: intent.requestId, p_function: intent.fn, p_args: intent.args }),
        () => crypto.randomUUID(), () => this.publish());
        const army = snapshot.armies.find(a => a.owner_id === playerId), town = snapshot.settlements.find(s => s.owner_id === playerId);
        const origin = army ? armyPosition(army, Date.parse(snapshot.server_now)) : town ?? { x: 0, y: 0 };
        this.viewport = this.clampBounds({ minX: origin.x - 1200, minY: origin.y - 1200, maxX: origin.x + 1200, maxY: origin.y + 1200 });
        this.channel = supabase.channel(`peris-world-${playerId}`);
        const own = `owner_id=eq.${playerId}`;
        // No global subscription: a distant ruler's orders do not wake this client.
        for (const table of ['peris_account_science','peris_research_progress','peris_map_plots', 'settlements', 'armies', 'battle_formations', 'peris_orders', 'peris_reports', 'peris_heroes', 'peris_hero_artifacts', 'peris_settler_expeditions', 'peris_campaign_farm_lists', 'peris_campaign_farms', 'peris_garrisons', 'peris_city_garrisons', 'peris_city_reinforcements']) this.watch(table, own);
        this.watch('players', `id=eq.${playerId}`);
        if (town) this.watch('buildings', `settlement_id=eq.${town.id}`);
        for (const table of ['battles', 'peris_challenges']) {
            this.watch(table, `attacker_owner_id=eq.${playerId}`);
            this.watch(table, `defender_owner_id=eq.${playerId}`);
        }
        this.channel.subscribe(status => {
            if (!this.alive) return;
            const connected = status === 'SUBSCRIBED';
            if (this.connected !== connected) { this.connected = connected; this.publish(); }
        });
        this.authSubscription = supabase.auth.onAuthStateChange((event, session) => {
            if (!this.alive) return;
            if (event === 'SIGNED_OUT' || (session && session.user.id !== this.sessionId)) {
                // Auth callbacks run under the SDK lock. Recover outside it.
                window.clearTimeout(this.recoveryTimer);
                this.recoveryTimer = window.setTimeout(() => { this.recoveryTimer = undefined; void this.recoverAccount(); }, 0);
            }
        }).data.subscription;
        // Battle and queued-work cadences are preserved. Idle reads are slower;
        // viewport changes and confirmed player commands still refresh immediately.
        this.timer = window.setInterval(() => void this.tick(), 850);
        this.mapTimer = window.setInterval(() => void this.refreshMap(true), 5000);
        if (snapshot.map && !currentMap(snapshot.map)) { this.mapError = WORLD_UPGRADE; this.publish(); }
        else if (snapshot.map) void this.refreshMap();
    }
    subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
    rankings = (period: RankingPeriod) => readRankings(period, (fn,args) => this.rpc(fn,args));
    private watch(table: string, filter: string) {
        this.channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => {
            if (!this.alive || this.realtimeTimer !== undefined) return;
            this.realtimeTimer = window.setTimeout(() => { this.realtimeTimer = undefined; void this.refresh(false); }, 180);
        });
    }
    private async rpc(fn: string, args: Record<string, unknown> = {}) {
        if (this.reconnecting) await this.reconnecting;
        if (!this.alive) throw new Error('This realm session has ended.');
        const controller = new AbortController();
        this.requests.add(controller);
        try {
            const result = await supabase.rpc(fn, args).abortSignal(controller.signal);
            if (result.error && expiredSession(result.error)) void this.recoverAccount();
            return result;
        }
        finally { this.requests.delete(controller); }
    }
    private recoverAccount(): Promise<void> {
        if (this.reconnecting) return this.reconnecting;
        if (!this.alive) return Promise.resolve();
        const name = this.core.players.find(player => player.id === this.playerId)?.display_name;
        if (!name) return Promise.resolve();
        this.coreError = 'Reconnecting to your realm…'; this.publish();
        this.reconnecting = loginAccount(name).then(account => {
            if (!this.alive) return;
            if (account.ruler.player_id !== this.playerId) throw new Error('The server returned a different account. Re-enter your ruler name.');
            this.sessionId = account.sessionId;
            this.gameClock.accept(account.world);
            this.core = account.world; this.coreError = null;
            this.publish(); void this.refreshMap();
        }).catch(error => { if (this.alive) { this.coreError = this.message(error); this.publish(); } }).finally(() => { this.reconnecting = null; });
        return this.reconnecting;
    }
    private message(error: unknown) { return (error as { message?: string })?.message ?? 'Connection interrupted. Your realm is safe; reconnecting…'; }
    private pollMessage(error: unknown, failures: number, previous: string | null) {
        // Keep the last good snapshot while short lock conflicts clear through
        // the existing bounded backoff. Prolonged contention remains visible;
        // genuine failures and any warning already shown retain their visibility.
        if (isLockContention(error)) {
            if (previous && previous !== WORLD_BUSY) return previous;
            return failures < 3 ? previous : WORLD_BUSY;
        }
        return this.message(error);
    }
    private clampBounds(bounds: MapBounds): MapBounds {
        const axis = (low: number, high: number, min: number, max: number) => {
            if (high - low >= max - min) return [min, max];
            const center = (low + high) / 2, shift = wrapWorldPoint({ x: center, y: center }).x - center;
            return [Math.floor(low + shift), Math.ceil(high + shift)];
        };
        const [minX, maxX] = axis(Math.min(bounds.minX, bounds.maxX), Math.max(bounds.minX, bounds.maxX), WORLD_MIN_X, WORLD_MAX_X);
        const [minY, maxY] = axis(Math.min(bounds.minY, bounds.maxY), Math.max(bounds.minY, bounds.maxY), WORLD_MIN_Y, WORLD_MAX_Y);
        return { minX, minY, maxX, maxY };
    }
    setMapViewport = (bounds: MapBounds) => {
        if (!this.alive || !Object.values(bounds).every(Number.isFinite)) return;
        const next = this.clampBounds(bounds);
        if (next.minX >= next.maxX || next.minY >= next.maxY) return;
        if (next.minX === this.viewport.minX && next.minY === this.viewport.minY && next.maxX === this.viewport.maxX && next.maxY === this.viewport.maxY) return;
        this.viewport = next; this.mapRevision++;
        window.clearTimeout(this.mapDebounce);
        this.mapDebounce = window.setTimeout(() => { this.mapDebounce = undefined; void this.refreshMap(); }, 300);
    };
    private async refreshArmyCultures() {
        const battleIds = this.core.battles.filter(battle => battle.status === 'active')
            .map(battle => `${battle.id}:${battle.attacker_army_id}:${battle.defender_army_id}`).sort().join('|');
        // A newly encountered battle needs its actual cultures immediately;
        // the peaceful-map refresh interval must not launch the wrong 3D army.
        if (!this.alive || this.culturesBusy || !this.cultureBackoff.ready(Date.now()) || (battleIds === this.cultureBattleIds && Date.now() - this.culturesAt < 10000)) return;
        this.cultureBattleIds = battleIds;
        this.culturesBusy = true;
        const controller = new AbortController(); this.requests.add(controller);
        try {
            const world = { ...this.core, armies: [...this.core.armies, ...(this.publicMap?.armies ?? [])] };
            const cultures = await readArmyCultures(world, {
                armies: async ids => {
                    if (!ids.length) return [];
                    const { data, error } = await supabase.from('armies').select('id,owner_id,home_settlement_id').in('id', ids).abortSignal(controller.signal);
                    if (error) throw error; return data ?? [];
                },
                cities: async ids => {
                    if (!ids.length) return [];
                    const { data, error } = await supabase.from('settlements').select('id,faction').in('id', ids).abortSignal(controller.signal);
                    if (error) throw error; return data ?? [];
                },
            });
            if (this.alive) { this.cultureBackoff.reset();this.armyCultures = cultures; this.culturesAt = Date.now(); this.publish(); }
        } catch { this.cultureBackoff.fail(Date.now()); /* Cosmetic failures do not stop gameplay. */ }
        finally { this.requests.delete(controller); this.culturesBusy = false; }
    }
    private publish() {
        if (!this.alive) return;
        this.error = this.coreError ?? this.mapError;
        const publicMap = this.core.map ? this.publicMap : null;
        if (!publicMap) this.snapshot = { ...this.core };
        else {
            // Public DTOs intentionally omit a rival's economy. Zero-filled shape
            // fields are presentation placeholders and never replace own assets.
            const players: World['players'] = publicMap.players.filter(p => p.id !== this.playerId).map(p => ({ ...p, created_at: PUBLIC_DATE, prestige: 0, victories: 0, recruits: 0, upgrades: 0 }));
            const settlements: World['settlements'] = publicMap.settlements.filter(s => s.owner_id !== this.playerId).map(s => ({ ...s, wood: 0, stone: 0, food: 0, gold: 0, wood_rate: 0, stone_rate: 0, food_rate: 0, gold_rate: 0, capacity: 0, created_at: PUBLIC_DATE, resources_updated_at: PUBLIC_DATE }));
            const armies = publicMap.armies.filter(a => a.owner_id !== this.playerId);
            const merge = <T extends { id: number | string }>(remote: T[], core: T[]): T[] => [...new Map([...remote, ...core].map(item => [item.id, item])).values()];
            this.snapshot = {
                ...this.core,
                players: merge(players, this.core.players), settlements: merge(settlements, this.core.settlements), armies: merge(armies, this.core.armies),
                map_plots: [...new Map([...(publicMap.map_plots ?? []), ...(this.core.map_plots ?? [])].map(plot => [`${plot.col},${plot.row}`, plot])).values()],
                map: { ...this.core.map!, total_players: publicMap.total_players, total_settlements: publicMap.total_settlements, settlements_truncated: publicMap.settlements_truncated, armies_truncated: publicMap.armies_truncated, plots_truncated: publicMap.plots_truncated },
            };
        }
        this.snapshot = { ...this.snapshot,
            armies: this.snapshot.armies.map(army => ({ ...army, faction: this.armyCultures.get(army.id) ?? army.faction })),
            battles: this.snapshot.battles.map(battle => ({ ...battle,
                attacker_faction: battle.attacker_faction ?? this.armyCultures.get(battle.attacker_army_id),
                defender_faction: battle.defender_faction ?? (battle.defender_army_id === null ? undefined : this.armyCultures.get(battle.defender_army_id)),
            })),
        };
        this.listeners.forEach(fn => fn());
    }
    private async refreshMap(background = false) {
        if (!this.alive || !this.core.map) return;
        if (!currentMap(this.core.map)) { this.mapError = WORLD_UPGRADE; this.publish(); return; }
        const now=Date.now();
        if(!this.mapBackoff.ready(now))return;
        if(background&&now-this.lastMapPoll<(document.visibilityState==='hidden'?30000:15000))return;
        if (this.mapBusy) { if(!background)this.mapQueued = true; return; }
        this.mapBusy = true;
        this.lastMapPoll=now;
        const revision = this.mapRevision, bounds = { ...this.viewport };
        try {
            const { data, error } = await this.rpc('peris_map_snapshot', { p_min_x: bounds.minX, p_min_y: bounds.minY, p_max_x: bounds.maxX, p_max_y: bounds.maxY });
            if (error) throw error;
            this.mapBackoff.reset();
            if (this.alive && revision === this.mapRevision) {
                this.publicMap = data as PublicMapSnapshot;
                void this.refreshArmyCultures();
                this.mapError = null;
                this.publish();
            }
        } catch (e) {
            const failures = this.mapBackoff.fail(Date.now());
            if (this.alive && revision === this.mapRevision) {
                this.mapError = (e as { code?: string })?.code === 'PGRST202' ? WORLD_UPGRADE : this.pollMessage(e, failures, this.mapError);
                this.publish();
            }
        } finally {
            this.mapBusy = false;
            if (this.mapQueued && this.alive) { this.mapQueued = false; void this.refreshMap(); }
        }
    }
    async refresh(force = true) {
        if (!this.alive) return;
        if(!force&&!this.coreBackoff.ready(Date.now()))return;
        if (this.busy) { this.dirty = true;this.dirtyForced ||= force; return; }
        this.busy = true;
        try {
            const { data, error } = await this.rpc('peris_snapshot');
            if (error) throw error;
            if (this.alive) {
                const hadMap = !!this.core.map;
                const next = data as World;
                if (!next?.players?.some(player => player.id === this.playerId) || !next.settlements?.some(city => city.owner_id === this.playerId)) {
                    void this.recoverAccount();
                    return;
                }
                this.gameClock.accept(next);
                this.core = next;
                this.coreBackoff.reset();
                void this.refreshArmyCultures();

                this.coreError = null;
                this.publish();
                if (!hadMap && this.core.map) void this.refreshMap();
            }
        } catch (e) {
            const failures = this.coreBackoff.fail(Date.now());
            if (this.alive) { this.coreError = this.pollMessage(e, failures, this.coreError); this.publish(); }
        } finally {
            this.busy = false;
            if (this.dirty && this.alive) {
                const queuedForce=this.dirtyForced;this.dirty = false;this.dirtyForced=false;
                void this.refresh(queuedForce);
            }
        }
    }
    private async tick() {
        if (this.ticking || !this.alive) return;
        const battle = this.core.battles.find(b => b.status === 'active'), now = Date.now();
        if(!this.coreBackoff.ready(now)||now-this.lastCorePoll<statePollInterval(this.core,this.playerId,document.visibilityState==='hidden'))return;
        this.ticking = true; this.lastCorePoll = now;
        try {
            if (battle?.status === 'active') {
                const { error } = await this.rpc('peris_tick', { p_battle_id: battle.id });
                if (error) throw error;
            } else if (!battle) {
                const { error } = await this.rpc('sync_my_state');
                if (error) throw error;
            }
            if (this.alive) await this.refresh(false);
        } catch (e) {
            const failures = this.coreBackoff.fail(Date.now());
            if (this.alive) { this.coreError = this.pollMessage(e, failures, this.coreError); this.publish(); }
        } finally { this.ticking = false; }
    }
    reportPage = async (beforeId: number): Promise<Report[]> => {
        if (!this.alive) throw new Error('This realm session has ended.');
        const {data, error} = await this.rpc('peris_report_page', {p_before_id: beforeId});
        if (error) throw new Error(error.message);
        if (!Array.isArray(data)) throw new Error('Could not load report history.');
        return data.filter((report: Report) => report.owner_id === this.playerId);
    };
    command = async (cmd: Command) => {
        if (!this.alive) throw new Error('This realm session has ended.');
        // Read receipts are already idempotent and never replace a pending troop order.
        if (cmd.type === 'readReports' || cmd.type === 'readAllReports') {
            const {fn, args} = rpcCommand(cmd), {error} = await this.rpc(fn, args);
            if (error) throw new Error(error.message);
            await this.refresh(); return;
        }
        if(['order','rally','castSpell'].includes(cmd.type))throw new Error('Both armies and their spells are controlled automatically.');
        if (cmd.type === 'move' && (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y))) throw new Error('Choose valid world coordinates.');
        // An old server silently clamps marches to its 1,200px map. Reject before
        // sending the RPC, so installing this client cannot misdirect an army.
        let prepared = cmd;
        if (cmd.type === 'move') {
            prepared = { ...cmd };
            if (this.core.map ? !currentMap(this.core.map) : cmd.x < 45 || cmd.x > 1155 || cmd.y < 55 || cmd.y > 715) throw new Error(WORLD_UPGRADE);
            const target = wrapWorldPoint({ x: Math.round(cmd.x), y: Math.round(cmd.y) });
            if (!isWalkable(Math.floor(target.x / CELL_SIZE), Math.floor(target.y / CELL_SIZE))) throw new Error('Land armies cannot march across the sea.');
            if (currentMap(this.core.map)) {
                const army = this.core.armies.find(a => a.owner_id === this.playerId && (cmd.armyId===undefined||a.id===cmd.armyId));
                if (!army) throw new Error('Army not found.');
                                const route = findMarchPath(armyPosition(army, this.nowGameMs()), target);
                if (!route) throw new Error('No connected land route reaches this destination.');
                prepared = { ...cmd, ...target, route: route.path };
            }
        }
        if ((cmd.type === 'raid'||cmd.type==='raidCity') && currentMap(this.core.map)) {
            const army = this.core.armies.find(a => a.owner_id === this.playerId && (cmd.armyId === undefined || a.id === cmd.armyId));
            const camp = cmd.type==='raid'?this.core.camps.find(c => c.id === cmd.campId):this.snapshot.settlements.find(city=>city.id===cmd.targetCityId&&city.owner_id!==this.playerId);
            if (!army || !camp) throw new Error('Choose your army and a campaign camp.');
                        const route = findMarchPath(armyPosition(army, this.nowGameMs()), camp);
            if (!route) throw new Error('No connected land route reaches this camp.');
            prepared = { ...cmd, armyId: army.id, route: route.path };
        }
        if (cmd.type === 'startCampaignFarmList' && currentMap(this.core.map)) {
                        const clock = this.nowGameMs();
            const routes = (this.core.campaign_farms ?? [])
                .filter(target => target.owner_id === this.playerId && target.list_id === cmd.id)
                .flatMap(target => {
                    const army = this.core.armies.find(row => row.owner_id === this.playerId && row.id === target.army_id);
                    const camp = this.core.camps.find(row => row.id === target.camp_id);
                    if (!army || !camp) return [];
                    const route = findMarchPath(armyPosition(army, clock), camp);
                    return route ? [{ targetId: target.id, path: route.path }] : [];
                });
            // The server derives troops and destinations from saved targets and
            // validates each path. These routes only avoid a client/server sea detour.
            prepared = { ...cmd, routes };
        }
        if ((cmd.type === 'claimField' || cmd.type === 'buildField') && !currentMap(this.core.map)) throw new Error(WORLD_UPGRADE);
        if(cmd.type==='foundCity'){const city=this.core.settlements.find(s=>s.owner_id===this.playerId&&(cmd.settlementId===undefined||s.id===cmd.settlementId));if(!city)throw new Error('Choose your city.');const route=findMarchPath(city,{x:((cmd.col+100)%200+200)%200*128-12800+64,y:((cmd.row+100)%200+200)%200*128-12800+64});if(!route)throw new Error('No connected land route reaches this site.');prepared={...cmd,route:route.path};}
        const { fn, args } = rpcCommand(prepared);
        await this.mutations.send(fn, args);
        await this.refresh();
    };
    retryCommand = async () => {
        if (!this.alive) throw new Error('This realm session has ended.');
        await this.mutations.retry();
        await this.refresh();
    };
    destroy = () => {
        if (!this.alive) return;
        this.alive = false;
        this.authSubscription.unsubscribe();
        window.clearInterval(this.timer); window.clearInterval(this.mapTimer);
        window.clearTimeout(this.realtimeTimer); window.clearTimeout(this.mapDebounce); window.clearTimeout(this.recoveryTimer);
        this.requests.forEach(controller => controller.abort()); this.requests.clear();
        void supabase.removeChannel(this.channel); this.listeners.clear();
    };
}

export async function enterOnline(name: string, entry?: AccountEntry): Promise<OnlineEngine> {
    const account = await loginAccount(name, entry);
    const engine = new OnlineEngine(account.ruler.player_id, account.world, account.sessionId);
    rememberRuler(account.ruler.display_name);
    return engine;
}

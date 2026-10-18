import { readFile } from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { RESOURCES } from '../../src/shared/model/resources';
import { UNIT_TYPES as BASE_TYPES } from '../../src/features/army/domain/units';
import { FRONTIER_UNITS, FRONTIER_UNIT_TYPES as UNIT_TYPES, troopTotal as soldierTotal, trainingSeconds, isResearched, isFrontierUnit } from '../../src/features/frontier/domain/units';
import { isFaction } from '../../src/features/factions/domain/factions';
import { CELL_SIZE } from '../../src/features/map/domain/dimensions';
import { findMarchPath } from '../../src/features/map/domain/pathfinding';
import { DEFAULT_CONFIG, RAID_CANCEL_WINDOW_MS, emptyTroops, troopCost, carryingCapacity, travelTimeMs } from '../../src/features/frontier/domain/balance';
import { accrue, takeLoot } from '../../src/features/frontier/domain/economy';
import { createRealmCamps, recruitCamp } from '../../src/features/frontier/domain/camps';
import { resolveRaidCombat } from '../../src/features/frontier/domain/combat';
import type { FrontierConfig, FrontierCommand, FrontierSnapshot, FrontierCamp, Village, Raid, Training, Research, FarmTarget, FarmList, Position, Troops } from '../../src/features/frontier/domain/types';

type Query = Pick<Transaction, 'query'>;
type Combat = (...args: Parameters<typeof resolveRaidCombat>) => ReturnType<typeof resolveRaidCombat> | Promise<ReturnType<typeof resolveRaidCombat>>;
type Due = { kind: 'camp' | 'training' | 'research' | 'raid' | 'farm'; id: string; at: number };
export class RuleError extends Error {}
const point = (p: Position) => ({ x: (p.col + .5) * CELL_SIZE, y: (p.row + .5) * CELL_SIZE });
const clone = <T>(value: T): T => structuredClone(value);
const count = (rows: { count: number }[]) => Number(rows[0]?.count ?? 0);

/** One process owns this database. Commands and events share one transaction queue.
 * An event's due timestamp, not request time, determines production and chronology.
 * The browser never receives a database connection or chooses an owner ID.
 */
export class FrontierStore {
    readonly db: PGlite;
    config!: FrontierConfig;
    private sites: Position[] = [];
    private tail: Promise<unknown> = Promise.resolve();
    private routes = new Map<string, NonNullable<ReturnType<typeof findMarchPath>>>();
    constructor(dataDir?: string, private combat: Combat = resolveRaidCombat) {
        this.db = new PGlite(dataDir);
    }
    private serial<T>(action: () => Promise<T>): Promise<T> {
        const task = this.tail.then(action);
        this.tail = task.catch(() => undefined);
        return task;
    }
    async initialize(now = Date.now(), requestedConfig: FrontierConfig = DEFAULT_CONFIG) {
        await this.db.waitReady;
        await this.db.exec(await readFile(new URL('../../supabase/FRONTIER_LOCAL.sql', import.meta.url), 'utf8'));
        await this.db.transaction(async tx => {
            const realm = (await tx.query<{ config: FrontierConfig; village_sites: Position[] }>('select config, village_sites from frontier.realm')).rows[0];
            if (realm) { this.config = realm.config; this.sites = realm.village_sites; return; }
            const { camps, villageSites } = createRealmCamps(requestedConfig, now);
            this.config = clone(requestedConfig); this.sites = villageSites;
            for (const camp of camps) camp.nextRecruitAt = now + this.nextRecruitDelay();
            await tx.query('insert into frontier.realm(config, village_sites, created_at) values ($1,$2,$3)', [JSON.stringify(this.config), JSON.stringify(this.sites), now]);
            await tx.query(`insert into frontier.camps(id,col,row,at,data)
                select c->>'id',(c->>'col')::integer,(c->>'row')::integer,(c->>'nextRecruitAt')::double precision,c
                from jsonb_array_elements($1::jsonb) c`, [JSON.stringify(camps)]);
        });
    }
    // Real recruitment timing uses server entropy, independent of the public map seed.
    // Persist each deadline once; reads and restarts never resample pending events.
    private nextRecruitDelay() { return this.config.recruitMinMs + randomInt(this.config.recruitMaxMs - this.config.recruitMinMs + 1); }
    async close() { await this.serial(() => this.db.close()); }
    private async nextId(tx: Query) {
        return String((await tx.query<{ id: string }>("select nextval('frontier.ids')::text as id")).rows[0].id).padStart(14, '0');
    }
    private async village(tx: Query, id: string) {
        const value = (await tx.query<{ data: Village }>('select data from frontier.villages where id=$1 for update', [id])).rows[0]?.data;
        if (!value) throw new RuleError('Your village was not found.');
        return value;
    }
    private async camp(tx: Query, id: string) {
        const value = (await tx.query<{ data: FrontierCamp }>('select data from frontier.camps where id=$1 for update', [id])).rows[0]?.data;
        if (!value) throw new RuleError('Camp not found.');
        return value;
    }
    private async saveVillage(tx: Query, value: Village) {
        await tx.query('update frontier.villages set data=$2 where id=$1', [value.id, JSON.stringify(value)]);
    }
    private async saveCamp(tx: Query, value: FrontierCamp) {
        await tx.query('update frontier.camps set data=$2,at=$3 where id=$1', [value.id, JSON.stringify(value), value.nextRecruitAt]);
    }
    private async saveRaid(tx: Query, raid: Raid) {
        const at = raid.status === 'outbound' ? raid.arrivesAt : raid.status === 'returning' ? raid.returnsAt : null;
        await tx.query('update frontier.raids set data=$2,status=$3,at=$4 where id=$1', [raid.id, JSON.stringify(raid), raid.status, at]);
    }
    private async saveFarm(tx: Query, farm: FarmTarget) {
        await tx.query('update frontier.farms set data=$2,at=$3 where id=$1', [farm.id, JSON.stringify(farm), farm.nextRunAt]);
    }
    private async farmList(tx: Query, owner: string, id: string) {
        const list = (await tx.query<{ data: FarmList }>('select data from frontier.farm_lists where id=$1 and owner_id=$2 for update', [id, owner])).rows[0]?.data;
        if (!list) throw new RuleError('Farm list not found.');
        return list;
    }
    private async saveFarmList(tx: Query, list: FarmList) {
        await tx.query('insert into frontier.farm_lists(id,owner_id,data) values ($1,$2,$3) on conflict (id) do update set data=excluded.data', [list.id, list.ownerId, JSON.stringify(list)]);
    }
    async ownerForSession(tokenHash: string): Promise<string | null> {
        return this.serial(async () => (await this.db.query<{ owner_id: string }>('select owner_id from frontier.sessions where token_hash=$1', [tokenHash])).rows[0]?.owner_id ?? null);
    }
    async join(tokenHash: string, name: unknown, faction: unknown, now = Date.now()) {
        if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 24) throw new RuleError('Use a ruler name of 2–24 characters.');
        if (!isFaction(faction)) throw new RuleError('Choose one of the eleven factions.');
        return this.serial(() => this.db.transaction(async tx => {
            const previous = (await tx.query<{ owner_id: string }>('select owner_id from frontier.sessions where token_hash=$1', [tokenHash])).rows[0];
            if (previous) return previous.owner_id;
            const used = new Set((await tx.query<{ col: number; row: number }>('select col,row from frontier.villages')).rows.map(p => `${p.col},${p.row}`));
            const site = this.sites.find(p => !used.has(`${p.col},${p.row}`));
            if (!site) throw new RuleError('This development realm has no free village sites.');
            const village: Village = { id: randomUUID(), name: name.trim(), faction, ...site, troops: emptyTroops(), resources: clone(this.config.startingResources), producedAt: now };
            await tx.query('insert into frontier.villages(id,col,row,data) values ($1,$2,$3,$4)', [village.id, site.col, site.row, JSON.stringify(village)]);
            await tx.query('insert into frontier.sessions(token_hash,owner_id) values ($1,$2)', [tokenHash, village.id]);
            return village.id;
        }));
    }
    private validateTroops(value: unknown): asserts value is Troops {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RuleError('Choose a troop preset.');
        const t = value as Troops;
        if (BASE_TYPES.some(k => !Number.isSafeInteger(t[k]) || t[k] < 0) || Object.entries(t).some(([k, n]) => !isFrontierUnit(k) || !Number.isSafeInteger(n) || n < 0)) throw new RuleError('Troop counts must be nonnegative whole numbers.');
        if (!soldierTotal(t) || soldierTotal(t) > this.config.maxRaidTroops) throw new RuleError(`Send 1–${this.config.maxRaidTroops} troops per raid.`);
    }
    private route(village: Village, camp: FrontierCamp) {
        const key = `${village.id}:${camp.id}`;
        let route = this.routes.get(key);
        if (!route) {
            const found = findMarchPath(point(village), point(camp));
            if (!found) throw new RuleError('No connected land route reaches this camp.');
            route = found;
            // A bounded shared cache, not a timer or path search per travelling raid.
            if (this.routes.size >= 8192) this.routes.delete(this.routes.keys().next().value!);
            this.routes.set(key, route);
        }
        return route;
    }
    private async launch(tx: Query, owner: string, campId: string, troops: Troops, at: number, farm?: FarmTarget) {
        this.validateTroops(troops);
        const village = await this.village(tx, owner), camp = await this.camp(tx, campId);
        if (UNIT_TYPES.some(k => (troops[k] ?? 0) > (village.troops[k] ?? 0))) throw new RuleError('Not enough troops at home. Wait for training or returning raids.');
        if (count((await tx.query<{ count: number }>("select count(*)::int from frontier.raids where owner_id=$1 and status<>'complete'", [owner])).rows) >= this.config.maxActiveRaids) throw new RuleError('The active raid limit has been reached.');
        const route = this.route(village, camp), travelMs = travelTimeMs(route.distance, troops, this.config);
        const id = await this.nextId(tx), cancelUntil = at + RAID_CANCEL_WINDOW_MS;
        // Dispatch staging keeps even a nearby camp outside the cancellation window.
        // The persisted cutoff belongs to the original send, not the next request.
        const raid: Raid = { id, ownerId: owner, campId, campName: camp.name, troops: clone(troops), survivors: clone(troops), status: 'outbound', sentAt: at, cancelUntil, departedAt: cancelUntil, arrivesAt: cancelUntil + travelMs, returnsAt: cancelUntil + travelMs * 2, travelMs, distance: route.distance, path: route.path, report: null };
        if (farm) raid.farmListId = farm.listId;
        raid.campFaction = camp.faction;
        for (const k of UNIT_TYPES) if (troops[k]) village.troops[k] = (village.troops[k] ?? 0) - troops[k]!;
        await this.saveVillage(tx, village);
        await tx.query('insert into frontier.raids(id,owner_id,camp_id,status,at,data) values ($1,$2,$3,$4,$5,$6)', [id, owner, campId, raid.status, raid.arrivesAt, JSON.stringify(raid)]);
    }
    async command(owner: string, requestId: unknown, input: unknown, now = Date.now()) {
        if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) throw new RuleError('A valid request ID is required.');
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RuleError('A command is required.');
        return this.serial(async () => {
            await this.catchUp(now);
            await this.db.transaction(async tx => {
                // PostgreSQL JSON equality ignores object-key ordering on retries.
                const old = (await tx.query<{ same: boolean }>('select command=$3::jsonb as same from frontier.commands where owner_id=$1 and request_id=$2', [owner, requestId, JSON.stringify(input)])).rows[0];
                if (old) { if (!old.same) throw new RuleError('This request ID was already used for a different command.'); return; }
                const c = input as FrontierCommand;
                const village = await this.village(tx, owner);
                if (c.type === 'recruit') {
                    if (!UNIT_TYPES.includes(c.unit) || !Number.isSafeInteger(c.count) || c.count < 1 || c.count > 1000) throw new RuleError('Recruit 1–1,000 troops of a known type.');
                    if (!isResearched(village, c.unit)) throw new RuleError('Research this unit before recruiting it.');
                    const queue = (await tx.query<{ at: number; data: Training }>('select at,data from frontier.training where owner_id=$1 order by at desc', [owner])).rows;
                    if (queue.length >= 20) throw new RuleError('The training queue is full.');
                    const troops = emptyTroops(); troops[c.unit] = c.count;
                    const cost = troopCost(troops,1);
                    accrue(village, this.config.villageRates, this.config.villageCapacity, now);
                    if (RESOURCES.some(k => village.resources[k] < cost[k])) throw new RuleError('Not enough village resources.');
                    for (const k of RESOURCES) village.resources[k] -= cost[k];
                    const building = FRONTIER_UNITS[c.unit].building;
                    const last = queue.find(order => FRONTIER_UNITS[order.data.unit].building === building);
                    const order: Training = { id: await this.nextId(tx), ownerId: owner, unit: c.unit, count: c.count, completesAt: Math.max(now, last?.at ?? now) + trainingSeconds(c.unit, c.count) * 1000 };
                    await this.saveVillage(tx, village);
                    await tx.query('insert into frontier.training(id,owner_id,at,data) values ($1,$2,$3,$4)', [order.id, owner, order.completesAt, JSON.stringify(order)]);
                } else if (c.type === 'research') {
                    if (!isFrontierUnit(c.unit)) throw new RuleError('Choose a known unit to research.');
                    if (isResearched(village, c.unit)) throw new RuleError('This unit is already researched.');
                    const queue = (await tx.query<{ data: Research }>('select data from frontier.research where owner_id=$1 order by at desc', [owner])).rows.map(row => row.data);
                    if (queue.some(order => order.unit === c.unit)) throw new RuleError('This unit is already being researched.');
                    const rule = FRONTIER_UNITS[c.unit];
                    accrue(village, this.config.villageRates, this.config.villageCapacity, now);
                    if (RESOURCES.some(k => village.resources[k] < rule.researchCost[k])) throw new RuleError('Not enough village resources for research.');
                    for (const k of RESOURCES) village.resources[k] -= rule.researchCost[k];
                    const last = queue.find(order => FRONTIER_UNITS[order.unit].building === rule.building);
                    const order: Research = { id: await this.nextId(tx), ownerId: owner, unit: c.unit, completesAt: Math.max(now, last?.completesAt ?? now) + rule.researchSeconds * 1000 };
                    await this.saveVillage(tx, village);
                    await tx.query('insert into frontier.research(id,owner_id,unit,at,data) values ($1,$2,$3,$4,$5)', [order.id, owner, order.unit, order.completesAt, JSON.stringify(order)]);
                } else if (c.type === 'raid') {
                    if (typeof c.campId !== 'string') throw new RuleError('Choose a camp.');
                    await this.launch(tx, owner, c.campId, c.troops, now);
                } else if (c.type === 'cancelRaid') {
                    if (typeof c.id !== 'string' || !c.id || c.id.length > 80) throw new RuleError('Choose a raid to cancel.');
                    const raid = (await tx.query<{ data: Raid }>('select data from frontier.raids where id=$1 and owner_id=$2 for update', [c.id, owner])).rows[0]?.data;
                    if (!raid) throw new RuleError('Raid not found.');
                    if (raid.status !== 'outbound' || !Number.isFinite(raid.cancelUntil) || now >= raid.cancelUntil!) throw new RuleError('The thirty-second cancellation window has closed.');
                    for (const unit of UNIT_TYPES) if (raid.troops[unit]) village.troops[unit] = (village.troops[unit] ?? 0) + raid.troops[unit]!;
                    await this.saveVillage(tx, village);
                    // Removing the queued event and restoring reservations share this transaction.
                    // Its command receipt below makes network retries safe without a battle report.
                    await tx.query('delete from frontier.raids where id=$1 and owner_id=$2', [raid.id, owner]);
                } else if (c.type === 'saveFarm') {
                    this.validateTroops(c.troops);
                    if (typeof c.campId !== 'string' || typeof c.enabled !== 'boolean' || !Number.isSafeInteger(c.intervalMs) || c.intervalMs < this.config.farmMinimumMs || c.intervalMs > 86_400_000) throw new RuleError(`Repeat intervals must be between ${this.config.farmMinimumMs / 1000} seconds and one day.`);
                    this.route(village, await this.camp(tx, c.campId));
                    const existing = (await tx.query<{ data: FarmTarget }>('select data from frontier.farms where owner_id=$1 and camp_id=$2 for update', [owner, c.campId])).rows[0]?.data;
                    if (!existing && count((await tx.query<{ count: number }>('select count(*)::int from frontier.farms where owner_id=$1', [owner])).rows) >= this.config.maxFarmTargets) throw new RuleError('The farm list is full.');
                    const listId = c.listId ?? existing?.listId ?? `legacy-${owner}`;
                    if (typeof listId !== 'string') throw new RuleError('Choose a farm list.');
                    // Older clients can still save targets without supplying a list.
                    if (c.listId === undefined && !existing) await tx.query('insert into frontier.farm_lists(id,owner_id,data) values ($1,$2,$3) on conflict (id) do nothing', [listId, owner, JSON.stringify({ id: listId, ownerId: owner, name: 'Saved farms', casualtiesOnly: false, troops: { infantry: 1, archers: 0, cavalry: 0 } })]);
                    await this.farmList(tx, owner, listId);
                    const unchangedSchedule = existing?.enabled === c.enabled && existing.intervalMs === c.intervalMs;
                    const farm: FarmTarget = { id: existing?.id ?? await this.nextId(tx), ownerId: owner, campId: c.campId, troops: clone(c.troops), intervalMs: c.intervalMs, enabled: c.enabled, nextRunAt: unchangedSchedule ? existing.nextRunAt : c.enabled ? now + c.intervalMs : null, sent: existing?.sent ?? 0, skipped: existing?.skipped ?? 0, lastStatus: unchangedSchedule ? existing.lastStatus : c.enabled ? 'Scheduled' : 'Paused', listId };
                    await tx.query('insert into frontier.farms(id,owner_id,camp_id,at,data) values ($1,$2,$3,$4,$5) on conflict (owner_id,camp_id) do update set at=excluded.at,data=excluded.data', [farm.id, owner, c.campId, farm.nextRunAt, JSON.stringify(farm)]);
                } else if (c.type === 'startFarmList') {
                    if (typeof c.id !== 'string') throw new RuleError('Choose a farm list.');
                    await this.farmList(tx, owner, c.id);
                    // Created target order is deterministic and independent of browser sorting.
                    const farms = (await tx.query<{ data: FarmTarget }>("select data from frontier.farms where owner_id=$1 and data->>'listId'=$2 order by id for update", [owner, c.id])).rows.map(row => row.data);
                    for (const farm of farms) {
                        try { await this.launch(tx, owner, farm.campId, farm.troops, now, farm); farm.sent++; farm.lastStatus = 'Manual raid sent'; }
                        catch (error) { if (!(error instanceof RuleError)) throw error; farm.skipped++; farm.lastStatus = `Skipped: ${error.message}`; }
                        // Manual starts include paused targets but never change repeat deadlines.
                        await this.saveFarm(tx, farm);
                    }
                } else if (c.type === 'saveFarmList') {
                    if (typeof c.name !== 'string' || !c.name.trim() || c.name.trim().length > 40 || typeof c.casualtiesOnly !== 'boolean' || c.id !== undefined && (typeof c.id !== 'string' || !c.id)) throw new RuleError('Choose a list name of 1–40 characters and a report preference.');
                    const existing = c.id ? await this.farmList(tx, owner, c.id) : null;
                    if (!existing && count((await tx.query<{ count: number }>('select count(*)::int from frontier.farm_lists where owner_id=$1', [owner])).rows) >= this.config.maxFarmTargets) throw new RuleError('The farm list limit has been reached.');
                    const troops = c.troops === undefined ? existing?.troops ?? { infantry: 1, archers: 0, cavalry: 0 } : c.troops;
                    this.validateTroops(troops);
                    await this.saveFarmList(tx, { id: c.id ?? await this.nextId(tx), ownerId: owner, name: c.name.trim(), casualtiesOnly: c.casualtiesOnly, troops: clone(troops) });
                } else if (c.type === 'applyFarmListTroops') {
                    if (typeof c.id !== 'string') throw new RuleError('Choose a farm list.');
                    const list = await this.farmList(tx, owner, c.id);
                    this.validateTroops(list.troops);
                    const farms = (await tx.query<{ data: FarmTarget }>("select data from frontier.farms where owner_id=$1 and data->>'listId'=$2 for update", [owner, c.id])).rows;
                    for (const { data: farm } of farms) {
                        farm.troops = clone(list.troops);
                        await this.saveFarm(tx, farm);
                    }
                } else if (c.type === 'setFarmListReports') {
                    if (typeof c.id !== 'string' || typeof c.casualtiesOnly !== 'boolean') throw new RuleError('Choose a farm list and report preference.');
                    const list = await this.farmList(tx, owner, c.id);
                    list.casualtiesOnly = c.casualtiesOnly;
                    // Report preferences must not postpone any departure.
                    await this.saveFarmList(tx, list);
                } else if (c.type === 'setFarmListEnabled') {
                    if (typeof c.id !== 'string' || typeof c.enabled !== 'boolean') throw new RuleError('Choose a farm list and schedule setting.');
                    await this.farmList(tx, owner, c.id);
                    const farms = (await tx.query<{ data: FarmTarget }>("select data from frontier.farms where owner_id=$1 and data->>'listId'=$2 for update", [owner, c.id])).rows;
                    for (const { data: farm } of farms) {
                        if (farm.enabled === c.enabled) continue;
                        farm.enabled = c.enabled; farm.nextRunAt = c.enabled ? now + farm.intervalMs : null;
                        farm.lastStatus = c.enabled ? 'Scheduled' : 'Paused';
                        await this.saveFarm(tx, farm);
                    }
                } else if (c.type === 'deleteFarmList') {
                    if (typeof c.id !== 'string') throw new RuleError('Choose a farm list.');
                    await this.farmList(tx, owner, c.id);
                    if (count((await tx.query<{ count: number }>("select count(*)::int from frontier.farms where owner_id=$1 and data->>'listId'=$2", [owner, c.id])).rows)) throw new RuleError('Remove or move the targets before deleting this list.');
                    await tx.query('delete from frontier.farm_lists where id=$1 and owner_id=$2', [c.id, owner]);
                } else if (c.type === 'manageFarmTargets') {
                    if (!Array.isArray(c.ids) || !c.ids.length || c.ids.length > this.config.maxFarmTargets || c.ids.some(id => typeof id !== 'string') || new Set(c.ids).size !== c.ids.length || !['move', 'delete'].includes(c.action)) throw new RuleError('Choose saved targets and a valid action.');
                    const farms = (await tx.query<{ data: FarmTarget }>('select data from frontier.farms where owner_id=$1 and id=any($2) for update', [owner, c.ids])).rows;
                    if (farms.length !== c.ids.length) throw new RuleError('One or more targets are no longer in your farm lists.');
                    if (c.action === 'move') {
                        if (typeof c.listId !== 'string') throw new RuleError('Choose a destination list.');
                        await this.farmList(tx, owner, c.listId);
                        for (const { data: farm } of farms) {
                            farm.listId = c.listId;
                            await this.saveFarm(tx, farm);
                        }
                    } else await tx.query('delete from frontier.farms where owner_id=$1 and id=any($2)', [owner, c.ids]);
                } else if (c.type === 'deleteFarm') {
                    if (typeof c.id !== 'string') throw new RuleError('Choose a saved target.');
                    await tx.query('delete from frontier.farms where id=$1 and owner_id=$2', [c.id, owner]);
                } else throw new RuleError('Unknown command.');
                await tx.query('insert into frontier.commands(owner_id,request_id,command) values ($1,$2,$3)', [owner, requestId, JSON.stringify(input)]);
            });
        });
    }
    private async nextDue(tx: Query, until: number): Promise<Due | undefined> {
        return (await tx.query<Due>(`select kind,id,at from (
            (select 'camp' as kind,id,at,2 as priority from frontier.camps where at<=$1 order by at,id limit 1)
            union all (select 'training',id,at,0 from frontier.training where at<=$1 order by at,id limit 1)
            union all (select 'research',id,at,-1 from frontier.research where at<=$1 order by at,id limit 1)
            union all (select 'raid',id,at,case when status='returning' then 1 else 3 end from frontier.raids where at<=$1 order by at,case when status='returning' then 1 else 3 end,id limit 1)
            union all (select 'farm',id,at,4 from frontier.farms where at<=$1 order by at,id limit 1)
            ) pending order by at,priority,id limit 1`, [until])).rows[0];
    }
    private async event(tx: Query, due: Due) {
        const at = due.at;
        if (due.kind === 'camp') {
            const camp = await this.camp(tx, due.id);
            recruitCamp(camp, this.config, at);
            if (camp.nextRecruitAt !== null) camp.nextRecruitAt = at + this.nextRecruitDelay();
            await this.saveCamp(tx, camp);
        } else if (due.kind === 'research') {
            const order = (await tx.query<{ data: Research }>('select data from frontier.research where id=$1 for update', [due.id])).rows[0].data;
            const village = await this.village(tx, order.ownerId);
            village.researched = [...new Set([...(village.researched ?? []), order.unit])];
            await this.saveVillage(tx, village);
            await tx.query('delete from frontier.research where id=$1', [order.id]);
        } else if (due.kind === 'training') {
            const order = (await tx.query<{ data: Training }>('select data from frontier.training where id=$1 for update', [due.id])).rows[0].data;
            const village = await this.village(tx, order.ownerId);
            village.troops[order.unit] = (village.troops[order.unit] ?? 0) + order.count;
            await this.saveVillage(tx, village);
            await tx.query('delete from frontier.training where id=$1', [order.id]);
        } else if (due.kind === 'farm') {
            const farm = (await tx.query<{ data: FarmTarget }>('select data from frontier.farms where id=$1 for update', [due.id])).rows[0].data;
            try { await this.launch(tx, farm.ownerId, farm.campId, farm.troops, at, farm); farm.sent++; farm.lastStatus = 'Raid sent'; }
            catch (error) { if (!(error instanceof RuleError)) throw error; farm.skipped++; farm.lastStatus = `Skipped: ${error.message}`; }
            farm.nextRunAt = at + farm.intervalMs;
            await this.saveFarm(tx, farm);
        } else {
            const raid = (await tx.query<{ data: Raid }>('select data from frontier.raids where id=$1 for update', [due.id])).rows[0].data;
            if (raid.status === 'outbound') {
                const camp = await this.camp(tx, raid.campId), rules = this.config.tiers[camp.tier];
                accrue(camp, rules.rates, rules.capacity, at);
                const outcome = await this.combat(raid.troops, camp.defenders, camp, camp.tier);
                const losses = emptyTroops(), defenderLosses = emptyTroops();
                for (const k of UNIT_TYPES) {
                    if (k in raid.troops) losses[k] = (raid.troops[k] ?? 0) - (outcome.survivors[k] ?? 0);
                    if (k in camp.defenders) defenderLosses[k] = (camp.defenders[k] ?? 0) - (outcome.defenders[k] ?? 0);
                }
                raid.survivors = outcome.survivors; camp.defenders = outcome.defenders;
                const capacity = carryingCapacity(raid.survivors, this.config);
                const loot = takeLoot(camp.resources, outcome.winner === 'attacker' ? capacity : 0), replacementCost = troopCost(losses,1);
                for (const k of RESOURCES) camp.resources[k] -= loot[k];
                const estimatedProfit = Object.fromEntries(RESOURCES.map(k => [k, loot[k] - replacementCost[k]])) as typeof loot;
                raid.report = { winner: outcome.winner, losses, defenderLosses, loot, replacementCost, estimatedProfit, capacity, battleSeconds: outcome.battleSeconds, reason: outcome.reason };
                if (camp.nextRecruitAt === null && soldierTotal(camp.defenders) < rules.defenderCap) camp.nextRecruitAt = at + this.nextRecruitDelay();
                raid.status = 'returning';
                await this.saveCamp(tx, camp);
                await this.saveRaid(tx, raid);
            } else if (raid.status === 'returning') {
                const village = await this.village(tx, raid.ownerId), report = raid.report!;
                accrue(village, this.config.villageRates, this.config.villageCapacity, at);
                for (const k of UNIT_TYPES) if (raid.survivors[k]) village.troops[k] = (village.troops[k] ?? 0) + raid.survivors[k]!;
                report.delivered = { wood: 0, stone: 0, food: 0, gold: 0 };
                report.overflow = { wood: 0, stone: 0, food: 0, gold: 0 };
                for (const k of RESOURCES) {
                    report.delivered[k] = Math.min(report.loot[k], Math.max(0, this.config.villageCapacity[k] - village.resources[k]));
                    report.overflow[k] = report.loot[k] - report.delivered[k];
                    village.resources[k] += report.delivered[k];
                    report.estimatedProfit[k] = report.delivered[k] - report.replacementCost[k];
                }
                raid.status = 'complete';
                await this.saveVillage(tx, village);
                await this.saveRaid(tx, raid);
            }
        }
    }
    private async batch(until: number, limit: number) {
        let processed = 0;
        await this.db.transaction(async tx => {
            while (processed < limit) {
                const due = await this.nextDue(tx, until);
                if (!due) break;
                await this.event(tx, due); processed++;
            }
        });
        return processed;
    }
    private async catchUp(until: number) {
        // Bound request work during large backlogs; the independent worker keeps draining.
        // Nothing new may be scheduled ahead of unprocessed historical events.
        for (let n = 0; n < 64; n++) {
            if (await this.batch(until, 16) < 16) return;
            await setImmediate();
        }
        if (await this.nextDue(this.db, until)) throw new RuleError('The realm is catching up after downtime. Please retry shortly.');
    }
    async advance(until = Date.now(), limit = 16) {
        return this.serial(() => this.batch(until, limit));
    }
    async snapshot(owner: string, now = Date.now()): Promise<FrontierSnapshot> {
        return this.serial(async () => {
            await this.catchUp(now);
            return this.db.transaction(async tx => {
                const village = await this.village(tx, owner);
                accrue(village, this.config.villageRates, this.config.villageCapacity, now);
                // Read projections never move persisted production timestamps forward.
                // This makes reads frequency-independent and preserves historical catch-up.
                const nearest = (await tx.query<{ data: FrontierCamp }>(`select data from frontier.camps order by
                    power(least(abs(col-$1),200-abs(col-$1)),2)+power(least(abs(row-$2),200-abs(row-$2)),2),id limit 120`, [village.col, village.row])).rows;
                const farms = (await tx.query<{ data: FarmTarget }>('select data from frontier.farms where owner_id=$1 order by id', [owner])).rows.map(r => r.data);
                const missingIds = farms.map(f => f.campId).filter(id => !nearest.some(c => c.data.id === id));
                if (missingIds.length) nearest.push(...(await tx.query<{ data: FrontierCamp }>('select data from frontier.camps where id=any($1)', [missingIds])).rows);
                const camps = nearest.map(({ data: camp }) => {
                    const rules = this.config.tiers[camp.tier]; accrue(camp, rules.rates, rules.capacity, now);
                    let distance: number | null = null;
                    try { distance = this.route(village, camp).distance; } catch (error) { if (!(error instanceof RuleError)) throw error; }
                    const { nextRecruitAt, recruitSequence, ...publicCamp } = camp;
                    return { ...publicCamp, distance };
                }).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.id.localeCompare(b.id));
                const rows = async <T>(sql: string) => (await tx.query<{ data: T }>(sql, [owner])).rows.map(r => r.data);
                // Keep every receipt. Filter before pagination using the originating list;
                // moving/removing a target never changes that historical association.
                // Manual and pre-feature raids, and deleted lists, remain visible.
                const reportSource = `from frontier.raids r left join frontier.farm_lists f
                    on f.id=r.data->>'farmListId' and f.owner_id=r.owner_id
                    where r.owner_id=$1 and r.status='complete'`;
                const visibleReport = `(not coalesce((f.data->>'casualtiesOnly')::boolean, false)
                    or exists (select 1 from jsonb_each_text(r.data#>'{report,losses}') loss where loss.value::integer>0))`;
                const reportCounts = (await tx.query<{ visible: number; total: number }>(`select count(*)::int as total,
                    count(*) filter (where ${visibleReport})::int as visible ${reportSource}`, [owner])).rows[0];
                const { seed, recruitMinMs, recruitMaxMs, ...publicConfig } = this.config;
                return {
                    now, config: clone(publicConfig), village, camps,
                    campCount: count((await tx.query<{ count: number }>('select count(*)::int from frontier.camps')).rows),
                    raids: await rows<Raid>("select data from frontier.raids where owner_id=$1 and status<>'complete' order by at,id"),
                    training: await rows<Training>('select data from frontier.training where owner_id=$1 order by at,id'), farms,
                    research: await rows<Research>('select data from frontier.research where owner_id=$1 order by at,id'),
                    farmLists: await rows<FarmList>('select data from frontier.farm_lists where owner_id=$1 order by id'),
                    farmStats: (await tx.query<{ data: FrontierSnapshot['farmStats'][number] }>(`with results as (
                        select r.data, r.camp_id,
                          (select coalesce(sum(value::numeric),0) from jsonb_each_text(coalesce(r.data#>'{report,delivered}',r.data#>'{report,loot}'))) as loot,
                          row_number() over (partition by r.camp_id order by (r.data->>'returnsAt')::double precision desc,r.id desc) as rank
                        from frontier.raids r where r.owner_id=$1 and r.status='complete'
                          and exists (select 1 from frontier.farms f where f.owner_id=$1 and f.camp_id=r.camp_id)
                    ), totals as (select camp_id,sum(loot) as loot from results group by camp_id)
                    select jsonb_build_object('campId',r.camp_id,'lastRaidAt',(r.data->>'returnsAt')::double precision,
                        'lastLoot',r.loot,'totalLoot',t.loot,'result',r.data#>>'{report,winner}',
                        'losses',(select coalesce(sum(value::integer),0) from jsonb_each_text(r.data#>'{report,losses}'))) as data
                    from results r join totals t using (camp_id) where r.rank=1`, [owner])).rows.map(r => r.data),
                    reports: await rows<Raid>(`select r.data ${reportSource} and ${visibleReport} order by (r.data->>'returnsAt')::double precision desc,r.id desc limit 50`),
                    reportCount: reportCounts.visible, hiddenReportCount: reportCounts.total - reportCounts.visible,
                };
            });
        });
    }
}

import { FACTIONS, type Faction } from '../../factions/domain/factions';
import { CAMPS } from '../../map/domain/camps';
import { BANDIT_CAMPS } from '../../map/domain/bandits';
import { CELL_SIZE, WORLD_COLS, WORLD_ROWS, wrapWorldCell, wrappedCellDistance } from '../../map/domain/dimensions';
import { cellCenter, isHistoricStartingField, isWalkable } from '../../map/domain/worldGrid';
import { findMarchPath } from '../../map/domain/pathfinding';
import { UNIT_TYPES } from '../../army/domain/units';
import { seeded } from '../../../shared/math/random';
import { emptyResources } from '../../../shared/model/resources';
import { emptyTroops } from './balance';
import type { CampTier, FrontierCamp, FrontierConfig, Position, Troops } from './types';

const TIERS: CampTier[] = ['low', 'medium', 'hard'];
const factions = Object.keys(FACTIONS) as Faction[];
const key = ({ col, row }: Position) => `${col},${row}`;
const legacyCells = new Set([...CAMPS, ...BANDIT_CAMPS].map(camp => key(wrapWorldCell(Math.floor(camp.x / CELL_SIZE), Math.floor(camp.y / CELL_SIZE)))));

function hash(text: string) {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return value >>> 0;
}

/** The persisted sequence is the only advancing input to recruitment randomness. */
export function recruitDelay(config: FrontierConfig, campId: string, sequence: number): number {
    if (!Number.isSafeInteger(config.recruitMinMs) || !Number.isSafeInteger(config.recruitMaxMs) || config.recruitMinMs < 1 || config.recruitMaxMs < config.recruitMinMs)
        throw new Error('Camp recruitment needs a valid positive interval.');
    const random = seeded(config.seed ^ hash(campId) ^ Math.imul(sequence + 1, 7919));
    return config.recruitMinMs + Math.floor(random() * (config.recruitMaxMs - config.recruitMinMs + 1));
}

function ring(position: Position): Position[] {
    const cells: Position[] = [];
    for (let row = -1; row <= 1; row++) for (let col = -1; col <= 1; col++) cells.push(wrapWorldCell(position.col + col, position.row + row));
    return cells;
}

/** A new realm never places its villages or camps over legacy protected land. */
export function createRealmCamps(config: FrontierConfig, now: number): { camps: FrontierCamp[]; villageSites: Position[] } {
    if (!Number.isFinite(now)) throw new Error('A realm needs a valid creation time.');
    for (const tier of TIERS) if (!Number.isSafeInteger(config.campCounts[tier]) || config.campCounts[tier] < 0) throw new Error('Camp counts must be nonnegative whole numbers.');
    const random = seeded(config.seed), candidates: (Position & { order: number })[] = [];
    const eligible = (position: Position) => !legacyCells.has(key(position)) && !isHistoricStartingField(position.col, position.row) && isWalkable(position.col, position.row);
    for (let row = -WORLD_ROWS / 2; row < WORLD_ROWS / 2; row++) for (let col = -WORLD_COLS / 2; col < WORLD_COLS / 2; col++) {
        const position = { col, row };
        if (eligible(position)) candidates.push({ ...position, order: random() });
    }
    const villageCandidates = candidates.filter(position => ring(position).every(eligible));
    villageCandidates.sort((a, b) => wrappedCellDistance(a, { col: 0, row: 0 }) - wrappedCellDistance(b, { col: 0, row: 0 }) || a.order - b.order);
    const reserved = new Set<string>(), villageSites: Position[] = [];
    const reserveVillage = (position: Position) => {
        const cells = ring(position);
        if (cells.some(cell => reserved.has(key(cell)))) return;
        villageSites.push({ col: position.col, row: position.row });
        cells.forEach(cell => reserved.add(key(cell)));
    };
    if (villageCandidates[0]) reserveVillage(villageCandidates[0]);
    if (config.fixture === 'development' && villageSites[0]) villageCandidates.sort((a, b) => wrappedCellDistance(a, villageSites[0]) - wrappedCellDistance(b, villageSites[0]) || a.order - b.order);
    else villageCandidates.sort((a, b) => a.order - b.order);
    const siteCount = config.fixture === 'development' ? 32 : 256;
    for (const candidate of villageCandidates) {
        if (villageSites.length >= siteCount) break;
        reserveVillage(candidate);
    }
    if (villageSites.length !== siteCount) throw new Error('Not enough safe village sites exist for this realm.');
    const available = candidates.filter(position => !reserved.has(key(position)));
    if (config.fixture === 'development') available.sort((a, b) => wrappedCellDistance(a, villageSites[0]) - wrappedCellDistance(b, villageSites[0]) || a.order - b.order);
    else available.sort((a, b) => a.order - b.order);
    const total = TIERS.reduce((sum, tier) => sum + config.campCounts[tier], 0);
    if (total > available.length) throw new Error('Not enough unoccupied dry fields exist for the requested camps.');
    const positions: Position[] = [];
    for (const candidate of available) {
        if (positions.length >= total) break;
        if (config.fixture === 'development' && !findMarchPath(cellCenter(villageSites[0].col, villageSites[0].row), cellCenter(candidate.col, candidate.row))) continue;
        positions.push(candidate);
    }
    if (positions.length !== total) throw new Error('Not enough reachable camp fields exist for the development realm.');
    let cursor = 0;
    const camps = TIERS.flatMap(tier => Array.from({ length: config.campCounts[tier] }, () => {
        const { col, row } = positions[cursor++], id = `frontier-camp-${col + WORLD_COLS / 2}-${row + WORLD_ROWS / 2}`;
        const faction = factions[Math.floor(seeded(config.seed ^ hash(id))() * factions.length)];
        return { id, col, row, tier, faction, name: `${FACTIONS[faction].name} ${tier === 'low' ? 'outpost' : tier === 'medium' ? 'warband' : 'stronghold'}`,
            defenders: emptyTroops(), resources: emptyResources(), producedAt: now, recruitSequence: 0, nextRecruitAt: now + recruitDelay(config, id, 0) } satisfies FrontierCamp;
    }));
    return { camps, villageSites };
}

/** Process one scheduled batch. At the cap recruitment pauses until raid losses. */
export function recruitCamp(camp: FrontierCamp, config: FrontierConfig, at: number): Troops {
    if (!Number.isFinite(at)) throw new Error('Camp recruitment needs a valid event time.');
    const added = emptyTroops(), due = camp.nextRecruitAt;
    if (due === null || at < due) return added;
    const profile = config.tiers[camp.tier], count = UNIT_TYPES.reduce((sum, unit) => sum + camp.defenders[unit], 0);
    const random = seeded(config.seed ^ hash(camp.id) ^ Math.imul(camp.recruitSequence + 1, 104729));
    const batch = Math.min(Math.max(0, profile.defenderCap - count), profile.batchMin + Math.floor(random() * (profile.batchMax - profile.batchMin + 1)));
    const weight = UNIT_TYPES.reduce((sum, unit) => sum + profile.weights[unit], 0);
    if (!(weight > 0) || profile.batchMin < 1 || profile.batchMax < profile.batchMin) throw new Error('Camp recruitment needs a valid batch and troop weights.');
    for (let i = 0; i < batch; i++) {
        let roll = random() * weight;
        for (const unit of UNIT_TYPES) {
            roll -= profile.weights[unit];
            if (roll < 0) { camp.defenders[unit]++; added[unit]++; break; }
        }
    }
    camp.recruitSequence++;
    camp.nextRecruitAt = count + batch >= profile.defenderCap ? null : due + recruitDelay(config, camp.id, camp.recruitSequence);
    return added;
}

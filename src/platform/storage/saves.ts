import { SAVE_KEY, readSolo } from './solo';
import { type World } from '../../shared/model/world';
import { CELL_SIZE } from '../../features/map/domain/dimensions';
import { isWalkable, isLegacyWalkable } from '../../features/map/domain/worldGrid';
// v6 campaigns predate the 200-field map. Keep every legacy position and route
// unchanged on import/export; new movement remains bounded by current geography.
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
export function validateSave(data: unknown): World {
    const w = data as World, invalid = () => { throw new Error('This file is not a valid Peris campaign save.'); };
    if (!w || w.version !== 6 || !Array.isArray(w.players) || w.players.length !== 1 || w.players[0].id !== 'solo-ruler')
        invalid();
    for (const key of ['settlements', 'armies', 'buildings', 'camps', 'orders', 'battles', 'formations', 'reports', 'progress', 'claims', 'challenges'] as const)
        if (!Array.isArray(w[key]) || w[key].length > 15000 || w[key].some(row => !row || typeof row !== 'object'))
            invalid();
    if (w.settlements.length !== 1 || w.armies.length !== 1 || w.buildings.length !== 8 || w.camps.length !== 6)
        invalid();
    const town = w.settlements[0], army = w.armies[0], player = w.players[0];
    if (town.owner_id !== 'solo-ruler' || army.owner_id !== 'solo-ruler' || typeof player.display_name !== 'string' || !player.display_name.trim() || typeof town.name !== 'string')
        invalid();
    for (const n of [town.wood, town.stone, town.food, town.gold, town.capacity, town.wood_rate, town.stone_rate, town.food_rate, town.gold_rate, army.infantry, army.archers, army.cavalry, player.prestige, player.victories, player.recruits, player.upgrades])
        if (!Number.isFinite(n) || n < 0 || n > 1e12)
            invalid();
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
    if (army.march_path != null) {
        const route = army.march_path;
        if (!Array.isArray(route) || route.length < 2 || route.length > 2000)
            invalid();
        let distance = 0, currentLand = true, legacyLand = true;
        for (let i = 0; i < route.length; i++) {
            const point = route[i];
            if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < SAVE_MIN || point[0] >= SAVE_MAX || point[1] < SAVE_MIN || point[1] >= SAVE_MAX)
                invalid();
            const col = Math.floor(point[0] / CELL_SIZE), row = Math.floor(point[1] / CELL_SIZE);
            currentLand = currentLand && isWalkable(col, row);
            legacyLand = legacyLand && isLegacyWalkable(col, row);
            if (i) {
                const previous = route[i - 1], oldCol = Math.floor(previous[0] / CELL_SIZE), oldRow = Math.floor(previous[1] / CELL_SIZE);
                const segment = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
                if (Math.abs(col - oldCol) > 1 || Math.abs(row - oldRow) > 1 || segment === 0 && route.length > 2)
                    invalid();
                if (col !== oldCol && row !== oldRow) {
                    currentLand = currentLand && isWalkable(col, oldRow) && isWalkable(oldCol, row);
                    legacyLand = legacyLand && isLegacyWalkable(col, oldRow) && isLegacyWalkable(oldCol, row);
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
        if (!['lumber', 'quarry', 'farm', 'market', 'barracks', 'stables', 'wall', 'storehouse'].includes(b.building_type) || !Number.isInteger(b.level) || b.level < 1 || b.level > 20)
            invalid();
    if (new Set(w.buildings.map(b => b.building_type)).size !== 8)
        invalid();
    for (const date of [town.resources_updated_at, army.departure_at, army.arrival_at, player.created_at])
        if (!Number.isFinite(Date.parse(date)))
            invalid();
    if (w.orders.filter(o => o.kind === 'upgrade').length > 1 || w.orders.filter(o => o.kind === 'recruit').length > 3)
        invalid();
    for (const o of w.orders)
        if (!['upgrade', 'recruit'].includes(o.kind) || o.owner_id !== 'solo-ruler' || !(o.kind === 'upgrade' ? ['lumber', 'quarry', 'farm', 'market', 'barracks', 'stables', 'wall', 'storehouse'] : ['infantry', 'archers', 'cavalry']).includes(o.item) || !Number.isFinite(Date.parse(o.finish_at)) || !Number.isFinite(Date.parse(o.started_at)) || Date.parse(o.finish_at) < Date.parse(o.started_at) || !Number.isInteger(o.quantity) || o.quantity < 1 || o.quantity > 200)
            invalid();
    if (army.infantry + army.archers + army.cavalry + w.orders.filter(o => o.kind === 'recruit').reduce((n, o) => n + o.quantity, 0) > 1000)
        invalid();
    for (const f of w.formations)
        if (!['infantry', 'archers', 'cavalry'].includes(f.unit_type) || !['idle', 'moving', 'engaged', 'routed'].includes(f.status) || [f.x, f.y, f.soldiers, f.morale, f.stamina, f.facing, f.columns].some(n => !Number.isFinite(n)) || f.soldiers < 0 || f.soldiers > 1000)
            invalid();
    if (w.battles.filter(b => b.status === 'active').length > 1 || w.battles.some(b => !['active', 'resolved'].includes(b.status) || !['deployment', 'combat', 'finished'].includes(b.phase) || !['plains', 'woods', 'highlands', 'river'].includes(b.terrain)))
        invalid();
    const active = w.battles.find(b => b.status === 'active');
    if (active && (!w.formations.some(f => f.battle_id === active.id) || !Number.isFinite(active.elapsed) || active.elapsed < 0 || !['pve', 'practice'].includes(active.mode)))
        invalid();
    return structuredClone(w);
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

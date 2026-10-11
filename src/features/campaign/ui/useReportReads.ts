import { useCallback, useEffect, useRef } from 'react';
import type { GameEngine } from '../../../engine/contracts';
import type { World } from '../../../shared/model/world';
import { readReportIds, storeReadReportIds } from '../../../platform/storage/reports';

/** Authoritative receipts work from Chronicle, map details and Rally Point. */
export function useReportReads(engine: GameEngine, world: World, openedBattle: number | null, onError: () => void) {
    const ruler = world.players.find(player => player.id === engine.playerId)!;
    const key = `peris-read-reports:${engine.mode}:${ruler.id}:${ruler.created_at}`;
    const errors = useRef(onError); errors.current = onError;
    const latest = useRef(world); latest.current = world;
    const pending = useRef(new Set<string>());
    const markReportRead = useCallback((battleId: number) => {
        if (engine.mode === 'practice') return;
        const report = latest.current.reports.find(row => row.owner_id === engine.playerId && row.battle_id === battleId);
        if (!report || report.read_at) return;
        const receipt = `${key}:${report.id}`;
        if (pending.current.has(receipt)) return;
        pending.current.add(receipt);
        void engine.command({ type: 'readReports', reportIds: [report.id] }).then(() => {
            const old = readReportIds(key); old.add(battleId); storeReadReportIds(key, old);
        }).catch(() => errors.current()).finally(() => pending.current.delete(receipt));
    }, [engine, key]);
    useEffect(() => {
        if (engine.mode === 'practice') return;
        const old = readReportIds(key);
        const ids = latest.current.reports.filter(report => report.owner_id === engine.playerId && !report.read_at && old.has(report.battle_id)).map(report => report.id);
        if (ids.length) void (async () => {
            for (let start = 0; start < ids.length; start += 50)
                await engine.command({ type: 'readReports', reportIds: ids.slice(start, start + 50) });
        })().catch(() => errors.current());
    }, [engine, key]);
    useEffect(() => { if (openedBattle != null) markReportRead(openedBattle); }, [openedBattle, markReportRead]);
    return markReportRead;
}

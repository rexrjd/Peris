import { useCallback, useEffect, useRef } from 'react';
import type { GameEngine } from '../../../engine/contracts';
import type { World } from '../../../shared/model/world';
import { readReportIds, storeReadReportIds } from '../../../platform/storage/reports';

/** Read metadata is acknowledged before the inbox changes its unread state. */
export function useReportReads(engine: GameEngine, world: World, openedBattle: number | null, onError: () => void) {
    const ruler = world.players.find(player => player.id === engine.playerId)!;
    const key = `peris-read-reports:${engine.mode}:${ruler.id}:${ruler.created_at}`;
    const errors = useRef(onError); errors.current = onError;
    const latest = useRef(world); latest.current = world;
    const pending = useRef(new Map<string, Promise<boolean>>());
    const markReportRead = useCallback((battleId: number, reportId?: number): Promise<boolean> => {
        if (engine.mode === 'practice') return Promise.resolve(false);
        const report = latest.current.reports.find(row => row.owner_id === engine.playerId && row.battle_id === battleId);
        if (report?.read_at) return Promise.resolve(true);
        const id = report?.id ?? reportId;
        if (!id || !Number.isSafeInteger(id)) return Promise.resolve(false);
        const receipt = `${key}:${id}`, existing = pending.current.get(receipt);
        if (existing) return existing;
        const request = engine.command({ type: 'readReports', reportIds: [id] }).then(() => {
            const old = readReportIds(key); old.add(battleId); storeReadReportIds(key, old); return true;
        }).catch(() => { errors.current(); return false; }).finally(() => pending.current.delete(receipt));
        pending.current.set(receipt, request); return request;
    }, [engine, key]);
    const markAllReportsRead = useCallback(async (): Promise<boolean> => {
        if (engine.mode === 'practice') return false;
        const receipts = latest.current.reports.filter(report => report.owner_id === engine.playerId).map(report => report.battle_id);
        try {
            await engine.command({ type: 'readAllReports' });
            const old = readReportIds(key); receipts.forEach(id => old.add(id)); storeReadReportIds(key, old); return true;
        } catch { errors.current(); return false; }
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
    useEffect(() => { if (openedBattle != null) void markReportRead(openedBattle); }, [openedBattle, markReportRead]);
    return { markReportRead, markAllReportsRead };
}

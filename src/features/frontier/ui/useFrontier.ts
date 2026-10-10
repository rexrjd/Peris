import { useCallback, useEffect, useRef, useState } from 'react';
import { commandFrontier, FrontierApiError, frontierSession, frontierState, joinFrontier } from '../../../platform/frontier';
import type { Faction } from '../../factions/domain/factions';
import type { FrontierCommand, FrontierSnapshot } from '../domain/types';

type PendingCommand = { requestId: string; command: FrontierCommand; message: string };

export function useFrontier() {
    const [snapshot, setSnapshot] = useState<FrontierSnapshot | null>(null);
    const [authenticated, setAuthenticated] = useState<boolean | null>(null);
    const [connectionError, setConnectionError] = useState('');
    const [actionError, setActionError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<PendingCommand | null>(null);
    const [now, setNow] = useState(Date.now());
    const offset = useRef(0);
    const busyRef = useRef(false);
    const mounted = useRef(false);
    const refresh = useCallback(async (signal?: AbortSignal) => {
        const next = await frontierState(signal);
        if (!mounted.current || signal?.aborted) return;
        offset.current = next.now - Date.now();
        setNow(next.now);
        setSnapshot(previous => previous && previous.now > next.now ? previous : next);
        setConnectionError('');
        setAuthenticated(true);
    }, []);

    useEffect(() => {
        mounted.current = true;
        const controller = new AbortController();
        let polling = false;
        const poll = async () => {
            if (polling) return;
            polling = true;
            try {
                const session = await frontierSession(controller.signal);
                if (controller.signal.aborted) return;
                setAuthenticated(session.authenticated);
                if (session.authenticated) await refresh(controller.signal);
                else setConnectionError('');
            } catch (error) {
                if (!controller.signal.aborted) setConnectionError(error instanceof Error ? error.message : 'The server is unavailable.');
            } finally { polling = false; }
        };
        void poll();
        const interval = window.setInterval(() => void poll(), 3_000);
        const clock = window.setInterval(() => setNow(Date.now() + offset.current), 1_000);
        return () => { mounted.current = false; controller.abort(); window.clearInterval(interval); window.clearInterval(clock); };
    }, [refresh]);

    const join = async (name: string, faction: Faction) => {
        if (busyRef.current) return;
        busyRef.current = true; setBusy(true); setActionError('');
        try { await joinFrontier(name, faction); await refresh(); }
        catch (error) { if (mounted.current) setActionError(error instanceof Error ? error.message : 'Could not found your village.'); }
        finally { busyRef.current = false; if (mounted.current) setBusy(false); }
    };

    const execute = async (intent: PendingCommand) => {
        if (busyRef.current) return;
        busyRef.current = true; setBusy(true); setActionError(''); setNotice(''); setPending(intent);
        try {
            await commandFrontier(intent.requestId, intent.command);
            if (!mounted.current) return;
            setPending(null); setNotice(intent.message);
            try { await refresh(); }
            catch (error) { if (mounted.current) setConnectionError(error instanceof Error ? error.message : 'Waiting for the server.'); }
        } catch (error) {
            if (!mounted.current) return;
            if (!(error instanceof FrontierApiError) || !error.uncertain) setPending(null);
            setActionError(error instanceof Error ? error.message : 'The order could not be completed.');
        } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
    };

    return {
        snapshot, authenticated, connectionError, actionError, notice, now, busy,
        locked: busy || pending !== null, pending, join,
        run: (command: FrontierCommand, message: string) => {
            if (!busyRef.current && !pending) void execute({ requestId: crypto.randomUUID(), command, message });
        },
        retry: () => { if (pending) void execute(pending); },
    };
}

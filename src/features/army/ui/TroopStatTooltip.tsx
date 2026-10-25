import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { TroopStat, TroopStatSource } from '../domain/troopCardStats';
import {factionOf, type Faction} from '../../factions/domain/factions';
import {rallyFactionStyle} from './rallyFactionTheme';

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const signed = (value: number) => `${value < 0 ? '−' : '+'}${number(Math.abs(value))}`;

export function TroopStatTooltip({ label, stat, children }: { label: string; stat: TroopStat; children: ReactNode }) {
    const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [sceneFaction,setSceneFaction]=useState<Faction>();
    const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number; paper: boolean }>({ left: 8, top: 8, maxHeight: 300, paper: false });
    const keepOpen = () => clearTimeout(timer.current);
    const show = () => {
        keepOpen();
        const box = trigger.current?.getBoundingClientRect();
        if (!box) return;
        const above = box.top > innerHeight / 2;
        const scene=trigger.current?.closest<HTMLElement>('.scene-theme');
        setSceneFaction(scene ? factionOf(scene.dataset.sceneFaction) : undefined);
        setPosition({ left: Math.max(8, Math.min(box.left - 60, innerWidth - Math.min(320, innerWidth - 16) - 8)),
            ...(above ? { bottom: innerHeight - box.top + 8 } : { top: box.bottom + 8 }),
            maxHeight: Math.max(100, (above ? box.top : innerHeight - box.bottom) - 16),
            paper: !scene && !!trigger.current?.closest('.rp-shell, .rp-overlay-theme') });
        setOpen(true);
    };
    const delayClose = () => { timer.current = setTimeout(() => setOpen(false), 150); };
    useEffect(() => () => clearTimeout(timer.current), []);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.stopImmediatePropagation(); setOpen(false); }
        };
        const resize = () => setOpen(false);
        const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) setOpen(false); };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape, true);
        window.addEventListener('resize', resize);
        window.addEventListener('scroll', scroll, true);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', resize); window.removeEventListener('scroll', scroll, true); };
    }, [open]);
    const sources = (rows: TroopStatSource[] = []) => <dl>{rows.length ? rows.map((row, i) => <div key={i}>
        <dt>{row.label}{row.detail && <small>{row.detail}</small>}</dt>
        <dd data-change={row.amount < 0 ? 'negative' : 'positive'}>{signed(row.amount)}<small>×{number(row.factor)}</small></dd>
    </div>) : <div><dt>No active bonuses or penalties</dt><dd>—</dd></div>}</dl>;
    return <><button ref={trigger} type="button" className="troop-stat-breakdown-trigger" aria-label={`Explain ${label} bonuses and penalties`}
        aria-describedby={open ? id : undefined} aria-expanded={open} onMouseEnter={show}
        onMouseLeave={() => { if (document.activeElement !== trigger.current) delayClose(); }}
        onFocus={show} onBlur={delayClose} onClick={event => { event.stopPropagation(); show(); }}>{children}</button>
        {open && createPortal(<div className={`realm-presentation${sceneFaction ? ' scene-theme' : ''}`} data-scene-faction={sceneFaction} style={sceneFaction ? rallyFactionStyle(sceneFaction) : undefined}><div ref={panel} id={id} role="tooltip" className="troop-stat-tooltip" data-theme={position.paper ? 'paper' : 'dark'}
            style={{ left: position.left, top: position.top, bottom: position.bottom, maxHeight: position.maxHeight }} onMouseEnter={keepOpen} onMouseLeave={delayClose}>
            <strong>{label} bonus breakdown</strong><p>Base {number(stat.base)} → Current {number(stat.current)}{stat.maximum !== undefined && `–${number(stat.maximum)}`}</p>
            {stat.variants ? stat.variants.map((row, i) => <section key={i}><h4>{row.label} · {number(row.current)}</h4>{sources(row.sources)}</section>) : sources(stat.sources)}
            <p className="troop-stat-tooltip-note">Bonuses multiply in order. Contributions are rounded. Press Escape or tap outside to close.</p>
        </div></div>, document.body)}</>;
}

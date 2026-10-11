import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icons';
import './styles/quick-access.css';

type Shortcut = { label: string; icon: string; description: string } &
    ({ href: string; onSelect?: never } | { onSelect: () => void; href?: never });

/** Navigation only: opening a shortcut never issues a game command. */
export function QuickAccess({ items }: { items: Shortcut[] }) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
    const panelId = useId();
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
        };
        window.addEventListener('pointerdown', outside);
        window.addEventListener('keydown', escape);
        return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); };
    }, [open]);
    return <div className="peris-quick-access" ref={root}>
        <button ref={trigger} className="peris-quick-trigger" aria-label="Quick access" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
            <Icon name="transfer" size={18} /><span>Quick access</span>
        </button>
        {open && <nav id={panelId} className="peris-quick-panel" aria-label="Quick access shortcuts">
            <strong>Quick access</strong>
            {items.map(item => {
                const content = <><Icon name={item.icon} size={20} /><span>{item.label}<small>{item.description}</small></span><Icon name="arrow" size={14} /></>;
                const close = () => { setOpen(false); trigger.current?.focus(); };
                return item.href !== undefined ? <a key={item.label} href={item.href} onClick={() => {
                    close();
                    if (item.href.startsWith('#')) requestAnimationFrame(() => document.getElementById(item.href.slice(1))?.focus());
                }}>{content}</a> : <button key={item.label} onClick={() => { close(); item.onSelect(); }}>{content}</button>;
            })}
        </nav>}
    </div>;
}

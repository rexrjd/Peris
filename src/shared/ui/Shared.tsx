import { useEffect } from 'react';
import { useRef } from 'react';
import { RESOURCES, type Resources } from '../model/resources';
import { Icon } from './Icons';
export function Cost({ cost, resources, compact = false }: {
    cost: Resources;
    resources?: Resources;
    compact?: boolean;
}) {
    return <div className={`cost ${compact ? 'compact' : ''}`}>{RESOURCES.filter(k => cost[k] > 0).map(k => <span key={k} className={resources && resources[k] < cost[k] ? 'short' : ''} title={`${k}: ${cost[k]}`}><Icon name={k} size={compact ? 13 : 17}/><b>{cost[k].toLocaleString()}</b></span>)}</div>;
}
export function Modal({ title, children, onClose, className = '', heading = true }: {
    title: string;
    children: React.ReactNode;
    onClose: () => void;
    className?: string;
    heading?: boolean;
}) {
    const panel = useRef<HTMLElement>(null), close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary,a[href],[tabindex="0"]') ?? []).filter(e => e.offsetParent !== null);
        focusable()[0]?.focus();
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                e.preventDefault();
                close.current();
            }
            if (e.key === 'Tab') {
                e.stopPropagation();
                const all = focusable(), first = all[0], last = all[all.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                }
                else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                }
            }
        };
        window.addEventListener('keydown', key, true);
        return () => { window.removeEventListener('keydown', key, true); previous?.focus(); };
    }, []);
    return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget)
        onClose(); }}><section ref={panel} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" aria-label="Close" onClick={onClose}>×</button>{heading && <h2>{title}</h2>}{children}</section></div>;
}

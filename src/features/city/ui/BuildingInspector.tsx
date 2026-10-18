import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Nonmodal: the city remains selectable and the camera remains usable. */
export function BuildingInspector({ title, onClose, children, returnFocusSelector }: { title: string; onClose: () => void; children: ReactNode; returnFocusSelector?: string }) {
    const [collapsed,setCollapsed] = useState(false);
    const panel = useRef<HTMLElement>(null), origin = useRef<HTMLElement | null>(null), close = useRef(onClose);
    close.current = onClose;
    const dismiss = () => { close.current(); requestAnimationFrame(() => { const target = returnFocusSelector ? document.querySelector<HTMLElement>(returnFocusSelector) : origin.current; if (target?.isConnected) target.focus({ preventScroll: true }); }); };
    useEffect(() => {
        origin.current = document.activeElement as HTMLElement | null;
        panel.current?.querySelector<HTMLButtonElement>('.building-inspector-close')?.focus({ preventScroll: true });
        const key = (event: KeyboardEvent) => {
            if (!event.ctrlKey && !event.altKey && !event.metaKey && ['q','e'].includes(event.key.toLowerCase()) && panel.current?.contains(document.activeElement)) { event.stopPropagation(); return; }
            if (event.key !== 'Escape' || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            event.preventDefault(); event.stopPropagation(); dismiss();
        };
        window.addEventListener('keydown', key, true);
        return () => window.removeEventListener('keydown', key, true);
    }, []);
    return <section className={`building-inspector${collapsed?' is-collapsed':''}`} ref={panel} role="dialog" aria-modal="false" aria-label={title}>
        <button className="building-inspector-close" aria-label="Close" title="Close (Esc)" onClick={dismiss}>×</button>
        <button className="building-inspector-minimize" aria-label={collapsed?'Expand building panel':'Minimize building panel'} title={collapsed?'Expand':'Minimize'} aria-expanded={!collapsed} onClick={()=>setCollapsed(!collapsed)}>{collapsed?'+':'−'}</button>
        {children}
    </section>;
}

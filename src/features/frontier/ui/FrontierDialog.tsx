import { useEffect, useRef, type ReactNode } from 'react';

/** Native modal keeps keyboard focus inside and makes the background inert. */
export function FrontierDialog({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const element = dialog.current!;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        element.showModal();
        const oldOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { element.close(); document.body.style.overflow = oldOverflow; previous?.focus({ preventScroll: true }); };
    }, []);
    return <dialog ref={dialog} className={`fw-dialog ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
        <header className="fw-dialog-heading"><h2>{title}</h2><button className="fw-dialog-close" aria-label="Close window" onClick={onClose} autoFocus>×</button></header>
        <div className="fw-dialog-body">{children}</div>
    </dialog>;
}

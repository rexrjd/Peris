import { useId } from 'react';

/** Pointer hover, keyboard focus and tap all reveal the same help. */
export function Help({ text }: { text: string }) {
    const id = useId();
    return <span className="fw-help"><button type="button" aria-label="More information" aria-describedby={id}>?</button><span id={id} role="tooltip">{text}</span></span>;
}

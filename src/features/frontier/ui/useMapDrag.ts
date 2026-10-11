import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { wrapWorldCell } from '../../map/domain/dimensions';
import type { Position } from '../domain/types';

/** Camera-only input: dragging never selects a target or changes game state. */
export function useMapDrag(center: Position, span: number, onCenter: (point: Position) => void, onZoom: (direction: number) => void) {
    const ref = useRef<HTMLDivElement | null>(null);
    const [element, setElement] = useState<HTMLDivElement | null>(null);
    // The classic map can mount after the 3D view. Bind native listeners to
    // the actual element whenever it mounts, rather than only on first render.
    const attach = useCallback((node: HTMLDivElement | null) => { ref.current = node; setElement(node); }, []);
    const drag = useRef<{ id: number; x: number; y: number; width: number; height: number; origin: Position; moved: boolean } | null>(null);
    const suppressClick = useRef(false);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const zoom = useRef(onZoom); zoom.current = onZoom;
    const finish = () => {
        const pointer = drag.current;
        drag.current = null;
        if (pointer && ref.current?.hasPointerCapture(pointer.id)) ref.current.releasePointerCapture(pointer.id);
        setOffset({ x: 0, y: 0 }); setDragging(false);
    };
    useEffect(() => {
        if (!element) return;
        let lastZoom = 0;
        const wheel = (event: WheelEvent) => {
            if (event.ctrlKey || !event.deltaY || drag.current) return;
            event.preventDefault();
            if (performance.now() - lastZoom < 180) return;
            lastZoom = performance.now(); zoom.current(Math.sign(event.deltaY));
        };
        element.addEventListener('wheel', wheel, { passive: false });
        window.addEventListener('blur', finish);
        return () => { element.removeEventListener('wheel', wheel); window.removeEventListener('blur', finish); };
    }, [element]);
    return {
        ref: attach, offset, dragging,
        input: {
            onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
                if (!event.isPrimary || ![0, 1].includes(event.button) || drag.current) return;
                suppressClick.current = false;
                drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: event.currentTarget.clientWidth / span, height: event.currentTarget.clientHeight / span, origin: { ...center }, moved: false };
                if (event.button === 1) event.preventDefault();
            },
            onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
                const pointer = drag.current;
                if (!pointer || pointer.id !== event.pointerId) return;
                if (event.pointerType === 'mouse' && !event.buttons) { finish(); return; }
                const x = event.clientX - pointer.x, y = event.clientY - pointer.y;
                if (!pointer.moved && Math.hypot(x, y) < 6) return;
                pointer.moved = true; suppressClick.current = true; setDragging(true);
                event.currentTarget.setPointerCapture(event.pointerId);
                const col = Math.round(x / pointer.width), row = Math.round(y / pointer.height);
                onCenter(wrapWorldCell(pointer.origin.col - col, pointer.origin.row - row));
                setOffset({ x: x - col * pointer.width, y: y - row * pointer.height });
            },
            onPointerUp: finish,
            onPointerCancel: finish,
            onLostPointerCapture: finish,
            onClickCapture(event: React.MouseEvent<HTMLDivElement>) {
                if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
            },
            onDragStart(event: React.DragEvent<HTMLDivElement>) { event.preventDefault(); },
        },
    };
}

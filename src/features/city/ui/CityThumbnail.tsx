import { useEffect, useRef, useState } from 'react';
import type { World } from '../../../shared/model/world';
import { Icon } from '../../../shared/ui/Icons';
import { cityPreviewState } from '../domain/citySelector';

export function CityThumbnail({ world, sid }: { world: World; sid: number }) {
    const state = cityPreviewState(world, sid), root = useRef<HTMLSpanElement>(null);
    const [snapshot, setSnapshot] = useState<{ key: string; url: string | null }>();
    const terrain = state.environment.terrain;
    const backdrop = terrain === 'desert' ? 'arid' : terrain === 'mountain' || terrain === 'snow' || terrain === 'darkland' ? 'highland' : 'temperate';
    useEffect(() => {
        let cancelled = false, observer: IntersectionObserver | undefined;
        const render = () => {
            observer?.disconnect();
            void import('../rendering/cityThumbnail').then(module => {
                if (cancelled) return;
                return module.cityThumbnail(state).then(url => { if (!cancelled) setSnapshot({ key: state.key, url }); });
            }).catch(() => { if (!cancelled) setSnapshot({ key: state.key, url: null }); });
        };
        if (root.current && typeof IntersectionObserver !== 'undefined') {
            observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) render(); });
            observer.observe(root.current);
        } else render();
        return () => { cancelled = true; observer?.disconnect(); };
        // Appearance key includes every field consumed by the static renderer.
    }, [state.key]);
    const current = snapshot?.key === state.key ? snapshot : undefined;
    return <span ref={root} className={`city-selector-preview terrain-${terrain}`} role="img" aria-label={current?.url ? 'Preview of actual city buildings' : 'City preview'} data-preview-state={current ? current.url ? 'ready' : 'unavailable' : 'loading'} data-city-faction={state.faction} data-city-terrain={terrain} data-city-water={state.environment.water}>
        <img className="city-selector-landscape" src={`/art/city/previews-v1/${backdrop}.webp`} alt=""/>
        {current?.url && <img className="city-selector-model" src={current.url} alt=""/>}
        {current && !current.url && <span className="city-selector-fallback" title="3D preview unavailable"><Icon name="town" size={28}/></span>}
    </span>;
}

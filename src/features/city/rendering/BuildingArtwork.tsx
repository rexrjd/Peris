import { useEffect, useState } from 'react';
import { BuildingPreview, type BuildingPreviewProps } from './BuildingPreview';
import { Icon, buildingIcon } from '../../../shared/ui/Icons';
import { BUILDINGS } from '../domain/buildings';
import type { BuildingType } from '../domain/types';
import { loadVillageAtlas, villageArtwork } from './villageArtwork';

/** The painted sprite represents a built role; the badge supplies its real level. */
export function BuildingArtwork({ type, level, faction, label, fallback = 'model' }: BuildingPreviewProps & { fallback?: 'model' | 'icon' }) {
    const art = level > 0 ? villageArtwork(type, faction, level) : null;
    const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
    useEffect(() => {
        let active = true;
        if (art) loadVillageAtlas(art.url).then(loaded => { if (active) setLoadedUrl(loaded ? art.url : null); });
        return () => { active = false; };
    }, [art?.url]);
    if (art && loadedUrl === art.url) return <span className="city-building-artwork" aria-label={label} role={label ? 'img' : undefined} aria-hidden={label ? undefined : true} style={{ backgroundImage: `url(${art.url})`, backgroundSize: art.size, backgroundPosition: art.position, aspectRatio: art.aspectRatio }}/>;
    if (fallback === 'model') return <BuildingPreview type={type} level={level} faction={faction} label={label}/>;
    const icon = type in BUILDINGS ? buildingIcon(type as BuildingType) : ({ smithy: 'army', warehouse: 'town', granary: 'food', fishery: 'food', mage_tower: 'sparkles', housing: 'people' } as Record<string, string>)[type] ?? 'town';
    return <span className={`city-artwork-placeholder ${level > 0 ? 'built' : 'unbuilt'}`} aria-hidden="true"><Icon name={icon} size={34}/></span>;
}

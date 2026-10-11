import { ARTIFACTS, type EquipmentSlot } from '../domain/artifacts';
import { ArtifactGlyph } from './HeroPortrait';
/** Only empty slots use the generic glyph; every real catalog item has its own painting. */
export function ArtifactArt({ artifactId, slot = 'charm' }: { artifactId?: string; slot?: EquipmentSlot }) {
    const item = artifactId ? ARTIFACTS[artifactId] : undefined;
    if (!item) return <ArtifactGlyph slot={slot}/>;
    return <span className={`artifact-art rarity-${item.rarity.toLowerCase()}`} data-artifact={artifactId}><img src={item.image} alt={item.name} width={384} height={384} loading="lazy" decoding="async"/></span>;
}

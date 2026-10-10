import type { CampTier } from '../domain/types';

/** Military silhouettes are shared across factions, never village artwork. */
export function CampIcon({ tier }: { tier: CampTier }) {
    return <img className="fw-camp-icon" src={`/art/map/camps-v1/${tier}.webp`} alt={`${tier} mercenary camp`} draggable={false} />;
}

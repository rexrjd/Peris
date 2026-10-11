export type HudPicture = 'map' | 'city' | 'army' | 'rally' | 'reports' | 'wood' | 'stone' | 'food' | 'gold';

/** Small original paintings, exported with alpha for the game HUD. */
export function LowPolyIcon({ name }: { name: HudPicture }) {
    return <img className="hud-picture" src={`/art/ui/low-poly-v1/${name}.webp`} width={24} height={24} alt="" aria-hidden="true" draggable={false}/>;
}

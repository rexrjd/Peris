import { ellipse, path } from '../rendering/primitives';
import { type UnitType } from '../../features/army/domain/types';
import { type BuildingType } from '../../features/city/domain/types';
export function Icon({ name, size = 20 }: {
    name: string;
    size?: number;
}) {
    const shapes: Record<string, React.ReactNode> = {
        world: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-6 6-6 12 0 18M12 3c6 6 6 12 0 18"/></>,
        focus: <><circle cx="12" cy="12" r="5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></>,
        settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none"/></>,
        book: <><path d="M12 5C8 2 3 3 2 4v15c3-2 6-1 10 1 4-2 7-3 10-1V4c-1-1-6-2-10 1v15M6 8h3M15 8h3M6 12h3M15 12h3"/></>,
        expand: <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6"/>,
        horse: <><path d="M4 20v-8l5-4 3-6 4 2 4 7-4 3-3-2v8M8 20v-6M13 5l2 2M4 12l-2-3"/></>,
        bow: <><path d="M6 2c16 5 16 15 0 20L6 2ZM3 12h18m-4-3 4 3-4 3"/></>,
        town: <><path d="M3 21V9h5V5h8v4h5v12M2 21h20M9 21v-6h6v6M6 12h1m10 0h1M11 8h2"/></>,
        army: <><path d="m4 3 14 14m-3-2 5-5M20 3 6 17m3-2-5-5M3 18l3 3m12-3 3 3"/></>,
        report: <><path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/></>,
        wood: <><path d="m12 2-8 12h5v7h6v-7h5zM8 10h8"/></>,
        stone: <><path d="m8 4 8 1 5 8-7 8-10-5-2-6zM8 4l2 8 11 1M10 12l4 9M10 12l-6 4"/></>,
        food: <><path d="M12 22V3M12 8 6 4v5l6 4 6-4V4l-6 4M12 15l-6-4v5l6 4 6-4v-5z"/></>,
        gold: <><ellipse cx="12" cy="7" rx="8" ry="4"/><path d="M4 7v10c0 5 16 5 16 0V7M4 12c0 5 16 5 16 0"/></>,
        crown: <><path d="m3 6 5 6 4-8 4 8 5-6-2 13H5zM5 22h14"/></>,
        help: <><circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 3-3 3-3 6M12 18h.1"/></>,
        sound: <><path d="M3 9h4l5-5v16l-5-5H3zM16 8c3 2 3 6 0 8M19 5c5 4 5 10 0 14"/></>,
        mute: <><path d="M3 9h4l5-5v16l-5-5H3zM16 9l5 6m0-6-5 6"/></>,
        exit: <><path d="M9 3H3v18h6M8 12h14m-5-5 5 5-5 5"/></>,
        check: <path d="m4 12 5 5L20 6"/>,
        time: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
        flag: <><path d="M5 22V3m0 0h14l-3 5 3 5H5"/></>,
        shield: <><path d="M12 2 3 6v7c0 5 9 9 9 9s9-4 9-9V6zM12 7v9M8 11h8"/></>,
        arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
        chevron: <path d="m6 9 6 6 6-6"/>,
        plus: <path d="M12 5v14M5 12h14"/>,
        sparkles: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="M21 2v4M19 4h4"/></>,
        transfer: <><path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/></>,
        people: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3c0-7 12-7 12 0v3M16 4a3 3 0 0 1 0 6M18 13c3 1 3 4 3 8"/></>,
        workers: <><path d="M4 11V9a8 8 0 0 1 16 0v2M2 11h20M9 2v5M15 2v5M6 14v3c0 6 12 6 12 0v-3"/></>,
        download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    };
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name] ?? shapes.town}</svg>;
}
export function Crest({ small = false }: {
    small?: boolean;
}) {
    return <svg className="crest" width={small ? 34 : 66} height={small ? 44 : 74} viewBox="0 0 66 74" aria-hidden="true"><path d="M33 4 58 14v28c0 13-25 26-25 26S8 55 8 42V14Z" fill="#282c26" stroke="#bda77a"/><path d="M33 13 49 19v22c0 9-16 17-16 17s-16-8-16-17V19Z" fill="none" stroke="#7c7453"/><text x="33" y="47" fill="#e2ce9d" fontFamily="Georgia" fontSize="34" textAnchor="middle">P</text></svg>;
}
export function UnitPortrait({ type, enemy = false, atlas, tile = 0, image }: {
    type: UnitType;
    enemy?: boolean;
    atlas?: string;
    tile?: number;
    image?: string;
}) {
    return <div className={`unit-portrait portrait-${type} ${enemy ? 'enemy-portrait' : ''} ${atlas || image ? 'faction-portrait' : ''}`} style={image ? {backgroundImage:`url(${image})`,backgroundSize:'contain',backgroundPosition:'center',backgroundRepeat:'no-repeat'} : atlas ? {backgroundImage:`url(${atlas})`,backgroundSize:'300% 300%',backgroundPosition:`${tile%3*50}% ${Math.floor(tile/3)*50}%`} : undefined} aria-hidden="true"/>;
}
export function buildingIcon(type: BuildingType) { return ({ lumber: 'wood', quarry: 'stone', farm: 'food', market: 'gold', barracks: 'army', stables: 'flag', wall: 'shield', storehouse: 'town' } as const)[type]; }

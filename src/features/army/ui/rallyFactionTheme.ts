import type { CSSProperties } from 'react';
import type { IconType } from 'react-icons';
import { GiEagleEmblem, GiSpartanHelmet, GiWingedScepter, GiEgyptianBird, GiOrcHead, GiTreeBranch, GiAnvil, GiClockwork, GiPagoda, GiSkullShield, GiDaemonSkull } from 'react-icons/gi';
import type { Faction } from '../../factions/domain/factions';

/** Presentation only: a preview changes these materials, never the campaign's faction. */
export type RallyFactionTheme = { name: string; realm: string; material: string; crest: IconType };
export const RALLY_FACTION_THEMES: Record<Faction, RallyFactionTheme> = {
    roman: { name: 'Roman', realm: 'Roman Empire', material: 'Oxblood leather · imperial bronze · marble', crest: GiEagleEmblem },
    spartan: { name: 'Spartan', realm: 'Spartan League', material: 'Hammered bronze · crimson linen · limestone', crest: GiSpartanHelmet },
    persian: { name: 'Persian', realm: 'Persian Empire', material: 'Turquoise ceramic · chased gold · silk', crest: GiWingedScepter },
    egyptian: { name: 'Egyptian', realm: 'Kingdom of the Nile', material: 'Carved sandstone · lapis lazuli · beaten gold', crest: GiEgyptianBird },
    orc: { name: 'Orcs', realm: 'Orc Clans', material: 'Scarred iron · stitched hide · tusk', crest: GiOrcHead },
    elf: { name: 'Elves', realm: 'Elven Realms', material: 'Living ebony · silver leaf · jade crystal', crest: GiTreeBranch },
    dwarf: { name: 'Dwarves', realm: 'Dwarven Holds', material: 'Basalt · forged iron · patinated copper', crest: GiAnvil },
    gnome: { name: 'Gnomes', realm: 'Gnome Guilds', material: 'Machined brass · rose enamel · clockwork', crest: GiClockwork },
    pandaren: { name: 'Pandaren', realm: 'Pandaren Courts', material: 'Lacquered wood · carved bamboo · jade', crest: GiPagoda },
    undead: { name: 'Necropolis', realm: 'Necropolis', material: 'Crypt stone · aged bone · amethyst', crest: GiSkullShield },
    demon: { name: 'Demons', realm: 'Demon Dominion', material: 'Obsidian · charred iron · molten inlay', crest: GiDaemonSkull },
};
export const RALLY_FACTION_ORDER = Object.keys(RALLY_FACTION_THEMES) as Faction[];

type RallyMaterial = 'background' | 'frame' | 'texture';
// Literal URLs are also discoverable by the standalone asset embedder.
const RALLY_FACTION_ART: Record<Faction, Record<RallyMaterial, string>> = {
    roman: { background: '/art/ui/rally-point-v1/roman-background.webp', frame: '/art/ui/rally-point-v1/roman-frame.webp', texture: '/art/ui/rally-point-v1/roman-texture.webp' },
    spartan: { background: '/art/ui/rally-point-v1/spartan-background.webp', frame: '/art/ui/rally-point-v1/spartan-frame.webp', texture: '/art/ui/rally-point-v1/spartan-texture.webp' },
    persian: { background: '/art/ui/rally-point-v1/persian-background.webp', frame: '/art/ui/rally-point-v1/persian-frame.webp', texture: '/art/ui/rally-point-v1/persian-texture.webp' },
    egyptian: { background: '/art/ui/rally-point-v1/egyptian-background.webp', frame: '/art/ui/rally-point-v1/egyptian-frame.webp', texture: '/art/ui/rally-point-v1/egyptian-texture.webp' },
    orc: { background: '/art/ui/rally-point-v1/orc-background.webp', frame: '/art/ui/rally-point-v1/orc-frame.webp', texture: '/art/ui/rally-point-v1/orc-texture.webp' },
    elf: { background: '/art/ui/rally-point-v1/elf-background.webp', frame: '/art/ui/rally-point-v1/elf-frame.webp', texture: '/art/ui/rally-point-v1/elf-texture.webp' },
    dwarf: { background: '/art/ui/rally-point-v1/dwarf-background.webp', frame: '/art/ui/rally-point-v1/dwarf-frame.webp', texture: '/art/ui/rally-point-v1/dwarf-texture.webp' },
    gnome: { background: '/art/ui/rally-point-v1/gnome-background.webp', frame: '/art/ui/rally-point-v1/gnome-frame.webp', texture: '/art/ui/rally-point-v1/gnome-texture.webp' },
    pandaren: { background: '/art/ui/rally-point-v1/pandaren-background.webp', frame: '/art/ui/rally-point-v1/pandaren-frame.webp', texture: '/art/ui/rally-point-v1/pandaren-texture.webp' },
    undead: { background: '/art/ui/rally-point-v1/undead-background.webp', frame: '/art/ui/rally-point-v1/undead-frame.webp', texture: '/art/ui/rally-point-v1/undead-texture.webp' },
    demon: { background: '/art/ui/rally-point-v1/demon-background.webp', frame: '/art/ui/rally-point-v1/demon-frame.webp', texture: '/art/ui/rally-point-v1/demon-texture.webp' },
};

export function rallyFactionArt(faction: Faction, material: RallyMaterial): string {
    return RALLY_FACTION_ART[faction][material];
}

export function rallyFactionStyle(faction: Faction): CSSProperties {
    return {
        '--rp-nation-background': `url('${rallyFactionArt(faction, 'background')}')`,
        '--rp-nation-frame': `url('${rallyFactionArt(faction, 'frame')}')`,
        '--rp-nation-texture': `url('${rallyFactionArt(faction, 'texture')}')`,
    } as CSSProperties;
}

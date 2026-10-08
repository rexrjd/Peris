# Peris — modern interface

Based on main commit `9168e20cf6081937ed50d8ad70400bb207abc11b` (8 October 2026).

## Design

The map and city are the main workspace. Navigation, resources, and the selected object's actions have consistent locations. The interface uses charcoal surfaces, off-white text, and a blue accent, with sans-serif typography and quieter borders. Natural terrain and faction artwork keep their existing colors.

- Navigation reads Map, City, Army, Reports, with one visible active state.
- The resource bar keeps supplies and income visible; clicking a resource opens its existing ledger.
- The city starts with a compact heading and population, staffing, and food balance. Economy details expand on demand instead of taking the first screen.
- City and Buildings buttons switch between the scene and a searchable building browser. The Build shortcut selects an available empty plot.
- Empty plots offer seven city buildings with radio choices, descriptions, costs, and one construction action. Fisheries remain at their river site. Duplicate buildings and the unique mage tower retain their existing rules.
- The selected building inspector contains its level, effect, cost, action, construction queue, and mage research. Race switching and debug tools are in City settings & debug.
- Selected map fields show their name and coordinates immediately. Claim/build/march controls remain visible; terrain and travel explanations are expandable. Campaign landmark lore is also expandable.
- Army, reports, dialogs, spellbooks, and battle controls use the same neutral surfaces and button styles.
- On smaller screens, navigation sits at the bottom, city details stack below the scene, and map details use a bottom panel. A header menu provides Codex, Settings, and Main menu on mobile.

## References and decisions

Studied these interfaces for their useful interaction patterns, rather than copying their artwork:

| Reference | Useful pattern in Peris |
| --- | --- |
| [Total War: Rome II — campaign interface](https://r2encv2.totalwar.com/en/manual/single-player/0015a_enc_page_campaign_play_interface/index.html) | Map-centered workspace with contextual actions and optional campaign information |
| [Warcraft III — unit commands](https://classic.battle.net/war3/basics/unitcommands.shtml) | Persistent resources and predictable selection/action controls |
| [Travian — central village overview](https://support.travian.com/en/articles/42-central-village-overview) | Separate economy details from ordinary village interaction |
| [Civilization VI — interface screenshots](https://sullla.com/Civ6/exceedsexpectations.html) | Compact top-level information and selection-specific panels |
| [Heroes of Might and Magic III HD — official manual](https://store.steampowered.com/manual/297000) | Town scene as the focus, with construction and magic reached through the selected building |

## Apply

Extract `Peris_modern_minimal_UI_changed_files.zip` into the repository root, preserving paths. It contains only the changed/new files. Existing dependencies and database schema are sufficient.

Run `npm run build` and `npm test`. The optional `Peris_modern_UI_playable.html` is a standalone solo/practice preview with embedded assets; download and open it in a browser. It uses the existing save/load behavior.

## Validation

- Production TypeScript/Vite build passed.
- All 162 Node tests passed, including four new interface regression tests for collapsed economy, scene-first city, valid plot choices, and construction availability messages.
- Whitespace/error checks passed.
- Browser visual and pointer-interaction verification could not run in this environment because its required browser-control capability is unavailable.

For visual review, inspect city, building selection, field inspection, spellbook, army, and battle at desktop and phone widths; confirm economy disclosure, search, construction, race/debug controls, and mobile settings access. The new presentation is loaded last in `src/app/styles/index.css` to override the legacy palette without altering the map/Three.js rendering code.

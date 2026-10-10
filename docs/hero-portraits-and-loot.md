# Hero portraits and battle rewards

Based on Peris main commit `7a805622eab4c704e7a161d81a0de5cd962d5901` (10 October 2026), including the recent army picker and faction/map integration.

## Installation

Copy the update files into the repository root, then run `npm ci` and `npm run build`. Online games require `supabase/UPGRADE_TO_V13.sql`, run once in the Supabase SQL editor. It is safe to rerun and preserves existing cities, armies, hero gear, battle reports and XP. Use `FRESH_INSTALL_V13.sql` only for an empty database. No live database changes were applied while preparing this update.

## Portraits

220 original painted portraits: 20 each for Orc, Elf, Dwarf, Roman, Spartan, Persian, Egyptian, Gnome, Pandaren, Undead and Demon. Hero IDs choose a stable face, shared by the roster, hero panel, map markers and battle receipt. A class change or rename does not change that face. The hiring dialog uses class previews.

The built-in image generation tool produced eleven 5×4 sheets. Sources and full prompts are included in `assets/source/heroes/` and `assets/hero-portrait-roster.json`. Run `npm run build:hero-portraits` to export the 256×320 WebP assets. Normal builds use the included exports and do not regenerate images. The older ten PNGs remain untouched.

## NPC rewards

Every NPC victory with a commander awards one artifact to the shared backpack, including repeated camp victories. Tier 1–2 camps draw from the common pool; tier 3–4 draw from stronger equipment; tier 5 can also award the legendary crown seal. Drops use a battle-specific roll with matching client/server rules. Reopening reports or retrying finalization does not duplicate XP or gear. PvP and practice battles do not award NPC equipment.

The existing XP formula is preserved: enemy losses × 2, plus 50 for victory or 20 otherwise. The receipt shows the XP actually added after the level-20 cap, its before/after levels, progress and earned skill points. Full backpacks (200 artifacts, including equipped items) show a clear message and do not claim an item was awarded.

The redesigned receipt uses a compact slate/ivory palette with muted copper accents, item names, bonuses and rarity, resource spoils, casualty totals and an expandable troop breakdown. Open equipment selects the participating commander and the exact received item, ready to equip. Legacy reports remain readable without fabricated XP or equipment rewards.

## Validation

Run `npm test`, `npm run build`, `npm run test:tooling`, `npm run assets:check`, `npm run check:sql`, `npm run test:hero-loot-db`, `npm run test:hero-loot-ui`, `npm run test:empire-db`, `npm run test:world-battles-db`, `npm run test:automatic-db`, `npm run test:db`, `npm run test:fresh`, and `npm run test:e2e -- hero-loot.spec.ts world-battles.spec.ts`.

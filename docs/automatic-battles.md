# Automatic battles

All campaign battles, practice fights and accepted duels start automatically. Both armies use the same AI policy; players prepare soldiers, heroes, equipment, research and home-city support before marching. During the fight, clicking inspects either side. Manual unit orders, rallies and spell RPCs are rejected.

The AI holds useful targets, spreads attacks instead of piling every regiment onto the closest enemy, braces infantry against cavalry, maintains archer distance and uses a cavalry wing approach. Regiments turn toward opponents even in contact. Both sides move from the same position snapshot, then separate using their initial logical formation footprints before simultaneous casualty application. Infantry attacks every 1.2 seconds, cavalry every 1.4, and bowmen volley every 2.5. A cavalry charge needs a real running approach; facing and range checks prevent backward attacks. Arrows and strike animations follow actual attack cooldowns, and casualties no longer recenter every soldier in a block.

AI commanders choose useful legal researched spells without wasting heals on full formations or applying capped buffs. Mana, research ownership, hero power and the eight-second spell cooldown still apply. Each side automatically rallies once when surviving-soldier-weighted morale falls below 42. Local/practice pause and 1×/2×/3× viewing controls are spectator conveniences; online viewers share the server clock.

## Installation

Apply the compatible ZIP files at the repository root on main commit `a82e532f9e0c2d4a8834e3571c9f427bce3d9e76`. See `docs/automatic-battles-compatibility.md` for the merge and verification status. Existing Supabase projects must run `supabase/UPGRADE_TO_V11.sql` in the SQL editor. It preserves accounts, cities, armies, heroes, research and artifacts, and resumes old deployment battles automatically. Use `FRESH_INSTALL_V11.sql` only for an empty project; it intentionally initializes an empty world. Local saves retain their existing identity and format and migrate active deployment battles on load. No database was reset or deployed by this change.

SQL source remains modular. Run `npm run build:sql` after SQL edits and `npm run check:sql` to verify the generated bundles. The older named bundles remain generated compatibility copies of the current modular implementation.

## Verification

`npm test`, `npm run build`, and `npm run test:automatic-db` cover automatic starts, owned-army AI, command rejection, target stability, mirrored movement snapshots, turning and separation, bounded terrain battles, mana-aware spell decisions, server casting, PvP starts, preserved upgrade data and exactly-once casualties, reports and hero rewards.

## Current persistence limit

Local fights catch up on reopening. Online tick requests preserve unprocessed elapsed time and catch up in bounded ten-second chunks. There is no new autonomous background scheduler: a fully absent multiplayer world catches up when a client next requests its battle tick. This is separate from automatic control of both armies and still needs an unattended server job before a ranked season.

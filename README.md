# Peris v0.7 · The Six Standards

A Roman-inspired 2D strategy game with a persistent realm, six campaign encounters, and real-time formation battles. This update keeps the existing React/Vite/Supabase project and its GitHub/Vercel deployment workflow.

## Install the update

1. Extract the changed-files ZIP into the existing Peris repository root beside `package.json`. Replace files and keep the existing Git repository. The patch includes changes relative to both v5 and v6.
2. Run the entire `supabase/UPGRADE_TO_V7.sql` in Supabase SQL Editor. It preserves existing v5/v6 worlds and anonymous accounts and can be rerun. Do not reset an existing world. For a genuinely empty database only, use `supabase/FRESH_INSTALL_V7.sql` and enable anonymous sign-ins.
3. Run `npm install` and `npm run dev` with Node 20.19 or later. On Windows, use `npm.cmd` if PowerShell blocks npm scripts.
4. Commit and push through GitHub Desktop. The existing connected Vercel project deploys the commit.

Existing publishable Supabase client configuration remains included. Environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` can override it. No live database or deployment is changed by downloading this ZIP.

## Latest changes

- Original illustrated Roman city, battlefield ground, environmental props, and infantry/archer/cavalry sprites, plus locally bundled Open Sans fonts.
- Redesigned main menu, campaign introduction, six mission briefings, campaign ranks, and a completion sequence.
- Interactive city buildings, clearer resource and recruitment information, campaign guidance, and detailed battle reports.
- Deployment presets, group movement that preserves relative positions, command feedback, formation cards, pause menu, and touch camera controls.
- Settings, optional procedural music and sound effects, a codex, save export/import validation, and a backup of the previous realm when starting or importing a campaign.

## Play

**Campaign:** develop eight buildings, produce four resources, train infantry/archers/cavalry, march to rebel camps, deploy and fight, then collect spoils and rebuild. Construction and training use timed queues; strategic income and travel continue while away. One field army per player is capped at 1,000 troops. Casualties persist, survivors return, and each of six distinct personal conquests advances the campaign.

**Quick battle:** choose one of four terrains, three commander difficulties, and three army doctrines without spending campaign troops.

**Shared world:** anonymous name-based accounts and mutually accepted PvP invitations. Both commanders deploy and confirm before combat starts. Database functions enforce ownership, resources, orders, casualties and rewards. Shared combat advances while a participant is connected; when both disconnect, tactical simulation pauses. Strategic timers continue offline. The inherited world has 12 starting slots and one settlement per player.

Solo saves remain compatible with the v6 format and persist in the same browser origin. Export/import through Settings to transfer a campaign between browsers or standalone files. Browser data deletion removes the local save and may lose access to an anonymous online account.

| Control | Action |
|---|---|
| Click a formation or its card | Select |
| Shift-click / drag a box | Select multiple formations |
| Click ground/enemy with simple orders enabled | Move / attack |
| Right click | Move / attack |
| Right drag | Set destination, facing and frontage |
| A / 1–9 | Select all / select a formation |
| H / G / R | Halt / Guard / Rally |
| F / Escape | Focus selection / pause menu |
| Space | Pause or resume local battle |
| Scroll / middle drag / arrow keys | Zoom / pan |

On touch screens select a formation, choose Move or Attack, and tap the field. Use camera buttons and the minimap to navigate. Solo and practice battles support pause and 1×/2×/3× speed; online battles share a common clock.

Infantry can brace in Guard; archers engage at range; cavalry benefits from approach speed and flank attacks. Stamina, morale, routing and a single rally matter. Forests, high ground and river crossings affect combat and movement. Formation-level simulation uses simplified movement rather than per-soldier collision or obstacle pathfinding.

## Build and checks

- `npm run build`: strict TypeScript check and production build.
- `npm test`: 12 tests for economy, queues, movement, combat, save validation and campaign progression.
- `npm run test:db`: isolated v5 upgrade, permissions, queues, group orders, battle settlement, and two-player invitation/readiness checks.
- `npm run test:fresh`: isolated empty installation and protection of an existing world.
- `npm run build:standalone`: produces `standalone/Peris-v7-playable.html`, embedding graphics and fonts for solo play. Online play requires the hosted app.

Database tests use PGlite and do not connect to live Supabase. Browser checks exercised onboarding, briefings, city upgrades, recruitment, deployment presets, orders, pause, withdrawal, reports, saved campaign resumption and touch controls. This ZIP is the latest source snapshot; full campaign-ending and standalone release verification are still pending.

Artwork is documented in `ARTWORK.md`; the font license is in `public/fonts/OFL.txt`.

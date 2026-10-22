# Peris: City ruins and permanent ruler defeat

## Gameplay

- Siege catapults may now hit the main building (`market`). A city falls only when **all fixed buildings (including the main building and walls) and internal city slots reach level zero**. External resource fields are then abandoned, not required to be individually destroyed.
- The permanent `ruined_at` timestamp is stored on the existing city. The site and its prior ruler remain in public map snapshots. The world map draws broken masonry in 3D / 2D instead of a village. Ordinary cities are selectable; ruins appear in the separate **Ruins** tab of the city switcher.
- Queued construction, recruitment, settler expeditions and city production are cancelled. Resources stop; abandoned resource fields are unclaimed. The same city cannot be founded over the ruins.
- Surviving existing armies retreat over land to the nearest reachable living city, keeping their heroes and existing army IDs. Garrison survivors use transport records, then join a surviving city garrison. An unreachable evacuation disbands; it never teleports or spawns a free commander.
- Losing the **last** living city writes `players.defeated_at` permanently, disbands armies, disables farm jobs and blocks fresh gameplay commands. The eliminated player can log back in and read the memorial/defeat screen but cannot play that ruler again.

## Installation / rollout

1. Commit or back up your previous local Codex changes first; this feature script checks expected source text and aborts safely on drift.
2. Execute `python implement_ruins.py --repo C:/Peris` (preview only), then `python implement_ruins.py --repo C:/Peris --apply` when the reviewed file list is correct. The script keeps timestamped backups.
3. From the game root run `npm run build:sql`, `npm test`, `npm run test:tooling`, `npm run assets:check`, `npm run build`, and relevant database/e2e suites. If anything fails, do not deploy.
4. First test `supabase/UPGRADE_CITY_RUINS.sql` against a COPY of your live V19 database, not production. Use the generated complete SQL in Supabase SQL Editor for production only after migration tests, backups, and approval.
5. Keep the website deployment and production SQL rollout separate. Existing games cannot safely use the new client until the migration is applied.

## Release notes / caveats

- Review `supabase/UPGRADE_CITY_RUINS.sql` before execution; this package **never runs SQL** on your Supabase instance.
- Enabling this feature is irreversible at the gameplay level. Restoring an accidentally eliminated ruler requires a deliberate database administrator operation, not a normal user command.
- New `peris_ruin_route` is a wrapped-grid BFS (land only, no diagonal sea-corner cutting), so unusually large maps with many simultaneous evacuations warrant a performance test.
- The GitHub integration currently allows read but not write in this session (branch creation returned HTTP 403); this package does not push or merge anything.
- This patch was constructed against the latest visible GitHub `main` at `333a6fe2ab48ec2506fc7340c99651a1def0e532`. Any drift in your local Codex workspace needs review, not blind replacement.

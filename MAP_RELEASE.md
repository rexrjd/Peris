# Publish the map release

All work belongs to `mehdi/map-overhaul`. Latest fetched main at preparation time: `a26e5e7`, merged on the feature branch as `68f4796`. No main checkout, force push, remote merge or live database deployment was performed.

## Send the branch to GitHub

```powershell
git branch --show-current
git status
git push origin mehdi/map-overhaul
```

The branch should be `mehdi/map-overhaul` and the working tree clean. Open a GitHub pull request from it into `main`; review with the city developer before merging. If main advances again, fetch and merge its new commits into this feature branch and rerun checks. Preserve shared history.

## Update the database and app together

Back up the database, review `supabase/UPGRADE_TO_V9.sql`, then apply it through the project's normal Supabase release process. It installs wrapped rules, field ownership, construction and production without resetting city slots, factions or magic research. Do not use a fresh-install file on an existing database. Unsafe occupied positions abort the migration.

Deploy the normal game with the matching database migration. The actual campaign/online map needs no `?map-preview=1`; that URL remains a temporary art demo with different rules. Source changes alone do not update the hosted database or game.

## Checks

```powershell
npm run check:world
npm run check:sql
npm test
npm run test:db
npm run test:fresh
npm run test:city-db
npm run test:magic-db
npm run test:factions-db
npm run test:territory-db
npm run test:map-db
npm run build
```

Use `npm.cmd` if PowerShell blocks npm. Rendered desktop/mobile verification and multiplayer load testing remain outstanding. Browser access was denied by the saved permission during preparation. No remote push or deployment was made on your behalf.

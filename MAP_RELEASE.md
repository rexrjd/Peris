# Publish the map release

The map overhaul and tactical unit work are integrated with main's Empire/Heroes V10 systems. The original map work started on `mehdi/map-overhaul`; it is included in the unit branch's ancestry. Use a separate integration checkout to review and test newer main changes before publication.

## Publish a tested integration

```powershell
git branch --show-current
git status
git fetch origin
git push origin HEAD:main
```

Publish only the reviewed integration commit with a clean working tree and passing checks. Direct publication to `main` requires the maintainer's authorization. If main advances again, fetch and merge its new commits into the integration branch and rerun affected checks. Preserve shared history and use a normal push.

## Update the database and app together

Back up the database, review `supabase/UPGRADE_TO_V10.sql`, then apply it through the project's normal Supabase release process. It installs wrapped map and Empire/Heroes rules without resetting city slots, factions or magic research. Do not use a fresh-install file on an existing database. Unsafe occupied positions abort the migration. A Git push does not apply this SQL.

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
npm run test:population-db
npm run test:empire-db
npm run test:tooling
npm run assets:check
npm run build
npm run test:e2e
```

Use `npm.cmd` if PowerShell blocks npm. Inspect the browser captures as well as the test results. Multiplayer load testing and live deployment remain separate release work.

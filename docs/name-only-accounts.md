# Account entry and stable connections — V15

## Player experience

Shared world has two separate screens:

- **Log in:** browse ruler portraits, search names, filter by race/activity, sort by activity/name/cities/hero level, and page through every account. The selected preview shows the capital, cities, armies, total population, strongest hero level, founding date and recent activity. **Log in by name** works when the roster is unavailable.
- **Create account:** choose an unused name and one of eleven factions: Roman, Spartan, Persian, Egyptian, Orcs, Elves, Dwarves, Gnomes, Pandaren, Necropolis or Demons. The starting city and its army/hero appearance use that race immediately. The existing starter economy supplies one city, one army and one commander.

Knowing a name intentionally grants control. No password, email or recovery code is involved. Login requires an existing name and allocates nothing. Creation rejects an occupied name without changing its ruler or race. Names accept 2–20 ASCII letters, digits, spaces, `_` or `-`, ignoring capitalization and surrounding spaces. Original spelling is retained.

Refresh resumes the active tab. **Menu → Switch ruler** opens the account browser and disables automatic resume for that tab. The remembered ruler is selected when on the current page and prefilled under name entry. Tabs have independent connections. Expired/missing sessions reconnect to the same name, preserving V14 behavior. Failed non-idempotent gameplay orders are not automatically replayed; requests retain their 20-second bound.

The roster defaults to all rulers. **Online** means a login/game snapshot was received within two minutes; **Last 24h** includes accounts seen within a day. This is approximate presence, not a live browser count. The roster refreshes every 45 seconds. Gameplay records activity at most once per 30 seconds. Older accounts without activity data remain available under All rulers.

## Install

Rebased on main `3ebbb81b84902b14bdaffcb3c9c769a09cee9780` (11 October 2026), including painted faction villages, garrisons, reviewed marches, manual farm batches and expanded Frontier Wars. The earlier V15 ZIP was based on `0f15994`; use this revised overlay with the current main checkout.

1. Apply the included files at the repository root containing `package.json`.
2. Run the entire **`supabase/UPGRADE_TO_V15.sql`** in the existing project's SQL Editor before deploying this frontend, even if V14 is already installed.
3. Run `npm ci`, project checks and the normal frontend deployment flow.
4. Select an original ruler under **Shared world → Log in** to resume its progress.

The repeatable upgrade preserves player UUIDs, cities, armies, heroes, equipment, queues, progress, farm lists, target presets, garrisons and existing march cancellation/return fields. `FRESH_INSTALL_V15.sql` is exclusively for an empty database and refuses existing players. Anonymous Supabase sign-ins must remain enabled. No new Auth provider or service-role key is required. No live SQL/deployment/push was performed while preparing this update.

Older generated installer aliases include current modules, following the existing generator convention; use the named V15 installer for this release. The frozen V14 and latest-main fixtures are historical test inputs, not deployment files.

## Authority and privacy

`peris_enter_account(name, mode, faction, creation_id)` handles explicit entry. Login requires an existing name. Creation requires an unused name, valid faction and request UUID. Allocation, faction selection and private creation receipt commit atomically. Repeating the same name/race/request returns the same estate, even from a fresh connection after a lost response. Changing a receipt's name/race is rejected.

Auth UUIDs represent browser connections independently of durable ruler UUIDs. Private `peris_account_sessions` binds each connection to its ruler. A connection cannot redirect to another name; switching opens a fresh local session. Original identities, `peris_player_id()`, game RPCs, RLS policies and Auth-cleanup protection retain V14 compatibility. Tokens stay in per-tab session storage; only the remembered name is shared in local storage.

Legacy `peris_login(text)` remains available for already deployed V14 clients, including their new-name allocation behavior. This V15 frontend uses explicit entry exclusively. Entry validates its receipt, settles offline queues and verifies player/city/army ownership before installing the world. A retry retains the creation UUID, and same-action requests are coalesced within a tab.

`peris_account_directory` supplies a bounded public summary (1–100 rows; 12 per UI page) without requiring Auth signup. Search is literal; ordering has deterministic name/UUID tie-breakers. The strongest hero uses existing XP thresholds and the portrait's own army-home faction, which can differ from the capital faction.

Public fields are ruler ID/name, capital name/race, city/army/population totals, strongest hero ID/class/home faction/level and activity/founding dates. Auth IDs, resource balances, troop counts, locations, routes, equipment and orders remain private. Activity/creation tables have RLS and no client privileges; the activity helper is private.

## Frontier Wars compatibility

The launcher link, npm commands, separate `FRONTIER_LOCAL.sql` generator and unchanged-output optimization remain. Frontier Wars keeps its Node authority, cookie and local database. These account changes apply to Shared world; the two modes' accounts are not combined. See [Frontier Wars](frontier-wars.md).

## Verification

`npm run test:account-directory-db` tests frozen V14 upgrades twice, account/estate preservation, all eleven races, strict login, duplicates, receipt retries across connections, accurate empire/hero stats, pagination/search/filters, privacy, activity throttling and fresh-install safeguards. `npm run test:accounts-db` retains V13 preservation, Auth cleanup, multiple cities/armies, equipment, queues, rival-action rejection and accepted automatic PvP checks.

`npm run test:account-compatibility-db` starts from the frozen `3ebbb81` installer, saves a farm target and troop pool, dispatches a partial raid, then applies V15 twice. It compares every persisted game row exactly, opens the same ruler from a new connection, cancels the pre-upgrade order once and dispatches the saved farm batch without changing troop totals. It also verifies race creation, legacy-client access and private farm/garrison permissions. Account browser checks verify that the selected race reaches the new painted village with its six starting plots and Quick access retained. The existing city suite covers growth to sixteen plots.

Unit checks cover session reuse, cleared storage, switching, expired tokens, validation, action/nonce preservation, offline settlement and mismatched/incomplete snapshots. Browser tests use the real frontend and generated V15 SQL behind isolated Auth/HTTP adapters, without changing production accounts. They cover desktop/mobile creation, race choice, duplicates, missing-name rejection, roster filtering/pagination/keyboard selection, failed-directory retry/name fallback, fresh-device login, reload, token expiry and independent tabs. Screenshots are visually inspected.

Browser QA uses Chromium 153, software graphics and Canvas fallback for account flows, with video disabled in a private environment configuration. Frontier browser checks use a separate disposable database. This does not measure hosted Supabase latency or multiplayer load capacity.

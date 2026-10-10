# Name-only accounts and stable connections

## Player behaviour

- Enter the name and control that ruler. No password, email, account claim, or recovery code is involved. Knowing the name grants control, intentionally.
- An existing name returns the same player UUID, cities, armies, heroes, equipment, queues and progress, including from a fresh device or cleared browser.
- A new name creates one starting estate. Concurrent name allocation is serialized, and subsequent logins reuse it.
- Names accept 2–20 ASCII letters, digits, spaces, `_` or `-`. Capitalization and surrounding spaces do not distinguish accounts: `Rex`, `rex` and ` Rex ` open the same ruler. The original display spelling is retained.
- Refreshing an active shared-world tab resumes it automatically. **Menu → Switch ruler** returns to name entry and clears automatic resume for that tab. The last name remains prefilled.
- Separate tabs can control different rulers. Switching one does not change the other. Multiple connections to the same ruler are allowed and use the existing authoritative game locks.
- Expired/missing Auth sessions reconnect through the same name. Failed non-idempotent gameplay orders are not silently replayed. Network requests have a 20-second bound; reconnecting keeps the last valid realm visible.

## Install

This changed-files update is based on `3a598fd`, including the Frontier Wars commit. The original account update was based on `6fcc0df`; this package merges both versions.

1. Copy the included project files over the repository root containing `package.json`.
2. Run the entire **`supabase/UPGRADE_TO_V14.sql`** in the current Supabase project's SQL Editor.
3. Commit/deploy the frontend through the existing GitHub/Vercel flow.
4. Enter the original ruler name. Existing player IDs and progress are retained.

Anonymous sign-ins must remain enabled in Supabase Auth as in the current game. No service-role key, Edge Function, password provider or email configuration is needed. `FRESH_INSTALL_V14.sql` is exclusively for an empty database. No live SQL or frontend deployment was performed while preparing this update.

## Frontier Wars compatibility

The Frontier launcher link, npm commands, separate SQL generator and unchanged-output optimization are preserved. Its application route, persistent Node authority, gameplay and saved data remain as committed on main. `FRONTIER_LOCAL.sql` continues to be generated separately and is excluded from the Shared world installers.

Name-only account recovery applies to **Shared world**. Frontier Wars remains the separate local milestone described in `docs/frontier-wars.md`, with its own browser cookie and database. Its accounts are not combined with Shared world accounts by this update.

## Implementation

Supabase Auth supplies the browser connection, independently of the durable ruler account. `peris_login(text)` resolves the name and privately binds the Auth UUID to the persistent player UUID. A bound connection cannot be redirected to a different name; switching opens a fresh local connection. Old browser identities retain their original account for compatibility. Name allocation and individual connection binding use transaction locks, with the existing land-allocation lock retained for a genuinely new city.

`peris_player_id()` resolves the caller's ruler. Active game RPCs, private snapshots and ownership policies use it, including heroes, equipment, settlers, resources, multiplayer invitations and battles. The mapping table has no client read/write privileges. The argument-free identity helper is executable for RLS and reveals only the caller's ruler ID. The old Auth-user foreign key on `players` is removed while all player UUIDs and game references are preserved, so removing an obsolete anonymous Auth user does not cascade into the estate.

Auth tokens live in per-tab session storage with an independent live-client broadcast/lock key. Supabase refreshes them normally; the adapter recovers the name binding when a session expires. Only the remembered name is shared in local storage. Storage-disabled tabs use memory for the current connection.

Account entry validates the login receipt, settles offline queues before its first snapshot, and verifies that the loaded player/city/army belong to the selected ruler. A different or empty account snapshot cannot replace the current world. Duplicate login attempts are coalesced, and recovering an engine cannot change its persistent player ID.

## Verification

`npm run test:accounts-db` upgrades a frozen V13 installation twice and checks that existing IDs, multiple cities and armies, commanders, XP, equipment, pending recruitment and camp progress are unchanged. It covers fresh-device recovery, case/space variants, old sessions, repeated/new-name logins, invalid names, private mapping permissions, ownership policy conversion, recovered-ruler construction/hero commands, rival-action rejection, selected-army PvP invitations and accepted automatic battles. It also deletes the original anonymous Auth user in the isolated database and confirms the ruler and progress remain accessible by name.

Client tests cover session reuse, cleared storage, name switching, expired JWT/refresh tokens, invalid input, offline failures, queue settlement order, and mismatched or incomplete snapshots. `tests/e2e/accounts.spec.ts` uses an isolated Auth stand-in backed by the actual V14 game SQL to exercise the real frontend without changing the production Supabase project.

Passed: 302 gameplay/client tests (one existing skip), production build, tooling, asset validation, SQL/world/camp generation checks, and isolated signup, account migration, fresh-install, economy/PvP, Empire/heroes, hero-loot, territory, automatic-battle and map-snapshot database suites. Four browser tests passed across desktop and mobile, covering refresh, fresh-device recovery, case/space normalization, name switching, token expiry, cleared tokens, main-menu refresh, and independent tabs. Screenshots were inspected. The browser run used Chromium 153 with software graphics, Canvas fallback, and video capture disabled in a private test configuration because the normal browser/video binaries were unavailable; no game assertions were removed. This does not measure hosted Supabase performance or high-player concurrency.

### Compatibility follow-up on main `3a598fd`

The merged update passes 309 gameplay/client tests (one existing skip), all 15 Frontier server tests, Frontier type checking, four tooling tests, validation of 46 registered models, production build, and world/camp/SQL generation checks. Account migration, general database and fresh-install suites pass. All four account browser checks and both Frontier browser checks pass on desktop/mobile; the Frontier tests enter through the merged launcher link and exercise recruitment, raids, return/delivery, farm presets and reload. These use isolated databases and the same Chromium 153/Canvas configuration described above, with a unique disposable Frontier database directory. Account screenshots were inspected. The V14 account SQL is byte-identical to the previously tested package, and the separate Frontier SQL remains identical to main.

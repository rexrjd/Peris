PERIS V14 — NAME-ONLY ACCOUNTS / FRONTIER COMPATIBILITY UPDATE
Based on main 3a598fde295c6dd3d62db81de430b5aac29ef388
Latest reviewed commit: Add persistent Frontier Wars mercenary camp loop
Commit time: 10 October 2026, 23:00 Europe/Bucharest

This replaces the earlier account ZIP based on 6fcc0df. The old ZIP would
remove parts of Frontier support if simply copied onto new main.
This package merges README.md, package.json, scripts/build-sql.mjs and
src/features/menu/ui/Login.tsx, preserving both updates. The Frontier browser
regression now enters through its launcher link.

INSTALL
1. Start from latest main containing 3a598fd. Preserve any personal edits.
2. Copy the included project files over the root containing package.json.
3. If V14 has not been applied, run the ENTIRE supabase/UPGRADE_TO_V14.sql
   in Supabase SQL Editor before deploying the updated frontend.
   Already applied V14? Its SQL is unchanged; no repeat migration is needed.
4. Commit/deploy the merged frontend through the existing GitHub/Vercel setup.
5. Enter your original ruler name to return to the same account.

No database reset. Existing player IDs, cities, armies, heroes, equipment,
queues and progress are retained. FRESH_INSTALL_V14.sql is for an empty DB only.
No repository push, live SQL or frontend deployment was performed here.

FRONTIER WARS
Its launcher link, npm commands, separate local SQL generation, unchanged-file
optimization and existing feature code are preserved. Its Node authority,
local database and cookie identity remain separate from Shared world.
Name-only recovery applies to Shared world. Frontier still has the local
identity limitations documented by your friend in docs/frontier-wars.md.
Do not paste FRONTIER_LOCAL.sql into the live Shared world database.

VERIFIED ON CURRENT MAIN
309 gameplay/client tests passed, one existing skip; 15 Frontier server tests;
Frontier TypeScript check; 4 tooling tests; 46 model validations; production build;
world/bandit/SQL generation checks; isolated account/general/fresh database suites.
All 4 account and 2 Frontier browser tests passed across desktop and mobile.
Frontier recruitment, raids, return/loot delivery, farm presets and reload pass.
Account recovery, switches, expiry, reload and independent tabs pass.
Browser checks used Chromium 153; account rendering used Canvas fallback;
video disabled in a private test config. No assertions were removed.
No hosted Supabase or high-player concurrency benchmark was performed.
Account SQL matches the previous delivery, and Frontier SQL matches main.

CHANGED FILES ONLY — 69 project files. Full source details and installation
instructions: docs/name-only-accounts.md. File hashes: ACCOUNT_UPDATE_FILES.json.

PERIS V15 — ACCOUNT BROWSER, REVISED FOR CURRENT MAIN

Based on rexrjd/Peris main:
3ebbb81b84902b14bdaffcb3c9c769a09cee9780 (11 October 2026).
Replaces the original V15 overlay based on 0f15994.

INSTALL
1. Update your project checkout to current main at the commit above.
2. Extract this revised changed-files ZIP over that repository root.
3. Run the ENTIRE supabase/UPGRADE_TO_V15.sql in the existing Supabase SQL Editor.
4. Run npm ci and project checks, then build/deploy the frontend normally.
5. Open Shared world: Log in to an existing ruler or Create account with a race.

If your database already received the original V15 update, run this REVISED
UPGRADE_TO_V15.sql again. It combines the account additions with all current
march, garrison and farm logic. The migration is repeatable and preserves data.
FRESH_INSTALL_V15.sql is exclusively for an EMPTY database; it refuses an
existing campaign. Anonymous sign-ins must remain enabled.
Historical SQL files in tests/fixtures are NOT installation files.

ACCOUNT FEATURES
- Separate Log in / Create account screens, portrait roster and ruler preview.
- Search, race/activity filters, sorting, pagination and keyboard/mobile entry.
- Stats: cities, armies, population, strongest hero level and recent activity.
- Eleven starting races, including Roman, Spartan, Persian and Egyptian humans.
- Missing-name login creates nothing; duplicate-name creation overwrites nothing.
- Creation receipts survive lost responses and fresh-session retries.
- Refresh, account switching, session recovery and independent tabs retained.
Knowing the ruler name intentionally grants control without a password.

COMPATIBILITY
The old V15 ZIP overlaps recent commits and would replace newer App, engine,
styles and generated SQL. This version merges the account delta onto current
main instead. Painted cities, village ledgers, Quick access, new army-culture
handling, garrisons, cancellable/returning marches, farm lists and the expanded
Frontier system are retained. Selected race reaches the painted starter village
and correct troop labels; initial plots and city growth follow current main.
Frontier retains its separate authority, accounts, data and deployment flow.

This is a changed-files overlay, not a complete repository. No game asset
changes/downloads are needed. ACCOUNT_UPDATE.patch is an alternative for applying
or reviewing the source delta on an untouched target checkout; do not apply it
after extracting the overlay. No hosted SQL, deployment or repository push
was performed. See ACCOUNT_UPDATE_COMPATIBILITY.txt for reviewed commits and
merge details, docs/name-only-accounts.md for behavior, and
ACCOUNT_UPDATE_FILES.json for baseline and file hashes.

VALIDATION
- 369 gameplay/client unit checks passed; one existing skip.
- All 29 Frontier server checks passed.
- Nine isolated database suites passed: historical account/directory migration,
  exact current-main migration, general integration, fresh-install guard,
  garrisons, reviewed marches, saved farms and manual farm batches.
- Ten production-build account browser checks passed across desktop/mobile.
- Six production city/farm browser checks passed across desktop/mobile: painted
  sixteen-plot layout, construction fallback and reviewed farm-list batches.
- Production build, Frontier types, four tooling checks, 46 model validations,
  world/camp/SQL generation checks and diff formatting passed.
Browser QA uses Chromium 153 with software graphics; account flows use the
Canvas fallback. This does not establish hosted-service load or GPU performance.
The development-server run had a mobile reload timeout; the same assertions
passed on the production build without changing their time limits.

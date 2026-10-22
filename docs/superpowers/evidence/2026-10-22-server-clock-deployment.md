# Server and clock release — 22 October 2026

The user approved a backup, production Supabase update and integration into main. This receipt supersedes the earlier verification document's historical statement that deployment had not happened.

## Backup completed before deployment

- Consistent private logical snapshot: 92 tables, 6,767 rows and 572 catalog objects, including Peris, private account credentials, Auth and Storage metadata. This is not a full physical cluster backup; Storage object bytes are excluded.
- Every table's exported row count and checksum matched the database snapshot. The offline ZIP passed its integrity check. A full restore was not rehearsed.
- ZIP SHA-256: `758f1c2e3a1a3157d62a764849ee6e49e79c28cd4e0ef60c04da92aa29519c45`.
- Offline location: `%USERPROFILE%\.codex\private-backups\Peris\server-clock-2026-10-22\logical-recovery-backup.zip`. Folder access is restricted to the current Windows user and SYSTEM. Do not publish it: it contains sensitive account and authentication data.
- Database snapshot schema: `peris_release_backup_20261022_clock`, inaccessible to player roles and service_role. Its data, manifest and catalog tables have RLS and revoked privileges.

## Deployment completed

- Supabase project: Peris, `chtktuadlsnqgiisdcom`, existing region `eu-west-1`.
- Migration: `20261022051758_server_clock_foundation_1x`.
- Reviewed code revision: `d9369390bb911d2a16fc26e8a58122c2d366fcec`, including main `773a84bfc195c5ac95878b4ee43ac0d5812a9d1c`.
- Focused SQL SHA-256: `04213d05a94eef6911a21687471a8ee708b2a66758186ccafef296353920bd53`. It composes the reviewed modular function definitions, clock/worker schema and new-row defaults; it does not reseed game data or replace login/password APIs.
- The populated isolated rehearsal passed. Transaction guards on production checked every pre-existing public/private table's original columns for identical row counts and content before committing. Existing account-function definitions and permissions were guarded too.
- Normal world remains **1x**, profile `normal-v1`, with identical real/game anchors. No accelerated world was created or enabled.
- After deployment: **14 rulers, 19 cities, five password-protected accounts**. Password-data and account-API fingerprints match the immediate pre-deployment values.
- All five newly added clock/worker helper functions reject execution by anon and authenticated roles. The clock table is private. Existing passwordless ruler access is preserved by leaving account APIs unchanged.
- An authenticated `peris_snapshot()` call returned successfully with clock metadata. Its transaction was rolled back to discard activity writes. Four scheduled worker runs after deployment succeeded; the existing 10-second cron remains active.

## Final release checks and limits

- Build passed, retaining the existing large-chunk warning.
- Full unit run: **568 passed, one skipped, one failed**. The failure is the pre-existing City events assertion expecting `All events`; the City feed now displays all activity directly. The same failure was reproduced from an archive of unchanged main `773a84b` using its source and test files. No check or partner UI was changed to hide it.
- Prior affected database, native concurrency and focused browser results are in [the verification record](2026-10-22-server-clock-verification.md). The known frozen-world social upgrade failure remains open.
- Security advisor still reports existing API/RLS configuration warnings. The public recruitment helper's existing ACL was preserved; its authentication check remains. Clock/worker tables intentionally have no player policies. See [Supabase's SECURITY DEFINER guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) for the existing API advisory.
- Successful production reads and worker runs are smoke checks, not proof that all hosted timeouts are eliminated. No 200-bot or 100x capacity claim is made.

## Recovery and future deployment

The private folder also contains the focused SQL, release manifest, verification results and exported catalog. The Supabase migration history records the applied SQL. Prefer restoring the affected function definitions/defaults from the catalog if rollback is needed; do not overwrite a progressing world's player data with an older snapshot without a separate recovery decision.

Do not apply the complete generated upgrade bundle to this live backend until the separately installed password-protection migration is represented and verified in that deployment path. This focused release deliberately preserves those live account functions and permissions. Continue editing database sources under `supabase/modules` and regenerate bundles as usual for isolated tests.

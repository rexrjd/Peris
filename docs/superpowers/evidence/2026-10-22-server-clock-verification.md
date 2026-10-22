# Server/clock verification — 22 October 2026

Review branch `feat/server-clock-foundation`, integrated with main `0edf013`. No production deployment or main merge. The PC runs Windows, Intel i7-9700K (8 logical CPUs), approximately 32 GB RAM; native PostgreSQL 17.11 uses an isolated loopback database. No live player data or credentials are used.

## Checks actually completed

| Check | Result |
|---|---|
| Unit suite after integration and countdown regression | 568 passed, 1 skipped, 0 failed |
| Build | Passed; existing large-chunk warning retained |
| Tooling | 5 passed |
| Assets, world, bandits, SQL generation | Passed |
| Report-read and camp/artifact generation | Passed after regenerating the changed snapshot installer |
| Account recovery browser checks | 8 passed, desktop/mobile; gateway 502, failed fetch, expired identity, reload/switch and separate tabs |
| Real PostgreSQL independent-session checks | Passed: locked due owner without metadata, locked battle, land reservation, overlapping workers, real statement cancellation/rollback, concurrent ticks and duplicate finalizers |
| Paid upgrade/recruit/research at 1x/10x/100x | Passed; equivalent economy, population, science, culture and camp resource accounting at the same game instant |
| Background journeys at 1x/10x/100x | Passed: production upgrade, paid settlers and troop shipment, populated evacuation/returning-loot fixtures, repeated-settlement no-op |
| Populated pre-clock upgrade | Passed: exact old account/resource/queue/army/field-station/battle/science/report rows unchanged at first and repeated 1x clock installation |
| Camp and city finalizer fault checks | Passed: late report failure rolls back results; successful retry and duplicate result do not repeat effects; city case includes actual permanent defenders |

After integrating main, the rerun isolated suites passed: unattended worker, battle atomicity, clock metadata/gameplay/upgrade/journeys, game integration, automatic battles, player raids, hero loot, command receipts, city garrisons, own-city logistics, account compatibility, fresh install, database privacy and report reads. Research, population, territory, empire/heroes, army/farm parity, artifacts/camps, city environment, world battles and magic also passed after the clock changes, before the latest main integration; they were not all repeated after that integration.

Representative desktop/mobile recovery screenshots were inspected. The account browser tests intentionally use the Canvas fallback and isolated real SQL through a fixture HTTP transport. They do not verify production Supabase latency or the 3D renderer's performance.

## Failures and limits retained honestly

- **Pre-existing social upgrade failure:** the last `test:social-db` run reached check 42, then an old frozen V18 world reported `record "c" has no field "ruined_at"` while the test expected a protected-city rejection. Reproduced with unchanged main `3225ffb` guild SQL. It remains open; checks were not relaxed to hide it or subsequently claimed green.
- **Broad UI suite incomplete:** stopped at the user's request because the partner owns those surfaces. Earlier attempts exposed old recruitment-label/duplicate-preview selectors and account-fixture counts; the latter was corrected while preserving the exact two-new-account invariant. Cold startup under concurrent browser/database load also exceeded a test deadline. The focused final account run passed without extending timeouts. Do not describe the full UI suite as passing.
- **Mixed-load performance target missed:** the integrated five-client, ten-minute direct-SQL run completed without errors or duplicate reports, but core p95 was **2010 ms**, above the 2000 ms target. Broad browser/database verification was also running on the PC. This failure is retained alongside the later separately labelled run without concurrent repository tests.
- The earlier ten-minute run before the latest main integration had core p95 **954 ms**, zero errors and no duplicate reports. This is a different revision/workload and is not substituted for the integrated result.
- **Deferred minor:** two ruin-date UI labels convert real audit dates as virtual game dates in accelerated worlds. The default 1x display is unaffected. Audit dates must eventually be displayed directly in `CitySelector.tsx` and `WorldView.tsx`.
- All 210 technology definitions are covered by the existing research suite at 1x; every technology and every challenge/practice fault path was not separately replayed at each accelerated rate. Camp/city fault injection and normal challenge/practice tests do not imply that exhaustive matrix passed.
- No hosted timeout-resolution, regional migration, 200-bot capacity or 100x throughput claim. The ten-game-second battle cap and preserved debt remain important scaling limits. See [server reliability](../../server-reliability.md).

## Review decisions

1. Implement inline and use one final fresh review to reduce repeated context loading. Local Qwen drafted the helper and handover; its output was corrected and tested. No measured percentage saving is claimed.
2. Preserve the partner's main work by integrating it into the review branch and reconciling clock/worker overlaps. A 100x test configuration still requires a separate empty backend; there is no live rate change or multi-world routing.
3. Keep scheduling metadata free of player/battle foreign-key locks. Otherwise recording a busy retry can wait on the very row the worker was supposed to skip. Delete orphan operational metadata during later passes; player data and troop ownership are unaffected.
4. Test fairness across at most two passes when a costly battle exhausts a soft budget. Isolate the five-second owner-backoff check from unrelated combat CPU time. Native lock probes use small combat debt; the separate performance probe measures real overdue battles. Cost if mistaken: scheduling regressions; both native and SQL regressions remain in the branch.
5. Retain all combat debt, operational timeout limits and rules. A cancelled transaction rolls back rather than pretending progress. Cost: high-speed capacity remains unproven and may require further worker/runtime work.
6. Stop broad partner-UI reruns as explicitly requested; retain focused account/clock verification. Cost: cosmetic and unrelated rendering regressions are outside this final verification.
7. Keep new main fixture repairs strict: private geography/setup uses admin only in disposable tests; result indexing excludes `RESET ROLE`; expected account counts assert exactly two additions. No player API gained admin access.

Raw local probe output is written under ignored `reports/server-reliability/<UTC-run>/`. The compact JSON beside this record preserves measured summaries and conditions without credentials.

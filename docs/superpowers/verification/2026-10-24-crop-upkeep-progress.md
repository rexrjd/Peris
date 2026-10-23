# Crop upkeep progress

Plan: `docs/superpowers/plans/2026-10-24-crop-upkeep-starvation.md`

- Baseline: npm test 595 passed, 1 skipped, 0 failed (596 total).
- Design reviewed read-only by crop_design_check; chronology, staging, source mapping and nonmonotone battle healing findings incorporated.
- Ruling: use the existing committed roster lifecycle during extended Peris battles; permanently remove starvation and refund only final combat losses. Travian's instantaneous combat has no healing window, so immediate reversible refunds would create food farming.
- Pre-flight: domain/SQL/UI share optional enablement and crop/minute DTO fields; projections cannot perform casualties; version-absent paths retained for activation and old servers.
- Tasks 1–4 complete: pure supply/depletion, enabled chronology/activation, battle compatibility, authoritative database and UI implemented and verified. Final unit suite: 609 passed, 1 existing skip.
- Task 5: fresh whole-feature reviewer found waiting-return crop timing and destroyed-source SQL fallback bugs. Both fixed with regressions; staged-raid priority also verified RED→GREEN.
- Ruling: retain this review branch without merging/pushing or deploying SQL, consistent with the repository workflow and requested local implementation scope.
- Ruling: run affected Playwright desktop/mobile flows through `npm run test:e2e -- ...` rather than repeat the known unrelated 36-minute full-suite failures. No map or battle renderer changed.
- Ruling: deterministic guild/population database fixtures control game time; the separate clock-gameplay suite verifies actual 1/10/100 scaling. Historical no-Market fixture also omits the later crop module, matching a real pre-feature world.
- Verification details: `docs/superpowers/verification/2026-10-24-crop-upkeep.md`.

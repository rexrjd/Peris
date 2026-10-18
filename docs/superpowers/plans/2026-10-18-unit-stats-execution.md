# Unit stats execution ledger

Approved in chat: 2026-10-18, "Make the changes". Worktree branch: `plan/unit-stats-balance`.

Pre-flight: versioned catalog feeds formation construction, recruitment, validation and report economics. Battle creation must capture both doctrines before hero/research application. Missing battle/report and online metadata means v1; future local orders mean v2. SQL catalogs precede dependent functions. Existing queues, active formations and receipts cannot be repriced or rewritten. Baseline main city changes were merged into the review branch; primary-checkout edits were not touched.

Ruling: the skill's Bash task helpers cannot execute because Git Bash is unavailable on this Windows host (command failed). Use this checked-in ledger and PowerShell verification logs for task bases, decisions and actual results instead. Cost: manual bookkeeping, no gameplay difference.

Task 1: in progress — versioned canonical catalog and reference stats.
Task 2: pending — captured local/SQL doctrines.
Task 3: pending — recruitment and comparison UI.
Task 4: pending — save/report compatibility and upgrade.
Task 5: pending — calibration, repository/browser checks and review.

Tasks 2–4 interface ruling: implement save version validation and report pricing alongside battle metadata, before enabling new local economics. Otherwise an intermediate commit would create battles that its own importer rejects. Keep separate domain/UI commits after the shared boundary is tested.

Task 2 evidence: RED basic-only formations lacked stats and new battles lacked version/doctrine metadata. GREEN all 99 role/doctrine constructions, idempotent researched snapshots and 35 focused local cases. SQL: 198 version/faction/role combinations agree, captured NPC/player profiles survive home changes and repeated hero application. Automatic, world-battle, player-raid and magic isolated suites passed.

Task 4 evidence: RED new low-protection profiles failed import, unknown versions were accepted, and new reports used old replacement prices. GREEN old/new active formation round trips, rejection checks and explicit historical report prices. Populated SQL fixture retains accounts, artifacts, completed research, social messages, paid queues and active formations across the focused upgrade twice; an existing row receives version 1 when the new column is added. No live database used.

Ruling: basic-only formations retain their original optional recruited-role metadata so existing seven-look rendering remains intact; both basic and advanced paths still assign catalog stats unconditionally. Historical Frontier consumers explicitly use v1, and the historical troop-cost helper keeps a v1 default; active report economics always passes its recorded version.

Baseline verification: npm test after integration: 486 pass, 1 skip; production build passed (existing chunk-size warnings). Two older account migration suites fail on new raid-column defaults; both failures reproduce using f075876 SQL before this branch's changes. Full E2E exposed a pre-existing hidden building research queue in formOnly mode; the queue is restored in the recruitment component and will be rerun. The changed inspector expectation now checks reference points rather than obsolete multipliers.

Task 1: complete — base d1b074d plus main merge; RED missing resolver, GREEN 3 focused cases and npm test: 478 passed, 1 skipped (output/unit-balance/task-1-tests.log). Ruling: historical Frontier aliases retain v1; active consumers will explicitly resolve world versions, preventing old-server repricing.

Task 3: domain/UI implemented — eight focused inspection/recruitment/Rally tests pass. Nine roles charge exact literal prices at levels 1/3 with +20% training research; an older server keeps v1 costs/times. SQL accepts 99 faction-role batches with the shared costs. Four previously failing desktop/mobile browser cases now pass after restoring the compact research queue and updating precise reference-point assertions and the current pinned queue selector. Full E2E remains in flight.

Task 5 calibration: the selected seventh candidate passes the 990-battle baseline at 41.11–57.22%, all eleven inside 40–60%, with no timeouts. The first complete broader run is 1,452 games with zero timeouts, finite troop state and casualty conservation. It includes all-pair resource/production/capacity/advanced-role matrices and actual matched neutral-research/endgame diagnostics; strong individual slices are explicitly documented rather than hidden by the mean. A final report rerun adds composition/matrix summaries and the catalog hash, plus an additional pooled starting-score gate.

Task 4 additional checks: new snapshots missing combat fields and unknown result versions were observed failing then rejected by the validator; five focused save checks now pass. The SQL fixture also preserves an old receipt and returning loot through upgrade, uses its v1 fallback prices on delivery, and rejects duplicate delivery. No player data or SQL deployment was touched.

Final review ruling: run the one fresh, read-only whole-branch review concurrently with the long final browser suite after all application source is committed. Completion still requires both the review/fix pass and actual verification results. Cost if wrong: a later relevant fix needs affected tests rerun. This avoids paying for repeated implementer/reviewer contexts.

Fresh whole-branch review: fixed base f0758761eecea5953f2630b6e08a4fbd62640191, reviewed head ce4043d32b71b097e38516438052778ec0b25510. No Critical/Important findings; one finding labelled Minor: MarchDialog omitted the active world version and displayed historical replacement prices. Ruling: upgrade this finding to Important for this change because the example party shows gold 150 instead of 80, materially undermining the requested cost comparison. One fix pass: a rendered-dialog regression failed with the old literal prices, then passed with explicit worldBalanceVersion(world); unversioned worlds still show historical prices. Logs: march-red.log and march-green.log under output/unit-balance.

Review scope rulings: hosted SQL installation/concurrency remains unverified and outside the no-deployment scope. Individual economy/endgame slices remain diagnostics, not a universal balance claim. Existing migration-fixture failures reproduced against the fixed main base are not regressions. Unchanged unrelated gameplay issues were not expanded into this change. No deferred code findings remain from the fresh review after the march-price fix.

Browser-run incident: stopping superseded Playwright runs removed their owned Vite server after another run had reused it; errors were ERR_CONNECTION_REFUSED at page.goto. Discard those infrastructure-failed runs as verification evidence. The final run uses a separately owned stable Vite session, verified HTTP 200 and the changed module before launch. Direct Playwright CLI forwarding ensures three workers; PowerShell npm.ps1 had consumed forwarded arguments in earlier runs.

Post-review source verification: npm test completed with 492 passed, 1 skipped, 0 failed (493 tests; review-unit-tests.log). Production build passed after the price fix (review-build.log), retaining the existing >500 kB chunk warning. The superseded verified-e2e CLI was still spawning workers after its children were stopped; verified its exact command line and stopped only that owned process tree. Early stable-run timeouts under that contention must be rerun after the full run, without weakening timeout/assertion settings.

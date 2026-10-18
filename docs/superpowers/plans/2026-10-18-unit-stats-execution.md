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

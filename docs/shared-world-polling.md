# Shared-world request load

Five unattended browsers should not repeatedly download unchanged state or retry
failed reads at their normal rate. This change reduces that traffic for every
online client, including the local player tester.

## What changes

| State | Check interval |
| --- | --- |
| Active automatic battle | Existing 850 ms |
| Construction, training, travel, raid or active research | Existing 2.55 seconds |
| Idle visible account | 10 seconds |
| Idle hidden account | 30 seconds |
| Unchanged public map | 15 seconds visible; 30 hidden |
| Guild/message summary | 6 seconds open; 10 closed |
| Open conversation | Existing 2 seconds |

Map navigation and post-command reads remain immediate. Owner-scoped realtime
invalidation remains enabled. Closed social summaries stay within the existing
unread-notification test window; an initial 30-second proposal failed that test
and was corrected without changing the test.

Failed background core, map, cosmetic and social reads wait 5, 10, 20, 40 and then
60 seconds between attempts. Success resets that delay. Failure of a cosmetic
lookup does not slow a healthy battle. Explicit player commands retain their
existing receipt IDs and retry rules; this policy never replays a mutation.
A forced post-command read is preserved even if an older in-flight read fails.

Private-state, sync and public-map polls treat PostgreSQL lock contention
(`55P03`) as temporary. They retain the last loaded state and retry through that
same backoff. After three consecutive failures, a readable busy status explains
automatic recovery; an existing genuine error remains visible until a successful
read clears it. The raw `lock_not_available` token is not shown for these polls.
Initial account state loading makes at most three attempts, waiting 500ms then
1000ms, without re-entering the account or replaying player orders.

Server simulation, combat rules, rewards, casualties, saves, password protection
and legacy name-only access are unchanged by polling and connection-status recovery.
No database migration is needed. The database worker continues while browsers
are hidden, disconnected or closed.

## Verification evidence — 21 October 2026

Supabase logs from 22:10–22:25 UTC on 20 October recorded statement timeouts
(`57014`) while loading private snapshots. Stopping the previous tester reduced
observed latency, but does not establish that bot traffic was the sole cause.

Two equal 45-second observations used the real shared backend, five existing
protected test accounts and a sixth phone-sized browser opening ruler 123 with
no password. Three test accounts had the messenger open. No account setup,
messages, recruitment, raids or administrative mutations were performed.

| Requests during the observation | Before | After |
| --- | ---: | ---: |
| State settlement | 89 | 25 |
| Private snapshots | 89 | 25 |
| Public map | 54 | 15 |
| Social summaries | 88 | 36 |
| Cosmetic city lookups | 23 | 19 |
| **Total** | **343** | **120** |

That is about **65% fewer requests**. Both observations completed all six logins
and the phone reload without a failed request in the measured window. Some
individual responses still took several seconds. These short observations do
not prove that every production timeout is fixed or establish a capacity limit.

A further two-minute observation completed the same six logins and phone reload
with no failed request in its measured window. Supabase logs recorded no statement
timeout during the checked 22:49–22:56 UTC window. The local checks passed: 532
unit tests (one existing skip), five tooling tests, 46 registered model checks,
the production build, SQL-generation checks and 36 affected browser tests across
desktop and phone-sized Chromium.

Automated regressions separately exercise idle budgets, overload recovery,
independent failure channels, actual battle and queued-work dispatch, and the
overlapping forced-refresh case. Synthetic overloads and controller fixtures are
tester checks, not discovered production bugs or successful combat runs.

Run the focused browser tests with:

```powershell
npx playwright test tests/e2e/online-polling.spec.ts tests/e2e/online-polling-controller.spec.ts
```

The full account, password, social, city-raid and report-read browser suites also
cover affected flows. Keep raw live evidence private: browser sessions and
credential files must not be added to Git or public reports.

## Operation

Local bots must use an updated application checkout and be restarted to load
this code. Hosted players receive it only after the normal reviewed frontend
release. There is no SQL to deploy for this change.

If timeouts persist, retain the failed request timings and inspect database CPU,
connection pressure and slow-query plans during that same window. Do not simply
raise timeouts, weaken checks or assume a paid database upgrade is necessary.

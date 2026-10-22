# Main-game foundations: proposed two-person work division

Status: proposed ownership and sequencing for review. This is not an instruction to deploy SQL, merge changes or start the bot season.

## Direction

Build the essential mechanics into the ordinary game first, with normal worlds at 1x. Then exercise the same authoritative rules in a separate 100x season. Acceleration must be a shared-clock configuration, not a collection of special bot shortcuts. Performance and competitive pacing still need separate verification at 100x.

Use two vertical workstreams, not a frontend/backend split: each person implements and tests their own gameplay across domain logic, authoritative SQL and relevant controls. Agree shared timing, rule-version and command interfaces first. There is no assumption about the partner's available subscriptions or AI tools; the proposed split follows the development tools and investigations already established in this chat.

## Fresh baseline: what should not be rebuilt

A 22 October fetch advanced main from `333a6fe` to `7f933205db48cdacdab42101e6637d0e89e7290d`. The three new commits add city ruins/permanent defeat and dedicated permanent city garrisons, plus defence controls and updated walls. The latest source gives walls 10% defence per level, capped at 50%; this supersedes the earlier audit's 6% plus-morale description. It still does not implement allied reinforcements.

Read-only live inspection confirmed the city-garrison table, ruins and wall-defence functions, and ruined/defeated columns exist. Their presence is not proof that the complete new gameplay/migration or deployed client is correct. The new permanent-defeat rules also make protection and migration tests particularly important.

Preserve existing unit statistics and the versioned catalog, formation combat, research, population, founding, walls, siege, guild ranks/chat/pacts, account protections and save compatibility. The earlier full 1,452-battle calibration passed against the pre-update source; do not relabel it as fresh verification of the new garrison/ruins release.

The earlier Nine Beacons design remains a future-season proposal. Its audited `333a6fe` snapshot predates these three commits; use this newer baseline for implementation planning.

## Workstream A: owner of this chat — simulation, economy and verification

Why here: reuse the existing Supabase access, SQL-module workflow, worker investigation, unit calibration, isolated database fixtures, Playwright tester, reports and optional Ollama adapter. Do not spend time recreating this tooling. Bot source and the polling fix remain on review branches and must be integrated with current main before they are treated as a shared release.

### A1. Reliable authoritative progression — first priority

- Reproduce known snapshot/sync timeouts in an isolated backend. Measure SQL cost, locks, response sizes, worker runtime and service lag before choosing fixes.
- Make worker transactions bounded and fair, separate state reads from unnecessary settlement writes, bound historical snapshot work, and apply profiling-backed indexes. Preserve receipts and exactly-once casualties, loot and reports.
- Integrate the reviewed polling/backoff work with the new main changes, preserving garrison and ruins data. Confirm snapshot failure does not strand an otherwise valid session at the ruler chooser.
- Extend result/inventory verification to the new permanent city-garrison pool and ruins evacuations; the old bot verifier must not silently omit them.
- Deliverable: normal 1x progression and login remain correct during concurrent development/raiding, reconnects and clients-closed operation.

### A2. One shared game clock and rule profile

- Supply common domain/server timing helpers and a versioned rule profile. Default normal gameplay to 1x; expose time information consistently to countdowns and observers.
- Cover production, population, recruitment, research, construction, travel, camp replenishment, returns, settler journeys and the new ruins evacuations. Keep authentication, request deadlines, abuse limits and audit timestamps in real time.
- Preserve accepted orders' rule/timing semantics across upgrades. Add compatible migrations rather than rewriting existing dates or instantly applying a changed economy to old saves.
- Deliverable: the same logical scenario produces equivalent rules/accounting at 1x,10x and 100x. This does not claim equivalent server capacity or human reaction time.

### A3. Competitive economic foundation

- Calibrate production versus military/building/research prices, queue times, storage, replacement losses and expansion. Use fresh starts, not free 1,000-soldier test armies.
- Design and test an explicit military food/supply burden; do not call existing absence a bug or activate untested starvation. Include a transition that cannot unexpectedly erase current players' armies.
- Account for mobile armies, stationed pools, permanent city garrisons and troops supporting allies. Moving troops between pools must neither avoid upkeep nor charge twice; agree who supplies visiting forces before adding the reinforcement rule.
- Measure all four resource components of delivered raid profit. Tune finite camp income, defender replenishment and repeated-farming pressure; prevent campaign rewards from becoming an unlimited competitive supply shortcut.
- Provide canonical costs, carrying limits, resource debit/delivery and rule-version helpers for the partner's new transport and support commands. Their new features must not maintain a second economy.
- Deliverable: investment, army growth, farming and expansion have competing payoffs at 1x; losing players have a feasible rebuilding path; extended runs do not simply saturate every system immediately.

### A4. Testing and the later season runner

- Maintain the unit-calibration suite, isolated SQL suites, normal-player browser journeys, compact PDFs and structured evidence. Add regression coverage for the partner's commands instead of assuming a passing button click proves delivery.
- After the 1x foundation and shared commands pass, generalize the runner to 200 accounts, persisted uncertainty/commitments and optional live AI guild leaders. Benchmark installed Qwen before choosing model/cadence; no unmeasured usage-saving claim.
- Own authoritative season clock, final scoring/award settlement and load telemetry later; consume beacon ownership events from the partner's objective mechanics. Keep the accelerated population in a separate backend.

## Workstream B: development partner — cooperative strategy and player controls

Why here: extend the current city-garrison/ruins and guild/movement systems as complete playable features. Reuse their existing controls, validation and diplomatic protections instead of creating a parallel command or combat system.

### B1. Allied reinforcement and coordinated defence — first priority

- Extend the own-city defence foundation with legal foreign contingents: recipient permission, source-owner provenance, travel, recall/return, relationship changes, per-owner casualties and reports.
- Define what happens if either city is ruined or a ruler is defeated. Never silently turn an ally's soldiers into the host's property or duplicate them during evacuation.
- Add ordinary-player defence calls, pledges, requested arrival times, acknowledgements and outcomes. Publish the same finite commands for future bots and AI leaders.
- Deliverable: a real ally can answer a call, arrive, defend, take correctly attributed losses and recall survivors through normal controls. Chat alone is not a completed reinforcement feature.

### B2. Intelligence and understandable military operations

- Give the existing scout unit actual missions, timestamped intelligence reports and counter-scouting. Keep hidden enemy information server-controlled; research unlocking a scout is not a scouting mission.
- Provide legitimate incoming-attack notifications and ETAs, shared operation targets and coordinated separate attack waves. Do not promise combined allied attackers in the first release.
- Add the lightweight movement-line option: red known hostile incoming, green allied support, blue own outgoing, labelled/dashed returns. Preserve wrapped routes, existing detail inspection and non-color cues.
- Deliverable: a human can identify a worthwhile target, see an authorized threat, coordinate a response and understand its result without privileged bot knowledge.

### B3. Resource aid and anti-farming protection

- Start with resource shipments between permitted players/cities: finite transport, real journeys, clear reservation/delivery/return and loss/overflow accounting using A's economic helpers. A full marketplace/order book can wait.
- Add limited resource hiding and clearly explained newcomer protection, with agreed attack-breaking rules. Align the protection/recovery design with the newly added permanent-defeat behavior rather than secretly resetting eliminated accounts.
- Make any construction/queue cancellation policy consistent with protected-resource rules so refunds cannot become unlimited hidden storage.
- Deliverable: a guild can actually supply a defender or rebuilding member, while stronger players still have meaningful raiding opportunities.

### B4. Later Nine Beacons gameplay

- After cooperative combat is correct, implement beacon capture/defence and player-facing control history/operation controls using the same army and reinforcement rules.
- Emit authoritative capture/control events for A's season scoring; do not calculate victory from UI ownership labels. Do not create a separate battle-strength shortcut for bots or beacons.

## Shared contracts and parallel working rules

Before branching into implementation, agree:

1. **Timing/economy:** A owns the shared clock, versioned rule/cost helpers and worker infrastructure. B uses those helpers for new journeys, intel deadlines and operations.
2. **Player commands:** B owns the reinforcement/recall, scouting, shipment and guild-operation feature contracts, including caller permissions and receipts. A's bots use those same validated player APIs.
3. **Combat accounting:** B owns contingent/provenance requirements; shared finalizer integration is reviewed jointly. A maintains accounting/retry regression coverage. No contributor may disappear from reports, return delivery or casualty checks.
4. **Integration files:** coordinate changes to snapshots, command unions/RPC routing, SQL manifest/generators and battle finalizers in small integration PRs. Do not independently edit/regenerate the same bundles and then overwrite the other's changes.

Each stream includes its local and SQL implementations, basic UI, tests and upgrade/compatibility handling. Start parallel work with A1/A2 and B1's contract/domain/UI design; wire and release the cooperative mechanics only after the shared clock/accounting contracts are stable. Then A3 and B2/B3 proceed against those contracts. A4/B4 are the final integration phase, not a reason to delay testing the ordinary game.

Use current main as the agreed baseline, isolated review branches/worktrees, source edits under `supabase/modules`, and required repository/affected database/browser checks. Fetch/review/integrate the other developer's latest main before each push. Keep existing player data and account access intact; SQL publication, website publication and review-branch sharing are separate operations.

## Definition of done before the large simulation

The ordinary 1x game supports profitable-but-risky raiding, economic development, real intelligence, resource aid and allied defence; existing saves and new garrison/ruin states pass upgrades and accounting checks. The known timeout and stranded-login cases have regressions and controlled concurrent verification. Duplicate/restarted commands do not duplicate troops, resources or rewards.

Only then run the same game in a separate accelerated backend and ramp 5->20->50->100->200 while measuring worker lag and correctness. 100x configuration is not proof of 100x processing capacity; the 100x season profile may need different pacing parameters, explicitly recorded rather than hidden waits or free resources.

Defer full city-conquest/loyalty mechanics, a complex auction marketplace, extra factions/units and cosmetic expansion. They are not prerequisites for the first competitive Nine Beacons season. Preserve the existing ruins/permanent-defeat feature; review its fairness rather than rebuilding it.

Planning only: this task fetched and inspected main and read live capability flags. No gameplay changes, production migrations, password access, bot launches or capacity tests were performed.

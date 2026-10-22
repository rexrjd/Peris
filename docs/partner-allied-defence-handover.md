# Partner handover: allied defence

**Status**: Allied defence is proposed work. Server/clock interfaces are implemented and reviewed on `feat/server-clock-foundation`; they are not deployed or merged into main. See [verification and limits](superpowers/evidence/2026-10-22-server-clock-verification.md).
**Baseline**: `0edf013` (22 October; includes own-city troop shipments, direct garrison recruitment and city event UI).

### Context & Ownership
You begin implementing **B1 allied reinforcements**. The other developer retains ownership of timeouts, worker fairness, and clock logic. Existing mechanics include own-city garrisons, ruins, permanent defeat, and walls (+10% defence per level, capped at +50%). Note that foreign allied troops are not yet implemented.

Your scope involves delivering real owned troops travelling to permitted allied cities, defending with per-owner casualties, and handling survivor recall/return logic. Begin with design/domain tests, basic UI, and integrate SQL only after contracts are agreed upon.

Current main already has **shipments between cities belonging to the same ruler** in `cityReinforcements.ts` / `city/garrison-logistics.sql`. Reuse its route and timing ideas. Allied troops need separate ownership/provenance records: do not combine another ruler's troops into the host's existing `peris_city_garrisons` balance or simply remove the destination-owner check. That would let the host withdraw or recruit with someone else's soldiers. Keep send, permission, casualty, recall and return accounting per original owner.

### Critical Test Scenarios
Ensure your implementation covers: denied destinations, forged owners, insufficient troops, duplicate send/arrival/result conflicts, recall during combat, broken alliances, ruined host/source cities, defeated owners, overflow limits, and privacy constraints.

### Coordination & Files
Partner owns new feature files. Coordinate command unions, snapshots, SQL manifest/generators, and battle finalizers.
*   **Key Sources**: `src/features/city/domain/cityGarrison.ts`, `src/features/city/domain/ruins.ts`, `src/features/map/domain/garrisons.ts`.
*   **SQL**: Edit sources under `supabase/modules`; run `npm.cmd run build:sql` then `npm.cmd run check:sql`.

### Clock Contract
Implemented interfaces on the foundation branch:

- `GameEngine.nowGameMs()` provides current game milliseconds; pass this explicitly into domain functions.
- `World.server_now` is game UTC. Optional `World.game_clock` supplies `{version:1,rate:1|10|100,profile_id,real_now,game_now}`. Old saves without metadata remain 1x.
- `src/shared/time/gameClock.ts` exports validation, monotonic projection, real countdown conversion and presentation-only ETA conversion. `EngineClock` owns receipt sampling; avoid device `Date.now()` in gameplay.
- SQL `public.peris_game_now()` is a **private** helper usable from authoritative functions, not a browser RPC. Store departure/arrival in game UTC with normal rule durations. Do not divide durations by speed again.
- Retries, auth, abuse windows, worker budgets and human message/audit dates remain real time.
- Default is 1x. Accelerated setup is private, allowed only before players exist in a separate disposable backend. There is no production world switching or safe hot speed change.

Use [the implementation plan](superpowers/plans/2026-10-22-server-clock-foundation.md) for the complete contract and [server reliability](server-reliability.md) for testing and limits. Review the branch changes before integrating; do not copy generated SQL between branches manually.

### Security & Environment
No production accounts, secrets, or SQL deployments are needed. Do not merge, reset worlds, or share passwords. Bots, AI, and beacons are future considerations.

### Setup Instructions
Run these PowerShell commands to initialize the environment:
```powershell
git fetch origin
git worktree add -b feat/allied-reinforcements ../Peris-allied-reinforcements origin/main
cd ../Peris-allied-reinforcements
npm.cmd ci
npx.cmd playwright install chromium
```

### Verification
Read `AGENTS.md`, `ARCHITECTURE.md`, `MAP_WORLD.md`, and `ARTWORK.md`. Focus on the active root source. Execute required checks:
`npm.cmd test`, `npm.cmd run test:tooling`, `npm.cmd run assets:check`, `npm.cmd run build`, `npm.cmd run test:db`, `npm.cmd run test:fresh`, `npm.cmd run test:city-garrisons-db`, `npm.cmd run test:city-logistics-db`, `npm.cmd run test:player-raids-db`, `npm.cmd run test:social-db`, and `npm.cmd run test:e2e` for UI. Add specific reinforcement tests. The frozen social-upgrade fixture currently has a pre-existing missing-`ruined_at` failure; see the verification record instead of assuming the entire suite passes.

Fetch/integrate the latest main branch before every push. Deliver a small review PR containing actual results.

Start design and domain tests from current main now. When integrating the foundation, merge its reviewed commit into your review branch and resolve overlapping snapshots, command routing, manifest/generator and finalizer edits together. Main alone does not contain these new clock APIs yet.

Copy to your coding assistant: Read this handover and the repository instructions, inspect current main, then propose the B1 allied-reinforcement design with provenance, permission, timing and casualty tests before implementation.

Drafted with local Qwen; reviewed and corrected against current source. No reinforcement implementation or gameplay verification is claimed by this handover.

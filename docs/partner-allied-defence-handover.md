# Partner handover: allied defence

**Status**: Proposed work; server/clock changes implementation in progress.
**Baseline**: `3225ffb0195666ed0fa6c256b42e089f5bf53306` (22 October; includes current garrison UI)

### Context & Ownership
You begin implementing **B1 allied reinforcements**. The other developer retains ownership of timeouts, worker fairness, and clock logic. Existing mechanics include own-city garrisons, ruins, permanent defeat, and walls (+10% defence per level, capped at +50%). Note that foreign allied troops are not yet implemented.

Your scope involves delivering real owned troops travelling to permitted allied cities, defending with per-owner casualties, and handling survivor recall/return logic. Begin with design/domain tests, basic UI, and integrate SQL only after contracts are agreed upon.

### Critical Test Scenarios
Ensure your implementation covers: denied destinations, forged owners, insufficient troops, duplicate send/arrival/result conflicts, recall during combat, broken alliances, ruined host/source cities, defeated owners, overflow limits, and privacy constraints.

### Coordination & Files
Partner owns new feature files. Coordinate command unions, snapshots, SQL manifest/generators, and battle finalizers.
*   **Key Sources**: `src/features/city/domain/cityGarrison.ts`, `src/features/city/domain/ruins.ts`, `src/features/map/domain/garrisons.ts`.
*   **SQL**: Edit sources under `supabase/modules`; run `npm.cmd run build:sql` then `npm.cmd run check:sql`.

### Clock Contract
Refer to `docs/superpowers/plans/2026-10-22-server-clock-foundation.md`. This defines game time journeys/ETAs, real-time retries, auth, and worker budgets. Default is 1x; future 100x scaling requires a separate backend. **This contract is not callable yet.**

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
`npm.cmd test`, `npm.cmd run test:tooling`, `npm.cmd run assets:check`, `npm.cmd run build`, `npm.cmd run test:db`, `npm.cmd run test:fresh`, `npm.cmd run test:city-garrisons-db`, `npm.cmd run test:player-raids-db`, `npm.cmd run test:social-db`, and `npm.cmd run test:e2e` for UI. Add specific reinforcement tests.

Fetch/integrate the latest main branch before every push. Deliver a small review PR containing actual results.

Copy to your coding assistant: Read this handover and the repository instructions, inspect current main, then propose the B1 allied-reinforcement design with provenance, permission, timing and casualty tests before implementation.

Drafted with local Qwen; reviewed and corrected against current source. No reinforcement implementation or gameplay verification is claimed by this handover.

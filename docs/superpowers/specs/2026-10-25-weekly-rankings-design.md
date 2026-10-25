# Weekly Rankings

The user requested a Rankings tab in the top navigation, with weekly Attack, Defense, Robbers, Camps (PvE), and Growth leaders, similar to Travian. They explicitly asked us to choose the remaining scoring details and implement. They previously declined browser mockups. The decisions below are implementation choices, not additional user requirements.

## Experience

Add a normal top-level Rankings view alongside Map, City, Rally Point, Armies, Research and Reports. Show five Top 10 tables, a highlighted own-player row/rank even outside the Top 10, and This week / Last week controls. Each table explains its unit. Use the existing fantasy theme, restrained gold accents, accessible tables and responsive stacked cards. Use existing vector icons; no raster assets or dependencies are needed. Empty, loading, retry and older-server states must be usable. Solo campaigns show their own campaign standings and clearly identify the scope.

## Scoring decisions

- Attack: enemy player troops actually killed while attacking in real PvP battles, weighted by hourly crop upkeep (1 infantry/diplomat, 2 mounted/scouts, 3 rams, 4 catapults).
- Defense: attacking player troops actually killed, with the same weighting. For city defense, split integer points among the actual defending players in proportion to their committed troops' crop upkeep. Capture the ownership/weights when the battle begins so destroyed/recalled guild rows and a later city capture cannot change the recipient. Allocate integer remainders deterministically, conserving the exact total. Ordinary duels with real casualties credit their actual defending player.
- Camps: NPC camp troops killed while attacking, weighted by the same upkeep. Includes campaign and roaming camps; losses/draws can still earn kill points.
- Robbers: total wood + stone + food + gold taken as loot in finalized city/camp raids, after carry limits. This measures resources stolen, even if the returning storage later overflows. Exclude gifts, trade, quests, refunds and capture (which retains city resources). Do not subtract recruitment costs or victims' stolen resources from this score.
- Growth: net change in living-city population, including founded/captured cities and losses through conquest/ruins. Initial capital population is a baseline, not earned growth. Accumulate fractional population accurately and expose whole people by truncating the weekly net total toward zero. Negative personal growth remains visible, but only positive scores enter the Top 10.
- Exclude practice, scouting, and starvation deaths from all combat categories. Only immutable finalized outcomes score. Replaying finalization, updating report delivery, deleting/pruning reports, or rerunning installers must not change scores.

Weeks are real calendar weeks beginning Monday 00:00 UTC, independent of accelerated game-clock rates. Scores are assigned to the real week when the authoritative mutation commits/processes. Old completed battles and population existing at first activation are not fabricated as this week's activity. Keep a tracking-since timestamp and disclose a partial first week. Support current and immediately previous week. Zero-score players are unranked. Equal positive scores share a rank; order tied rows by player ID, with at most ten displayed rows.

## Architecture and approaches

Considered deriving boards from visible reports; rejected because reports are private, paginated/prunable and do not preserve reliable guild attribution. Considered copying all game state to the client; rejected because it violates privacy and is unnecessarily large. Selected private server aggregates updated by narrow table triggers, plus a bounded authenticated read RPC. This also survives existing focused installers without replacing combat/economy functions. Local campaigns use a persisted pure-domain counterpart.

Server source belongs under `supabase/modules/rankings`, added late in the manifest after battle/crop/conquest/scouting definitions. Use private idempotency receipts, private captured defender contribution rows and weekly player aggregates. A battle resolved trigger scores final formations/result once. Settlement population/ownership/ruin triggers record net changes atomically. Backfill only attribution for currently active battles; do not backfill completed battles. Install/reinstall preserves activation and totals. No SQL deployment is part of implementation.

The only new client RPC is `peris_rankings(p_period text default 'current')`. It must require a bound authenticated player, validate period against current/previous, and return only display names, guild tags, scores, ranks and public IDs. Helpers/raw tables stay inaccessible to anon/authenticated. Avoid invoking global settlement from this read. Score data remains authoritative and independent of private reports and public map snapshots.

Local domain owns serializable ranking metadata, battle receipts, defender contributions and population baselines. Initialize legacy saves without scoring existing resolved battles or existing population. Record finalized outcomes after loot/capture handling and synchronize growth after actual state mutations. Persist enough metadata for replay protection, both weeks and pending battle ownership. Validate imported metadata strictly with bounded collections and finite numeric scores. Do not create domain runtime import cycles.

## Shared interface

`src/features/rankings/domain/types.ts` exports:

```ts
export const RANKING_CATEGORIES = ['attack','defense','robbers','camps','growth'] as const;
export type RankingCategory = typeof RANKING_CATEGORIES[number];
export type RankingPeriod = 'current' | 'previous';
export type RankingEntry = {
  rank: number | null; player_id: string; display_name: string;
  guild_tag: string | null; score: number; is_you: boolean;
};
export type RankingBoard = {
  category: RankingCategory; entries: RankingEntry[];
  self: RankingEntry | null; total_players: number;
};
export type RankingsResponse = {
  version: 1; period: RankingPeriod; week_start: string; week_end: string;
  server_now: string; tracking_since: string; boards: RankingBoard[];
};
```

`GameEngine.rankings?: (period: RankingPeriod) => Promise<RankingsResponse>` is a read method, never an order/command. LocalEngine and OnlineEngine implement it. The view consumes the engine method, fetches only while mounted, rejects stale period responses, retries explicitly, and refreshes at a bounded interval while visible. Local domain state may add optional types to World; no new public snapshot field is required online.

## Research

- Travian weekly player categories and Monday server-time reset: https://support.travian.com/en/articles/168-how-medals-work
- Travian split between offensive PvP/PvE ranking targets: https://blog.travian.com/2022/04/new-hero-interface-and-much-more/
- Crop-weighted battle XP and proportional defense shares (used as the combat weighting reference): https://support.travian.com/en/articles/169-maximize-your-hero-s-xp

Peris retains Growth as explicitly requested. Travian's weak-unit base-attack cutoff does not map to Peris's different combat stat scale, so no arbitrary cutoff is added. Medals, all-time boards and guild-wide rankings are outside this request.

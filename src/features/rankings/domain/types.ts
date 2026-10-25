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

/** Private solo metadata; never added to public shared-world snapshots. */
export type RankingTotals = {player_id: string} & Record<RankingCategory, number>;
export type DefenderContribution = {player_id: string; weight: number};
export type LocalRankingState = {
  version: 1;
  tracking_since: string;
  weeks: {week_start: string; totals: RankingTotals[]}[];
  population: {player_id: string; total: number}[];
  /** All retained battles, including historical outcomes present at activation. */
  receipts: number[];
  pending: {battle_id: number; defenders: DefenderContribution[]}[];
};

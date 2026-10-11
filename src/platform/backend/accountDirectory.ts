import { supabase } from './supabase';
import type { Faction } from '../../features/factions/domain/factions';
import type { HeroClass } from '../../features/heroes/domain/heroes';

export type PublicAccount = {
    player_id: string; display_name: string; faction: Faction; capital_name: string;
    city_count: number; army_count: number; population: number;
    hero_id: number | null; hero_class: HeroClass | null; hero_faction: Faction; hero_level: number;
    joined_at: string; last_seen_at: string | null; online: boolean;
};
export type AccountDirectory = { server_now: string; total: number; accounts: PublicAccount[] };
export type DirectoryFilters = { search: string; faction: Faction | ''; activity: 'all' | 'online' | 'recent'; sort: 'active' | 'name' | 'cities' | 'hero'; page: number };
export const ACCOUNT_PAGE_SIZE = 12;
export async function accountDirectory(filters: DirectoryFilters, signal: AbortSignal): Promise<AccountDirectory> {
    const { data, error } = await supabase.rpc('peris_account_directory', {
        p_search: filters.search, p_faction: filters.faction || null, p_activity: filters.activity,
        p_sort: filters.sort, p_offset: filters.page * ACCOUNT_PAGE_SIZE, p_limit: ACCOUNT_PAGE_SIZE,
    }).abortSignal(signal);
    if (error) throw new Error(error.code === 'PGRST202' ? 'The account browser needs the V15 server update. Run supabase/UPGRADE_TO_V15.sql before using these account screens.' : 'The ruler roster could not be reached. Retry or log in by name.');
    if (!Array.isArray(data?.accounts) || !Number.isSafeInteger(data?.total)) throw new Error('The roster returned an incomplete response. Please retry.');
    return data as AccountDirectory;
}

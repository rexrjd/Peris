import { type Player } from './types';
export function playerName(players: Player[], id: string | null) { return players.find(p => p.id === id)?.display_name ?? 'Rebel host'; }

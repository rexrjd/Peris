import { type Battle, type Formation } from './types';
export function isMine(f: Formation, playerId: string) { return f.owner_id === playerId; }
export function mySide(b: Battle, id: string) { return b.attacker_owner_id === id ? 'attacker' : 'defender'; }

export type Resources = { wood: number; stone: number; food: number; gold: number }
export type UnitType = 'infantry' | 'archers' | 'cavalry'
export type BuildingType = 'lumber' | 'quarry' | 'farm' | 'market' | 'barracks' | 'stables' | 'wall' | 'storehouse'
export type Terrain = 'plains' | 'woods' | 'highlands' | 'river'
export type Difficulty = 'easy' | 'normal' | 'hard'
export type Player = { id: string; display_name: string; created_at: string; prestige: number; victories: number; recruits: number; upgrades: number }
export type Settlement = Resources & {
  id: number; owner_id: string; name: string; x: number; y: number
  wood_rate: number; stone_rate: number; food_rate: number; gold_rate: number
  resources_updated_at: string; created_at: string; capacity: number
}
export type Building = { id: number; settlement_id: number; building_type: BuildingType; level: number; updated_at: string }
export type Army = {
  id: number; owner_id: string; home_settlement_id: number; name: string
  infantry: number; archers: number; cavalry: number
  start_x: number; start_y: number; target_x: number; target_y: number
  departure_at: string; arrival_at: string; status: 'idle' | 'moving'; updated_at: string
  raid_target_id: number | null
}
export type Camp = { id: number; name: string; x: number; y: number; tier: number; terrain: Terrain; infantry: number; archers: number; cavalry: number; description: string }
export type Order = { id: number; owner_id: string; kind: 'upgrade' | 'recruit'; item: string; quantity: number; started_at: string; finish_at: string }
export type Battle = {
  id: number; attacker_owner_id: string; defender_owner_id: string | null
  attacker_army_id: number; defender_army_id: number | null
  status: 'active' | 'resolved'; phase: 'deployment' | 'combat' | 'finished'
  attacker_ready: boolean; defender_ready: boolean; mode: 'pve' | 'pvp' | 'practice'
  camp_id: number | null; terrain: Terrain; difficulty: Difficulty; enemy_name: string
  winner_owner_id: string | null; winner_side: 'attacker' | 'defender' | 'draw' | null
  started_at: string; ended_at: string | null; last_tick_at: string; elapsed: number
  result: BattleResult | null; rally_attacker: boolean; rally_defender: boolean
}
export type FormationStatus = 'idle' | 'moving' | 'engaged' | 'routed'
export type Formation = {
  id: number; battle_id: number; owner_id: string | null; side: 'attacker' | 'defender'
  unit_type: UnitType; label: string; initial_soldiers: number; soldiers: number; kills: number
  morale: number; stamina: number; facing: number; charge_ready: boolean
  x: number; y: number; target_x: number; target_y: number; target_facing: number | null
  target_formation_id: number | null; status: FormationStatus; damage_pool: number
  columns: number; stance: 'balanced' | 'guard' | 'aggressive'; running: boolean; fire_at_will: boolean
  updated_at: string
}
export type BattleResult = {
  attacker_initial: number; defender_initial: number; attacker_survivors: number; defender_survivors: number
  attacker_losses: number; defender_losses: number; loot: Resources; duration: number; reason: string
}
export type Report = { id: number; owner_id: string; battle_id: number; title: string; won: boolean; result: BattleResult; created_at: string }
export type CampProgress = { camp_id: number; owner_id: string; defeated: number; available_at: string }
export type QuestClaim = { quest_id: string; owner_id: string }
export type Challenge = { id: number; attacker_owner_id: string; defender_owner_id: string; status: 'pending' | 'accepted' | 'declined'; created_at: string; expires_at: string }
export type World = {
  version: number; server_now: string; players: Player[]; settlements: Settlement[]; buildings: Building[]; armies: Army[]
  camps: Camp[]; orders: Order[]; battles: Battle[]; formations: Formation[]; reports: Report[]
  progress: CampProgress[]; claims: QuestClaim[]; challenges: Challenge[]
}
export type BattleOrder = {
  kind: 'move' | 'attack' | 'halt' | 'stance' | 'run' | 'fire' | 'width'
  ids: number[]; x?: number; y?: number; facing?: number; columns?: number; target?: number
  stance?: Formation['stance']; enabled?: boolean
}
export type Effect = { kind: 'arrow' | 'charge' | 'death' | 'route'; x: number; y: number; tx?: number; ty?: number; side: string; at: number }
export type MapSelection = { kind: 'camp' | 'settlement' | 'army'; id: number } | null

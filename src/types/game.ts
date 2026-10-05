export type Player = {
  id: string
  display_name: string
  created_at: string
}

export type Settlement = {
  id: number
  owner_id: string
  name: string
  x: number
  y: number
  wood: number
  stone: number
  food: number
  gold: number
  wood_rate: number
  stone_rate: number
  food_rate: number
  gold_rate: number
  resources_updated_at: string
  created_at: string
}

export type BuildingType = 'lumber' | 'quarry' | 'farm' | 'market'

export type Building = {
  id: number
  settlement_id: number
  building_type: BuildingType
  level: number
  updated_at: string
}

export type Army = {
  id: number
  owner_id: string
  home_settlement_id: number
  name: string
  infantry: number
  archers: number
  cavalry: number
  start_x: number
  start_y: number
  target_x: number
  target_y: number
  departure_at: string
  arrival_at: string
  status: 'idle' | 'moving'
  updated_at: string
}

export type Battle = {
  id: number
  attacker_owner_id: string
  defender_owner_id: string
  attacker_army_id: number
  defender_army_id: number
  status: 'active' | 'resolved'
  winner_owner_id: string | null
  started_at: string
  ended_at: string | null
  last_tick_at: string
  result: Record<string, unknown> | null
}

export type FormationType = 'infantry' | 'archers' | 'cavalry'
export type FormationSide = 'attacker' | 'defender'
export type FormationStatus = 'idle' | 'moving' | 'engaged' | 'routed'

export type BattleFormation = {
  id: number
  battle_id: number
  owner_id: string
  side: FormationSide
  unit_type: FormationType
  initial_soldiers: number
  soldiers: number
  kills: number
  morale: number
  facing: number
  charge_ready: boolean
  x: number
  y: number
  target_x: number
  target_y: number
  target_formation_id: number | null
  status: FormationStatus
  damage_pool: number
  updated_at: string
}

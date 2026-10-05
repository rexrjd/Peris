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

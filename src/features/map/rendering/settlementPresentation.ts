import type { Building } from '../../city/domain/types'
import type { CitySlot } from '../../city/domain/slots'

export type SettlementMapStage = 1 | 2 | 3 | 4 | 5

const completedVisualLevel = (level: unknown): number => typeof level === 'number' && Number.isFinite(level) ? Math.max(0, Math.min(5, Math.floor(level))) : 0
const fixedTypes = new Set(['lumber', 'quarry', 'farm', 'market', 'wall', 'barracks', 'stables', 'storehouse'])
const slotTypes = new Set(['barracks', 'stables', 'smithy', 'warehouse', 'granary', 'fishery', 'mage_tower'])

/** Presentation only: the completed market determines the city's main-hall/footprint
 * stage, as in cityLayout. Every eight completed supporting visual levels can also
 * advance its strategic silhouette. A fixed divisor makes construction monotonic.
 * Explicit city slots replace legacy barracks/stables/storage; legacy storage maps
 * to both warehouse and granary, matching the city's existing slot migration.
 * Orders and resources are deliberately absent; an unknown public rival stays at 1.
 */
export function settlementMapDevelopment(buildings: readonly Building[], settlementId: number, citySlots?: readonly CitySlot[]): SettlementMapStage {
  if (!Number.isInteger(settlementId) || settlementId <= 0) return 1
  const fixed = new Map<string, number>(), slots = new Map<number, number>()
  for (const building of Array.isArray(buildings) ? buildings : []) {
    if (!building || building.settlement_id !== settlementId || !fixedTypes.has(building.building_type)) continue
    fixed.set(building.building_type, Math.max(fixed.get(building.building_type) ?? 0, completedVisualLevel(building.level)))
  }
  if (Array.isArray(citySlots)) for (const slot of citySlots) {
    if (!slot || slot.settlement_id !== settlementId || !slotTypes.has(slot.building_type) || !Number.isInteger(slot.slot_index) || slot.slot_index < 0 || slot.slot_index > 16) continue
    slots.set(slot.slot_index, Math.max(slots.get(slot.slot_index) ?? 0, completedVisualLevel(slot.level)))
  }
  let infrastructure = ['lumber', 'quarry', 'farm', 'wall'].reduce((sum, type) => sum + (fixed.get(type) ?? 0), 0)
  if (citySlots === undefined) infrastructure += (fixed.get('barracks') ?? 0) + (fixed.get('stables') ?? 0) + (fixed.get('storehouse') ?? 0) * 2
  else infrastructure += [...slots.values()].reduce((sum, level) => sum + level, 0)
  return Math.min(5, Math.max(1, fixed.get('market') ?? 0, 1 + Math.floor(infrastructure / 8))) as SettlementMapStage
}

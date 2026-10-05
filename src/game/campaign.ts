import type { Camp, World } from '../types/game'
import { soldierTotal } from './rules'
export const BRIEFINGS: Record<number, { chapter: string; story: string; tactic: string; recommended: number }> = {
  1: { chapter: 'A standard in the dust', story: 'For a generation, Peris has answered to no ruler. Begin where the old road meets the fields. Recover the standard, and give your people a reason to believe.', tactic: 'Your starting host is enough. Let infantry take the first contact, keep bowmen behind them, and send cavalry around the flank.', recommended: 160 },
  2: { chapter: 'The green silence', story: 'Beyond the crossroads, raiders shelter under the ancient oaks. The road north will stay closed until their bowmen are driven from the woodland.', tactic: 'Trees protect troops from arrows. Advance infantry through the woods while cavalry circles the open ground.', recommended: 230 },
  3: { chapter: 'Across the water', story: 'The stone bridge once carried grain to every village in the province. The river watch now takes a toll in blood. Open the crossing.', tactic: 'The bridge is your fastest crossing. Brace a line near its exit, then bring archers forward to cover the infantry.', recommended: 260 },
  4: { chapter: 'The high country', story: 'Veterans have made their last redoubt above the valley. Their banners can be seen from every western farm. Take the ridge and break their hold.', tactic: 'The ridge improves ranged attacks. Approach from more than one direction to avoid feeding troops into their firing line.', recommended: 380 },
  5: { chapter: 'The ash road', story: 'The Ashen Legion stands between your realm and the lost capital. This will be a battle of armies. Replace your losses, then march east.', tactic: 'Build a larger host with a protected archer line. Use Guard when their cavalry approaches; counter-charge after it commits.', recommended: 580 },
  6: { chapter: 'The last standard', story: 'The fallen capital has watched five banners return to your keeping. Its gates will open only when the last great rebel host is beaten. Finish what you began.', tactic: 'Bring a rested, reinforced legion. High ground, a steady infantry centre, and patient cavalry flanks decide this final field.', recommended: 820 },
}
export function conquered(world: World, playerId: string) { return new Set(world.progress.filter(p => p.owner_id === playerId && p.defeated > 0).map(p => p.camp_id)) }
export function nextCampaign(world: World, playerId: string) { const done = conquered(world, playerId); return world.camps.find(c => !done.has(c.id)) }
export function campaignRank(count: number) { return ['Frontier governor', 'Bearer of the standard', 'Warden of Oakwood', 'Keeper of the crossing', 'Lord of the high country', 'Commander of the province', 'Restorer of Peris'][Math.min(6, count)] }
export function readiness(world: World, playerId: string, camp: Camp) {
  const army = world.armies.find(a => a.owner_id === playerId)!, ratio = soldierTotal(army) / BRIEFINGS[camp.id].recommended
  return { ratio, label: ratio >= 1 ? 'Ready for the field' : ratio >= .78 ? 'A hard-fought battle' : 'Reinforcements advised', className: ratio >= 1 ? 'ready' : ratio >= .78 ? 'challenging' : 'danger' }
}
export function campaignKey(world: World) { return `${world.players[0]?.id}:${world.players[0]?.created_at}` }

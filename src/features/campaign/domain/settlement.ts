import { accrueResources } from '../../city/domain/economy';
import { completeUpgrade } from '../../city/domain/construction';
import { completeRecruit } from '../../army/domain/recruitment';
import { completeTravel } from '../../map/domain/movement';
import { type World } from '../../../shared/model/world';
import { completeMapField } from '../../map/domain/territory';
import { refreshCityEconomy } from '../../city/domain/slots';
import { accrueCulture, completeExpedition } from '../../empire/domain/expansion';

/** Complete all cities' queues in time order; every order belongs to one city/army. */
export function settleLocal(w: World, owner: string, now = Date.now(), travel = true) {
    const player = w.players.find(p => p.id === owner);
    if (!player) return;
    const events = [
        ...w.orders.filter(o => o.owner_id === owner && Date.parse(o.finish_at) <= now).map(order => ({ at: Date.parse(order.finish_at), order, expedition: undefined })),
        ...(w.settler_expeditions ?? []).filter(e => e.owner_id === owner && e.status === 'travelling' && Date.parse(e.arrival_at) <= now).map(expedition => ({ at: Date.parse(expedition.arrival_at), expedition, order: undefined })),
    ].sort((a, b) => a.at - b.at || (a.order?.id ?? a.expedition!.id) - (b.order?.id ?? b.expedition!.id));
    for (const event of events) {
        accrueCulture(w, owner, event.at);
        if (event.expedition) {
            const source = w.settlements.find(s => s.id === event.expedition!.origin_settlement_id);
            if (source) accrueResources(source, event.at);
            completeExpedition(w, event.expedition); continue;
        }
        const order = event.order!;
        const city = w.settlements.find(s => s.owner_id === owner && s.id === (order.settlement_id ?? w.settlements.find(s => s.owner_id === owner)?.id));
        if (!city) throw new Error('The city for this order is missing.');
        accrueResources(city, event.at);
        if (order.kind === 'field') { completeMapField(w, owner, order); refreshCityEconomy(w, city.id, city.population !== undefined); }
        else if (order.kind === 'upgrade') completeUpgrade(w, city, player, order);
        else if (order.kind === 'settler') city.settlers = (city.settlers ?? 0) + order.quantity;
        else {
            const army = w.armies.find(a => a.owner_id === owner && a.id === (order.army_id ?? w.armies.find(a => a.owner_id === owner)?.id));
            if (!army) throw new Error('The army for this training order is missing.');
            completeRecruit(army, player, order);
        }
        w.orders = w.orders.filter(o => o.id !== order.id);
    }
    accrueCulture(w, owner, now);
    for (const city of w.settlements.filter(s => s.owner_id === owner)) accrueResources(city, now);
    if (travel) for (const army of w.armies.filter(a => a.owner_id === owner)) completeTravel(army, now);
}

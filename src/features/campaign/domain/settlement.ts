import { accrueResources } from '../../city/domain/economy';
import { completeUpgrade } from '../../city/domain/construction';
import { completeRecruit } from '../../army/domain/recruitment';
import { completeTravel } from '../../map/domain/movement';
import { type World } from '../../../shared/model/world';
import { completeMapField } from '../../map/domain/territory';
import { refreshCityEconomy } from '../../city/domain/slots';
export function settleLocal(w: World, owner: string, now = Date.now()) {
    const s = w.settlements.find(s => s.owner_id === owner), p = w.players.find(p => p.id === owner), a = w.armies.find(a => a.owner_id === owner);
    if (!s || !p || !a)
        return;
    const done = w.orders.filter(o => o.owner_id === owner && Date.parse(o.finish_at) <= now).sort((a, b) => Date.parse(a.finish_at) - Date.parse(b.finish_at));
    for (const o of done) {
        accrueResources(s, Date.parse(o.finish_at));
        if (o.kind === 'field') {
            completeMapField(w, owner, o); refreshCityEconomy(w, s.id);
        } else if (o.kind === 'upgrade')
            completeUpgrade(w, s, p, o);
        else
            completeRecruit(a, p, o);
        w.orders = w.orders.filter(q => q.id !== o.id);
    }
    accrueResources(s, now);
    completeTravel(a, now);
}

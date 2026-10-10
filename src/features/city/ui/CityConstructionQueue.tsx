import type { Order } from '../../../shared/model/world';
import { BUILDINGS } from '../domain/buildings';
import type { BuildingType } from '../domain/types';
import { SLOT_BUILDINGS, type SlotType } from '../domain/slots';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';

export function constructionTarget(order: Order) {
    if (!order.item.startsWith('slot:')) return order.item;
    const index = order.item.split(':')[1];
    return index === '16' ? 'fishery' : `slot:${index}`;
}
export function constructionName(order: Order) {
    return order.item.startsWith('slot:') ? SLOT_BUILDINGS[order.item.split(':')[2] as SlotType]?.name ?? 'Building' : BUILDINGS[order.item as BuildingType]?.name ?? 'Building';
}
export function CityConstructionQueue({ order, level = 0, now, onSelect }: {
    order?: Order; level?: number; now: number; onSelect: (key: string) => void;
}) {
    if (!order) return <section className="village-construction" aria-label="Construction queue"><h3><Icon name="time" size={15}/>Construction</h3><p className="village-muted">Builders are available.</p><small>Choose a building or an empty plot to develop your village.</small></section>;
    const start = Date.parse(order.started_at), finish = Date.parse(order.finish_at);
    const progress = Math.max(0, Math.min(100, (now - start) / Math.max(1, finish - start) * 100));
    const completion = new Date(finish).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return <section className="village-construction is-working" aria-label="Construction queue"><h3><Icon name="time" size={15}/>Construction</h3>
        <button className="village-queue-open" onClick={() => onSelect(constructionTarget(order))} title={`Open ${constructionName(order)}. Resources were paid when construction began. One construction project can run in this village at a time.`}>
            <strong>{constructionName(order)}<span> → {level + 1}</span></strong><Icon name="arrow" size={14}/>
        </button>
        <div className="village-queue-progress" role="progressbar" aria-label="Construction progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{ width: `${progress}%` }}/></div>
        <div className="village-queue-time"><b title="Time until the completed level becomes available">{clock(Math.max(0, (finish - now) / 1000))}</b><time dateTime={order.finish_at} title={`Completion time in your local time zone: ${new Date(finish).toLocaleString()}`}>Done {completion}</time></div>
    </section>;
}

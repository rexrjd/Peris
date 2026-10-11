import type { BattleResult } from '../../battle/domain/types';
import { RESOURCES, type Resources } from '../../../shared/model/resources';
import { Cost } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { reportEconomics, type ReportSide } from '../domain/reportEconomics';

export function SignedResources({ values }: { values: Resources }) {
    return <span className="signed-resources">{RESOURCES.map(key => <span key={key} className={values[key] < 0 ? 'negative' : values[key] > 0 ? 'positive' : ''} title={`${key}: ${values[key] > 0 ? '+' : ''}${values[key].toLocaleString()}`}><Icon name={key} size={13}/><b>{values[key] > 0 ? '+' : ''}{values[key].toLocaleString()}</b></span>)}</span>;
}

export function ReportEconomics({ result, side = 'attacker', returning = false, compact = false }: {
    result: BattleResult; side?: ReportSide; returning?: boolean; compact?: boolean;
}) {
    const economics = reportEconomics(result, side);
    return <section className={`report-economics ${compact ? 'compact' : ''}`} aria-label="Raid economics">
        <div title="Resources needed to recruit the soldiers lost in this battle. Stored receipts preserve the prices at settlement."><span>Replacement cost</span>{economics.replacementCost ? <Cost cost={economics.replacementCost} compact showZero/> : <small>Troop identities not recorded</small>}</div>
        <div title="Resources actually delivered home minus the cost of replacing casualties. Travel and training time are excluded."><span>Net resources</span>{economics.profit ? <SignedResources values={economics.profit}/> : <small>{returning ? 'Available after return' : economics.deliveryUnrecorded ? 'Delivery not recorded yet' : 'Replacement cost unavailable'}</small>}</div>
        {!compact && economics.capacity !== null && <p title="The surviving party's maximum carrying capacity, before storage overflow.">Surviving carrying capacity: {economics.capacity.toLocaleString()} resources.</p>}
    </section>;
}

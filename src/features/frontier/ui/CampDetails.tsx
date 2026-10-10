import { CampGarrison } from './CampGarrison';
import type { CampView, FrontierSnapshot } from '../domain/types';
import { FACTIONS } from '../../factions/domain/factions';
import { CELL_SIZE } from '../../map/domain/dimensions';
import { FrontierDialog } from './FrontierDialog';
import { CampIcon } from './CampIcon';
import { Resources } from './Resources';
import { TroopSummary } from './Reports';
import { number, totalResources, totalTroops } from './format';

export function CampDetails({ camp, state, onClose, onRaid, onFarm, onCenter }: {
    camp: CampView; state: FrontierSnapshot; now: number; onClose: () => void;
    onRaid: () => void; onFarm: () => void; onCenter: () => void;
}) {
    const farm = state.farms.find(farm => farm.campId === camp.id);
    const list = state.farmLists.find(list => list.id === farm?.listId);
    const reports = state.reports.filter(raid => raid.campId === camp.id).slice(0, 5);
    const rules = state.config.tiers[camp.tier];
    return <FrontierDialog title={`${camp.name} (${camp.col}, ${camp.row})`} onClose={onClose} className="fw-camp-dialog">
        <div className="fw-camp-detail-grid"><div>
            <div className={`fw-camp-scene tier-${camp.tier}`}><CampIcon tier={camp.tier} /><span>{FACTIONS[camp.faction].name} mercenaries</span></div>
            <div className="fw-camp-options"><button className="fw-link-button" onClick={onCenter}>Center map here</button><button className="fw-button fw-button-primary" disabled={camp.distance === null} onClick={onRaid}>Prepare raid</button><button className="fw-button fw-button-secondary" onClick={onFarm}>{farm ? 'Edit farm target' : 'Add to farm list'}</button>{list && <small>Saved in {list.name} · {farm?.enabled ? 'Active' : 'Paused'}</small>}</div>
        </div><div className="fw-camp-facts"><span className={`fw-tag tier-${camp.tier}`}>{camp.tier} difficulty</span><h3>Stored resources</h3><Resources values={camp.resources} /><h3>Production / minute</h3><Resources values={rules.rates} /><h3>Storage capacity</h3><Resources values={rules.capacity} /><h3>Defenders</h3><CampGarrison troops={camp.defenders} faction={camp.faction} /><h3>Route distance</h3><p>{camp.distance === null ? 'No land route from your village' : `${(camp.distance / CELL_SIZE).toFixed(1)} tiles from ${state.village.name}`}</p></div></div>
        <p className="fw-small-note">Intelligence can change before arrival. All rulers share this stock; defender kills grant no extra resources.</p>
        <section className="fw-camp-recent" aria-label="Recent camp reports"><h3>Recent reports</h3><p className="fw-small-note">From your latest visible reports. Each farm list’s casualty preference applies.</p>
            {!reports.length && <p className="fw-empty">No visible reports for this camp yet.</p>}
            {reports.map(raid => raid.report && <details key={raid.id} className="fw-camp-receipt"><summary><strong>{raid.report.winner === 'attacker' ? 'Victory' : raid.report.winner === 'defender' ? 'Defeat' : 'Draw'}</strong><time>{new Date(raid.returnsAt).toLocaleString()}</time><span>{number(totalResources(raid.report.delivered ?? raid.report.loot))} loot · {totalTroops(raid.report.losses)} lost</span></summary><div><p>Your losses: <TroopSummary troops={raid.report.losses} faction={state.village.faction} /></p><p>Delivered: <Resources values={raid.report.delivered ?? raid.report.loot} /></p><p>Replacement cost: <Resources values={raid.report.replacementCost} /></p><p>Estimated profit: <Resources values={raid.report.estimatedProfit} signed /></p></div></details>)}
        </section>
    </FrontierDialog>;
}

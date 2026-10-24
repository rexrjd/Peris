import type { World } from '../../../shared/model/world';
import type { Report } from '../domain/types';
import { inboxReceipt } from '../domain/reportInbox';
import { reportIsReturning } from '../domain/reportEconomics';
import { Icon } from '../../../shared/ui/Icons';
import { Cost } from '../../../shared/ui/Shared';
import { TroopSummary } from '../../army/ui/TroopSummary';
import { HeroPortrait } from '../../heroes/ui/HeroPortrait';
import { ArtifactArt } from '../../heroes/ui/ArtifactArt';
import { ARTIFACTS } from '../../heroes/domain/heroes';
import { ARTIFACT_RARITY } from '../../heroes/domain/battleRewards';
import { ReportEconomics } from './ReportEconomics';
import { clock } from '../../../shared/time/clock';
import { SiegeSummary } from './SiegeSummary';
import {ConquestSummary} from './ConquestSummary';

export function ReportDetails({world, playerId, report, onLocate}: {
    world: World; playerId: string; report: Report; onLocate?: (camp: World['camps'][number]) => void;
}) {
    const receipt = inboxReceipt(world, report, playerId), result = report.result;
    const title = receipt.outcome === 'draw' ? 'Stalemate' : receipt.outcome === 'victory' ? 'Victory' : 'Defeat';
    const side = receipt.side, returning = reportIsReturning(world, report), reward = result.hero_reward;
    const loss = side ? result[`${side}_losses`] : null, survived = side ? result[`${side}_survivors`] : null;
    const troops = side ? result[`${side}_survivor_roster`] : null;
    return <div className="report-detail-body">
        <header className="report-detail-heading"><span className={`report-outcome outcome-${receipt.outcome}`}><Icon name={report.won ? 'check' : 'shield'} size={22}/></span><div><span className="report-detail-kicker">{side === 'defender' ? 'Defence' : side === 'attacker' ? 'Attack' : 'Battle report'} · {title}</span><h2>{receipt.title}</h2><p>{new Date(report.created_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}{receipt.camp && ` · Level ${receipt.camp.tier ?? 1}`}</p></div>{receipt.camp && onLocate && <button className="report-locate" onClick={()=>onLocate(receipt.camp!)} title="Find this camp on the map"><Icon name="focus" size={16}/>Map</button>}</header>
        <div className="report-key-stats">
            <div><small>Your losses</small><strong className={loss ? 'has-losses' : ''}>{loss?.toLocaleString() ?? '—'}</strong></div>
            <div><small>{side==='defender'&&result.raid_city?'Resources stolen':result.delivered ? 'Delivered' : returning ? 'Returning loot' : 'Recorded loot'}</small><strong>{receipt.loot.toLocaleString()}</strong></div>
            <div><small>Hero XP</small><strong>{receipt.experience ? `+${receipt.experience.toLocaleString()}` : '—'}</strong></div>
        </div>
        {reward && <section className="report-hero" aria-label="Hero experience"><HeroPortrait compact heroId={reward.hero_id} heroClass={reward.hero_class} faction={reward.faction ?? (side ? result[`${side}_faction`] : undefined)}/><div><strong>{reward.hero_name}</strong><small>Level {reward.level_after}{reward.level_after > reward.level_before ? ` · Promoted from level ${reward.level_before}` : ''}</small></div><b>+{reward.experience.toLocaleString()} XP</b></section>}
        {!!reward?.artifacts.length && <section className="report-equipment" aria-label="Equipment received"><h3>Equipment received <span>{reward.artifacts.length}</span></h3><div>{reward.artifacts.map(item=>{const artifact=ARTIFACTS[item.artifact_id];if(!artifact)return null;const rarity=ARTIFACT_RARITY[item.artifact_id as keyof typeof ARTIFACT_RARITY]??'Common';return <article key={item.id} title={artifact.description}><ArtifactArt artifactId={item.artifact_id}/><div><strong>{artifact.name}</strong><small className={`rarity-${rarity.toLowerCase()}`}>{rarity}</small></div></article>;})}</div><p>In your shared backpack. Equip from Armies.</p></section>}
        {reward?.inventory_full && <p className="report-note">Backpack full. No equipment was added.</p>}
        <SiegeSummary damage={result.siege_damage}/>
        <ConquestSummary conquest={result.conquest}/>
        <section className="report-resource-detail" aria-label="Resource delivery"><h3>{side==='defender'&&result.raid_city?'Taken from this city':result.delivered ? 'Delivered to your home city' : returning ? 'Travelling home' : 'Recorded spoils'}</h3><Cost cost={result.delivered ?? result.loot} compact showZero/>{side!=='defender'&&!result.delivered && receipt.loot > 0 && <p>{returning ? 'Final net resources are available after return.' : 'Home delivery is not recorded in this receipt.'}</p>}{Object.values(result.overflow ?? {}).some(value=>value>0) && <details><summary>Storage overflow</summary><Cost cost={result.overflow!} compact showZero/></details>}</section>
        {side && <ReportEconomics result={result} side={side} returning={returning && !result.delivered}/>}
        {side && <section className="report-troops" aria-label="Surviving troops"><h3>Surviving troops <span>{survived?.toLocaleString()}</span></h3>{troops ? <TroopSummary troops={troops} faction={result[`${side}_faction`]}/> : <p>Troop identities were not recorded.</p>}</section>}
        <details className="report-battle-facts"><summary>Battle details <span>{clock(result.duration)}</span><Icon name="chevron" size={14}/></summary><p>{result.reason}</p><div>{(['attacker','defender'] as const).map(force=><section key={force} aria-label={force==='attacker'?'Attacking forces':'Defending forces'}><h4>{force==='attacker'?'Attacking forces':'Defending forces'}</h4><dl><div><dt>Sent</dt><dd>{result[`${force}_initial`]?.toLocaleString() ?? '—'}</dd></div><div><dt>Survived</dt><dd>{result[`${force}_survivors`]?.toLocaleString() ?? '—'}</dd></div><div><dt>Lost</dt><dd>{result[`${force}_losses`]?.toLocaleString() ?? '—'}</dd></div></dl></section>)}</div>{!side && <p>This older receipt has no battle-side record. Forces are labelled by side.</p>}</details>
    </div>;
}

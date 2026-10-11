import { TroopSummary } from '../../army/ui/TroopSummary';
import { RECRUIT_UNITS } from '../../army/domain/roster';
import { factionTroopName } from '../../frontier/ui/roster';
import { type Battle, type BattleResult, type Formation } from '../../battle/domain/types';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { UNITS } from '../../army/domain/units';
import { Cost, Modal } from '../../../shared/ui/Shared';
import { useEffect, useState } from 'react';
import type { Report } from '../domain/types';
import { reportIsReturning, reportSide, visibleReports } from '../domain/reportEconomics';
import { ReportEconomics } from './ReportEconomics';
import { ReportLedger } from './ReportLedger';
import { type World } from '../../../shared/model/world';
import { type Command } from '../../../shared/model/commands';
import { campaignRank, conquered } from '../domain/progression';
import { QUESTS } from '../domain/quests';
import { ARTIFACTS, HERO_CLASSES, heroThreshold, MAX_HERO_LEVEL } from '../../heroes/domain/heroes';
import { ARTIFACT_RARITY } from '../../heroes/domain/battleRewards';
import { HeroPortrait } from '../../heroes/ui/HeroPortrait';
import { ArtifactArt } from '../../heroes/ui/ArtifactArt';
import { count } from '../../army/domain/commandRoom';
import '../styles/results.css';
export function ResultBody({ result, won, draw = false, side = 'attacker', enemyName, formations = [], practice = false, returning = false }: {
    result: BattleResult;
    won: boolean;
    draw?: boolean;
    side?: 'attacker' | 'defender';
    enemyName: string;
    formations?: Formation[];
    practice?: boolean;
    returning?: boolean;
}) {
    const loss = side === 'attacker' ? result.attacker_losses : result.defender_losses, enemyLoss = side === 'attacker' ? result.defender_losses : result.attacker_losses, survivors = side === 'attacker' ? result.attacker_survivors : result.defender_survivors;
    const initialRoster = side === 'attacker' ? result.attacker_roster : result.defender_roster, survivorRoster = side === 'attacker' ? result.attacker_survivor_roster : result.defender_survivor_roster, rosterFaction = side === 'attacker' ? result.attacker_faction : result.defender_faction;
    const title = draw ? 'Stalemate' : won ? 'Victory' : 'Defeat';
    const reward = !practice ? result.hero_reward : undefined;
    const levelled = reward && reward.level_after > reward.level_before;
    const atMax = reward && reward.level_after >= MAX_HERO_LEVEL;
    const floor = reward ? heroThreshold(reward.level_after) : 0, ceiling = reward ? heroThreshold(Math.min(MAX_HERO_LEVEL, reward.level_after + 1)) : 1;
    const progress = reward ? atMax ? 100 : Math.max(0, Math.min(100, (reward.experience_after - floor) / Math.max(1, ceiling - floor) * 100)) : 0;
    return <>
        <header className="battle-result-heading"><span className={`result-outcome ${won ? 'won' : ''}`}><Icon name={won ? 'check' : 'shield'} size={23}/></span><div><span className="result-kicker">BATTLE COMPLETE</span><h2>{title}</h2><p>{enemyName}</p></div></header>
        <div className="result-caption"><span><Icon name="time" size={13}/>{clock(result.duration)}</span><span>{result.reason === 'Army routed' ? won ? 'Enemy army routed' : 'Your army routed' : result.reason}</span></div>
        {reward && <section className="result-hero-reward" aria-label="Hero experience">
            <div className="result-hero-line"><HeroPortrait compact heroId={reward.hero_id} heroClass={reward.hero_class} faction={reward.faction}/><div><strong>{reward.hero_name}</strong><small>{HERO_CLASSES[reward.hero_class]?.name ?? 'Commander'} · Level {reward.level_after}</small>{levelled && <span className="result-level-up">Level {reward.level_before} → {reward.level_after}</span>}</div><span className="result-xp-gain"><b>+{count(reward.experience)}</b><small>Hero XP</small></span></div>
            <div className="result-xp-progress" role="progressbar" aria-label="Hero level progress" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><i style={{width:`${progress}%`}}/></div>
            <small className="result-xp-next">{atMax ? 'Maximum hero level reached' : `${count(reward.experience_after - floor)} / ${count(ceiling - floor)} XP to level ${reward.level_after + 1}`}{levelled ? ` · ${reward.level_after - reward.level_before} new skill ${reward.level_after - reward.level_before === 1 ? 'point' : 'points'}` : ''}</small>
        </section>}
        {won && reward && <section className="result-equipment" aria-label="Equipment received"><div className="result-section-heading"><h3>Equipment</h3><span>{reward.artifacts.length} {reward.artifacts.length === 1 ? 'item' : 'items'}</span></div>
            {reward.artifacts.map(item => {const artifact = ARTIFACTS[item.artifact_id];if (!artifact) return null;const rarity = ARTIFACT_RARITY[item.artifact_id as keyof typeof ARTIFACT_RARITY] ?? 'Common';return <article key={item.id} className={`result-artifact rarity-${rarity.toLowerCase()}`}><span className="result-artifact-icon"><ArtifactArt artifactId={item.artifact_id}/></span><div><strong>{artifact.name}</strong><small>{artifact.description}</small></div><span className="result-artifact-rarity">{rarity}</span></article>;})}
            <p>{reward.inventory_full ? 'Backpack full (200 items). No equipment was added.' : reward.artifacts.length ? 'Added to your shared backpack. Equip it from the army screen.' : 'No equipment received.'}</p>
        </section>}
        {won && Object.values(result.loot ?? {}).some(n => n > 0) && <section className="result-supplies" aria-label="Resource spoils"><h3>Resource spoils</h3><Cost cost={result.loot} compact/></section>}
        {survivorRoster && <section aria-label="Returned troops"><h3>Surviving troops</h3><TroopSummary troops={survivorRoster} faction={rosterFaction}/>{initialRoster && <details><summary>Losses by troop</summary>{RECRUIT_UNITS.filter(unit=>initialRoster![unit]>0).map(unit=><p key={unit}>{factionTroopName(rosterFaction??'roman',unit)}: {initialRoster![unit]-(survivorRoster[unit]??0)} lost</p>)}</details>}</section>}
        {result.delivered ? <section aria-label="Delivered spoils"><h3>Delivered to your home city</h3><Cost cost={result.delivered} compact/>{Object.values(result.overflow??{}).some(amount=>amount>0)&&<p>Storage overflow discarded<Cost cost={result.overflow!} compact/></p>}</section> : side === 'attacker' && Object.values(result.loot??{}).some(amount=>amount>0) && <p>{returning ? 'Spoils are travelling home with the legion.' : 'Home delivery is not recorded in this receipt.'}</p>}
        {!practice && (initialRoster || result.replacement_cost) && <ReportEconomics result={result} side={side} returning={side === 'attacker' && returning && !result.delivered}/>}
        <dl className="result-battle-totals"><div><dt>Survived</dt><dd>{count(survivors)}</dd></div><div className="result-losses"><dt>Your losses</dt><dd>{count(loss)}</dd></div><div><dt>Enemy losses</dt><dd>{count(enemyLoss)}</dd></div></dl>
        {formations.length > 0 && <details className="result-breakdown"><summary>Troop breakdown<Icon name="chevron" size={14}/></summary><div className="result-units">{(['infantry', 'archers', 'cavalry'] as const).filter(t => formations.some(f => f.unit_type === t)).map(t => {const list = formations.filter(f => f.unit_type === t);return <div key={t}><Icon name={t === 'infantry' ? 'shield' : t === 'archers' ? 'bow' : 'horse'} size={17}/><span><strong>{UNITS[t].name}</strong><small>{count(list.reduce((n,f)=>n+f.soldiers,0))} returned</small></span><b>{count(list.reduce((n,f)=>n+f.initial_soldiers-f.soldiers,0))}<small>lost</small></b></div>;})}</div></details>}
        {practice && <p className="result-practice-note">Practice battle · Your campaign is unaffected.</p>}
    </>;

}

/** Saved receipts remain inspectable after their tactical records are pruned. */
export function SavedReportDialog({ world, playerId, report, onClose, onReadReport }: { world: World; playerId: string; report: Report; onClose: () => void; onReadReport?: (battleId: number) => void }) {
    useEffect(() => {
        if (report.owner_id === playerId) onReadReport?.(report.battle_id);
    }, [report.battle_id, report.owner_id, playerId, onReadReport]);
    if (report.owner_id !== playerId) return null;
    const side = reportSide(world, report, playerId), battle = world.battles.find(row => row.id === report.battle_id);
    return <Modal title="Saved battle report" className="result-modal battle-rewards-modal rally-saved-report" onClose={onClose}>
        {side ? <ResultBody result={report.result} won={report.won} draw={battle?.winner_side === 'draw'} side={side} enemyName={report.title} returning={reportIsReturning(world, report)}/> : <>
            <h3>{report.title}</h3><p>{new Date(report.created_at).toLocaleString()} · {report.won ? 'Victory' : 'No victory'} · {clock(report.result.duration)}</p><p>{report.result.reason}</p>
            {(['attacker', 'defender'] as const).map(force => <section key={force} aria-label={force === 'attacker' ? 'Attacking forces' : 'Defending forces'}><h3>{force === 'attacker' ? 'Attacking forces' : 'Defending forces'}</h3><dl><div><dt>Sent</dt><dd>{report.result[`${force}_initial`]}</dd></div><div><dt>Survived</dt><dd>{report.result[`${force}_survivors`]}</dd></div><div><dt>Lost</dt><dd>{report.result[`${force}_losses`]}</dd></div></dl>{report.result[`${force}_survivor_roster`] && <TroopSummary troops={report.result[`${force}_survivor_roster`]!} faction={report.result[`${force}_faction`]}/>}</section>)}
            <section><h3>Resource spoils</h3><Cost cost={report.result.loot} compact showZero/></section><p>This receipt no longer has its original battle record. Forces are labelled by battle side.</p>
        </>}
        <div className="result-actions"><button className="button gold" onClick={onClose}>Back to reports</button></div>
    </Modal>;
}
export function Chronicle({ world, playerId, onReport, run, onEnding, onReadReport }: {
    world: World;
    playerId: string;
    onReport: (b: Battle) => void;
    run?: (c: Command, m?: string) => void;
    onEnding?: () => void;
    onReadReport?: (battleId: number) => void;
}) {
    const [savedReport, setSavedReport] = useState<Report | null>(null);
    const player = world.players.find(p => p.id === playerId)!, done = conquered(world, playerId), reports = visibleReports(world, playerId);
    const openReport = (report: Report) => {
        if (report.owner_id !== playerId) return;
        onReadReport?.(report.battle_id);
        const battle = world.battles.find(row => row.id === report.battle_id);
        if (battle && reportSide(world, report, playerId)) onReport({ ...battle, result: report.result }); else setSavedReport(report);
    };
    return <section className="chronicle"><div className="view-heading"><div><span className="eyebrow">THE CHRONICLE</span><h1>A name remembered</h1><p>{campaignRank(done.size)}. The record of a realm you built and the fields you commanded.</p></div><span className="tag">{player.prestige} prestige</span></div>
 {done.size === 6 && <div className="restored-banner"><Icon name="crown" size={42}/><div><span className="eyebrow">THE CAMPAIGN IS COMPLETE</span><h2>Peris restored</h2><p>All six standards have returned to your keeping.</p></div><button className="button gold" onClick={onEnding}>Relive the triumph <Icon name="arrow"/></button></div>}
 <div className="chronicle-metrics"><div><Icon name="crown"/><b>{player.victories}</b><span>Victories</span></div><div><Icon name="army"/><b>{player.recruits}</b><span>Soldiers trained</span></div><div><Icon name="town"/><b>{player.upgrades}</b><span>City upgrades</span></div><div><Icon name="flag"/><b>{done.size} / 6</b><span>Standards recovered</span></div></div>
 <div className="chronicle-objectives"><div className="reports-heading"><h3>Rewards for your realm</h3><span>Milestones</span></div><div className="milestone-grid">{QUESTS.map(q => { const claimed = world.claims.some(c => c.owner_id === playerId && c.quest_id === q.id), complete = player[q.stat] >= q.target; return <article key={q.id} className={claimed ? 'claimed' : complete ? 'claimable' : ''}><Icon name={claimed ? 'check' : q.id === 'builder' ? 'town' : q.id === 'recruiter' ? 'army' : 'crown'} size={26}/><h3>{q.title}</h3><p>{q.description}</p><div className="progress-track"><i style={{ width: `${Math.min(100, player[q.stat] / q.target * 100)}%` }}/></div><div className="milestone-meta"><span>{Math.min(q.target, player[q.stat])} / {q.target}</span><span>{claimed ? 'Collected' : `+${q.reward.gold} gold`}</span></div>{complete && !claimed && run && <button className="button gold" onClick={() => run({ type: 'claim', questId: q.id }, 'Milestone supplies collected')}>Collect supplies</button>}</article>; })}</div></div>
 <div className="reports-heading"><h3>Fields of battle</h3><span>{reports.length} reports</span></div><ReportLedger world={world} playerId={playerId} onOpen={openReport}/>{savedReport && <SavedReportDialog world={world} playerId={playerId} report={savedReport} onClose={() => setSavedReport(null)}/>}
 </section>;
}

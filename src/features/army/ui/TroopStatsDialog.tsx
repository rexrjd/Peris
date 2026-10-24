import { useEffect, useRef } from 'react';
import type { World } from '../../../shared/model/world';
import type { Army } from '../domain/types';
import type { Settlement } from '../../city/domain/types';
import { RECRUIT_UNITS, type RecruitUnit } from '../domain/roster';
import { troopDetails } from '../domain/troopDetails';
import { armyFaction } from '../domain/faction';
import { FACTIONS } from '../../factions/domain/factions';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
import {trainingBuildingName} from '../domain/trainingBuildings';
import {visibleRecruitUnits} from './visibleRecruitUnits';
import { Modal } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { RESOURCES } from '../../../shared/model/resources';
import { clock } from '../../../shared/time/clock';
import { useResearchNavigation } from '../../research/ui/ResearchNavigation';
import { TROOP_PRESENTATION, troopMultiplier, troopNumber } from './troopPresentation';
import { troopCardStats } from '../domain/troopCardStats';
import { TroopStatSummary } from './TroopStatSummary';
import {UNIT_CROP_PER_HOUR} from '../../city/domain/troopSupply';

export function TroopStatsDialog({ world, army, city, unit, now, onClose, onUnit, onRecruit }: {
    world: World; army: Army; city: Settlement; unit: RecruitUnit; now: number;
    onClose: () => void; onUnit: (unit: RecruitUnit) => void; onRecruit: (unit: RecruitUnit) => void;
}) {
    const faction = armyFaction(world, army), name = factionTroopName(faction, unit);
    const stats = troopDetails(world, army, city, unit, now), { rule, plan } = stats;
    const cardStats = troopCardStats(world, army, city, unit, now);
    const presentation = TROOP_PRESENTATION[unit], openResearch = useResearchNavigation();
    const units=visibleRecruitUnits(world),index = units.indexOf(unit), siege = unit === 'ram' || unit === 'catapult';
    const heading = useRef<HTMLElement>(null);
    useEffect(() => { const panel = heading.current?.closest('.army-troop-modal'); if (panel) panel.scrollTop = 0; }, [unit]);
    const rows = [
        ...(world.troop_upkeep_version===1?[{label:'Crop upkeep',icon:'food',base:`${UNIT_CROP_PER_HOUR[unit]} / hour`,current:`${UNIT_CROP_PER_HOUR[unit]} / hour`,help:'Crop consumed per soldier per game hour. Empty reserves cause starvation when production cannot cover upkeep.'}]:[]),
        { label: 'Battle speed', icon: 'horse', base: `${troopNumber(rule.speed)} /s`, current: `${troopNumber(stats.speed)} /s`, help: 'Tactical distance per second on open ground. World travel uses the slowest troop, commander and research.' },
        { label: 'Attack range', icon: 'bow', base: stats.range ? troopNumber(stats.range) : 'Contact', current: stats.range ? troopNumber(stats.range) : 'Contact', help: 'Ranged distance in tactical units. Melee reach depends on formation size.' },
        { label: 'Loot capacity', icon: 'gold', base: troopNumber(rule.carry), current: troopNumber(stats.carry), help: 'Resources carried per surviving soldier, including account carry research.' },
        { label: 'Hero morale', icon: 'flag', base: '+0', current: `+${troopNumber(stats.commander.morale)}`, help: 'Commander morale bonus. Starting morale also depends on the battle and walls.' },
    ];
    return <Modal title={`${name} stats`} heading={false} className="army-troop-modal" backdropClassName="army-troop-backdrop" onClose={onClose}>
        <header ref={heading} className="troop-dossier-heading">
            <TroopIcon faction={faction} unit={unit} portrait/>
            <div><span>{FACTIONS[faction].name} · {presentation.category}</span><h2>{name}</h2><p>{presentation.description}</p><small><b>{troopNumber(stats.count)}</b> in {army.name}</small></div>
        </header>
        <section className="troop-dossier-combat" aria-label="Troop combat stats">
            <TroopStatSummary {...cardStats}/>
            <div className="troop-stat-head"><span>Combat & supply</span><span>Base</span><span>Army</span></div>
            <dl>{rows.map(row => <div key={row.label} title={row.help}><dt><Icon name={row.icon} size={15}/>{row.label}</dt><dd>{row.base}</dd><dd>{row.current}</dd></div>)}</dl>
            <p className="troop-stat-note">Infantry reference: 100 attack / 100 protection. Faction doctrine: {troopNumber(stats.factionAttackPoints)} / {troopNumber(stats.factionProtectionPoints)}. Attack and defence points include faction, research, commander equipment and home-city bonuses.{cardStats.source === 'battle' ? ' Current values use live formations and spells; ranges mean formations have different bonuses.' : ' Current values show this army’s permanent bonuses.'} Terrain, stance and the opponent also affect each hit.</p>
        </section>
        <section className="troop-dossier-recruit" aria-label="Troop recruitment requirements">
            <header><h3>Recruitment</h3><span>{stats.unlocked ? 'Unlocked' : 'Research required'}</span></header>
            <dl><div><dt>Training building</dt><dd>{trainingBuildingName(rule.building)} <small>{plan.level ? `Lv. ${plan.level}` : `Required · Lv. ${unit==='diplomat'?2:1}`}</small></dd></div><div><dt>Train 10 soldiers</dt><dd>{clock(stats.trainTenSeconds, world.game_clock?.rate ?? 1)}<small>{city.name}</small></dd></div></dl>
            <p className="troop-cost-caption">Cost per soldier</p><div className="troop-unit-cost" aria-label="Recruitment cost per soldier">{RESOURCES.map(resource => <span key={resource} title={`${resource} per soldier`}><Icon name={resource} size={16}/><b>{rule.cost[resource]}</b><small>{resource === 'wood' ? 'Timber' : resource[0].toUpperCase() + resource.slice(1)}</small></span>)}</div>
            {!stats.unlocked && <p className="troop-unlock-note"><Icon name="book" size={15}/><span>{stats.technology?.name ?? 'Unit research'}<small>{stats.technology ? `${stats.technology.cost} science · ${clock(stats.technology.seconds, world.game_clock?.rate ?? 1)} base research time` : 'Complete unit research to recruit.'}</small></span></p>}
        </section>
        <details className="troop-combat-details"><summary>More combat details<Icon name="chevron" size={14}/></summary><dl>
            <div><dt>Base damage rate</dt><dd>{troopNumber(stats.attackRate)} /s</dd></div>
            <div><dt>Starting stamina</dt><dd>100</dd></div>
            <div><dt>Retreat threshold</dt><dd>Morale below 18</dd></div>
            <div><dt>Commander attack / defence</dt><dd>{troopMultiplier(stats.commander.damage)} / {troopMultiplier(stats.commander.protection)}</dd></div>
            <div><dt>Home-city smithies</dt><dd>{troopMultiplier(stats.smithy)} attack</dd></div>
            <div><dt>Research attack / defence</dt><dd>{troopMultiplier(stats.attack / (rule.attack * (stats.factionAttackPoints/stats.baseAttackPoints) * stats.commander.damage * stats.smithy))} / {troopMultiplier(stats.defence / (rule.defence * (stats.factionProtectionPoints/stats.baseProtectionPoints) * stats.commander.protection))}</dd></div>
            <div><dt>Attack point scale</dt><dd>100 = base infantry damage rate</dd></div>
            {siege && <div><dt>Siege research</dt><dd>{troopMultiplier(stats.siege)} engines</dd></div>}
        </dl><p>Damage rate is the class coefficient per soldier before combat modifiers. Casualties depend on the opponent and formation; soldiers do not have a separate health stat.{siege && ` ${unit === 'ram' ? 'Wall' : 'Building'} damage can remove up to two levels per assault, depending on engine count and target level.`}</p></details>
        <footer className="troop-dossier-footer"><div className="troop-browse"><button aria-label="Previous troop type" onClick={() => onUnit(units[(index + units.length - 1) % units.length])}><Icon name="arrow" size={16}/></button><span>{index + 1} / {units.length}</span><button aria-label="Next troop type" onClick={() => onUnit(units[(index + 1) % units.length])}><Icon name="arrow" size={16}/></button></div><button className="troop-dossier-action" onClick={() => { if (stats.unlocked) onRecruit(unit); else { onClose(); openResearch(stats.technology?.id); } }}><Icon name={stats.unlocked ? 'plus' : 'book'} size={16}/>{stats.unlocked ? 'Recruit this troop' : 'Unlock in Research'}</button></footer>
    </Modal>;

}

import type { World } from '../../../shared/model/world';
import type { Army } from '../domain/types';
import { armyOverview, count, percent } from '../domain/commandRoom';
import { HERO_CLASSES, heroForArmy, heroLevel, heroPoints, heroThreshold, MAX_HERO_LEVEL } from '../../heroes/domain/heroes';
import { HeroPortrait } from '../../heroes/ui/HeroPortrait';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { armyPosition } from '../../map/domain/movement';
import { CELL_SIZE, wrapWorldCell } from '../../map/domain/dimensions';

/** A single identity and live summary shared by every management tab. */
export function ArmyCommanderCard({ world, army, info, now, busy, onMap, onCommander }: {
    world: World; army: Army; info: ReturnType<typeof armyOverview>; now: number; busy: boolean;
    onMap?: (id: number, orders?: boolean) => void; onCommander: () => void;
}) {
    const hero = heroForArmy(world, army.id), level = hero ? heroLevel(hero) : 1;
    const points = hero ? Math.max(0, heroPoints(hero)) : 0;
    const earned = hero ? hero.experience - heroThreshold(level) : 0;
    const needed = level < MAX_HERO_LEVEL ? heroThreshold(level + 1) - heroThreshold(level) : 1;
    const progress = level === MAX_HERO_LEVEL ? 100 : Math.max(0, Math.min(100, earned / needed * 100));
    const position = armyPosition(army, now), field = wrapWorldCell(Math.floor(position.x / CELL_SIZE), Math.floor(position.y / CELL_SIZE));
    return <aside className="army-commander-card" aria-label="Selected army">
        <div className="army-commander-face"><HeroPortrait heroId={hero?.id} heroClass={hero?.class} faction={info.home?.faction}/>{hero && <span className="army-commander-rank">Lv. {level}</span>}</div>
        <div className="army-commander-identity"><span className="army-commander-class" title={hero ? HERO_CLASSES[hero.class].description : undefined}>{hero ? HERO_CLASSES[hero.class].name : 'Uncommanded army'}</span><h2 title={hero?.name ?? army.name}>{hero?.name ?? army.name}</h2><p title={army.name}>{hero ? army.name : 'Independent army'}</p><span className={`army-live-status status-${info.state.toLowerCase().replace(' ', '-')}`}><i/>{info.state}{army.status === 'moving' && <time>{clock(info.arrival)}</time>}</span></div>
        {hero && <div className="army-commander-xp"><div><span>{level === MAX_HERO_LEVEL ? 'Maximum level' : `Next level · ${level + 1}`}</span><strong>{level === MAX_HERO_LEVEL ? `${count(hero.experience)} XP` : `${count(earned)} / ${count(needed)} XP`}</strong></div><div role="progressbar" aria-label="Hero level progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}><i style={{ width: `${progress}%` }}/></div></div>}
        <dl className="army-commander-summary"><div><dt><Icon name="army" size={15}/>Soldiers</dt><dd>{count(info.total)}<small> / 1,000</small></dd></div><div title="Hero damage multiplied by home city smithies"><dt><Icon name="shield" size={15}/>Troop damage</dt><dd>+{percent(info.damage - 1)}</dd></div><div><dt><Icon name="horse" size={15}/>March speed</dt><dd>+{percent(info.bonuses.speed - 1)}</dd></div></dl>
        <div className="army-commander-location"><Icon name="flag" size={15}/><span>{info.local?.name ?? `Field ${field.col}, ${field.row}`}<small>{info.local?.id === info.home?.id ? 'Home station' : `Home · ${info.home?.name ?? 'Unassigned'}`}</small></span>{onMap && <button aria-label="Locate on map" title="Locate on map" onClick={() => onMap(army.id)}><Icon name="focus" size={16}/></button>}</div>
        {points > 0 && <button className="army-skill-notice" onClick={onCommander}><Icon name="sparkles" size={15}/><span>{points} skill {points === 1 ? 'point' : 'points'} to spend</span><Icon name="arrow" size={13}/></button>}
        {onMap && <button className="command-button primary army-orders-button" aria-label={army.status === 'moving' ? 'View march' : 'Give orders'} disabled={busy || !!info.orders.length} title={info.orders.length ? 'Finish training before marching' : 'Open this army on the map'} onClick={() => onMap(army.id, army.status === 'idle')}><span>{army.status === 'moving' ? 'View march' : 'Give orders'}</span><Icon name="arrow" size={16}/></button>}
    </aside>;
}

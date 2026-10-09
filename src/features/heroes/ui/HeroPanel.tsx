import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import type { Army } from '../../army/domain/types';
import { HERO_CLASSES, HERO_STATS, ARTIFACTS, heroForArmy, heroLevel, heroPoints, heroThreshold, MAX_HERO_LEVEL } from '../domain/heroes';
import { HeroPortrait } from './HeroPortrait';
import { armyOverview, STAT_NAMES, percent, count } from '../../army/domain/commandRoom';
import { Icon } from '../../../shared/ui/Icons';
import { SPELLS, towerLevel, maximumMana, knowsSpell } from '../../magic/domain/spells';

export function HeroPanel({ world, army, run, busy, now, onCity }: { world: World; army: Army; run: (cmd: Command, message?: string) => void; busy: boolean; now: number; onCity?: (id: number) => void }) {
    const hero = heroForArmy(world, army.id), overview = armyOverview(world, army, now);
    if (!hero) return <div className="command-empty"><Icon name="crown" size={34}/><h2>No commander assigned</h2><p>This army can still recruit and march. Raise a new army to choose a specialist commander.</p></div>;
    const level = heroLevel(hero), points = heroPoints(hero), base = HERO_CLASSES[hero.class], bonuses = overview.bonuses;
    const earned = hero.experience - heroThreshold(level), needed = level < MAX_HERO_LEVEL ? heroThreshold(level + 1) - heroThreshold(level) : 1;
    const progress = level === MAX_HERO_LEVEL ? 100 : Math.max(0, Math.min(100, earned / needed * 100));
    const cities = world.settlements.filter(s => s.owner_id === army.owner_id);
    const spells = SPELLS.filter(spell => cities.some(s => towerLevel(world, s.id) >= spell.level && knowsSpell(world, s.id, spell.id)));
    const towerCity = [...cities].sort((a, b) => towerLevel(world, b.id) - towerLevel(world, a.id))[0];
    const mana = maximumMana(towerCity ? towerLevel(world, towerCity.id) : 0) + bonuses.mana;
    const effects = { attack: 'Each point adds 2% troop damage.', defence: 'Each point adds 2.5% to damage protection.', power: 'Each point adds 8% to spell damage and healing.', knowledge: 'Each point adds 10 battle mana.' };
    return <div className="commander-layout">
        <aside className="commander-dossier command-panel"><HeroPortrait heroClass={hero.class} faction={overview.home?.faction}/><span className="command-kicker">{base.name} · Level {level}</span><h2>{hero.name}</h2><p>{base.description}</p>
            <div className="command-xp"><div><span>{level === MAX_HERO_LEVEL ? 'Maximum level' : `Next rank · Level ${level + 1}`}</span><b>{level === MAX_HERO_LEVEL ? count(hero.experience) + ' XP' : `${count(earned)} / ${count(needed)} XP`}</b></div><div className="command-meter"><i style={{ width: `${progress}%` }}/></div><small>{count(hero.experience)} lifetime XP · Battles and victories earn experience.</small></div>
            <div className={`command-point-notice ${points > 0 ? 'available' : ''}`}><Icon name="sparkles"/><span>{points > 0 ? `${points} skill ${points === 1 ? 'point' : 'points'} to spend` : level === MAX_HERO_LEVEL ? 'All skill points spent' : 'Win battles to earn skill points'}</span></div>
        </aside>
        <div className="commander-development"><section className="command-panel"><div className="command-section-heading"><div><span className="command-kicker">Build your commander</span><h2>Four paths. Your choice.</h2></div><span className="command-pill">{Math.max(0, points)} points</span></div>
            <div className="command-attributes">{HERO_STATS.map(stat => {
                const items = (world.hero_artifacts ?? []).filter(a => a.hero_id === hero.id && a.owner_id === hero.owner_id).reduce((n, a) => n + (ARTIFACTS[a.artifact_id]?.[stat] ?? 0), 0);
                return <article key={stat}><div className="attribute-top"><Icon name={stat === 'attack' ? 'army' : stat === 'defence' ? 'shield' : stat === 'power' ? 'sparkles' : 'book'}/><span>{STAT_NAMES[stat]}</span><strong>{bonuses[stat]}</strong></div><p>{effects[stat]}</p><small>{base[stat]} class + {hero[stat]} trained + {items} equipment</small><button className="command-button secondary" disabled={busy || points < 1} onClick={() => run({ type: 'heroSkill', armyId: army.id, heroId: hero.id, stat }, `${hero.name} improved ${STAT_NAMES[stat].toLowerCase()}`)}><Icon name="plus" size={15}/>Improve {STAT_NAMES[stat].toLowerCase()}</button></article>;
            })}</div>
        </section>
        <section className="command-panel"><div className="command-section-heading"><div><span className="command-kicker">What your hero gives this army</span><h2>Command effects</h2></div></div><div className="command-effects"><div><Icon name="army"/><strong>+{percent(bonuses.damage - 1)}</strong><small>Troop damage</small></div><div><Icon name="shield"/><strong>{percent(1 - 1 / bonuses.protection)}</strong><small>Less damage taken</small></div><div><Icon name="horse"/><strong>+{percent(bonuses.speed - 1)}</strong><small>March speed</small></div><div><Icon name="sparkles"/><strong>+{percent(bonuses.spell - 1)}</strong><small>Spell damage &amp; healing</small></div></div></section>
        <section className="command-panel commander-spellbook"><div className="command-section-heading"><div><span className="command-kicker">Magic from your empire</span><h2>Spellbook <small>{spells.length} researched</small></h2></div><span className="command-pill"><Icon name="sparkles" size={14}/>{mana} battle mana</span></div>
            {spells.length ? <div className="command-spells">{spells.map(spell => <div key={spell.id} title={spell.description}><span className={`spell-school school-${spell.school.toLowerCase()}`}><Icon name="sparkles" size={16}/></span><span><strong>{spell.name}</strong><small>{spell.school} · {spell.mana} mana</small></span></div>)}</div> : <p className="command-muted">Build a mage tower and research spells in your cities. Any hero can cast your empire’s researched spells during battle.</p>}
            <div className="command-inline-footer"><small>{bonuses.mana} mana from Knowledge + {mana - bonuses.mana} from your strongest tower.</small>{towerCity && onCity && <button className="command-text-button" onClick={() => onCity(towerCity.id)}>Develop magic in {towerCity.name}<Icon name="arrow" size={15}/></button>}</div>
        </section></div>
    </div>;
}

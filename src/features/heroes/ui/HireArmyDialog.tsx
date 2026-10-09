import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import { armyLimit, HERO_CLASSES, HERO_COST, heroForArmy, type HeroClass } from '../domain/heroes';
import { HeroPortrait } from './HeroPortrait';
import { Modal } from '../../../shared/ui/Shared';
import { Icon } from '../../../shared/ui/Icons';
import { liveResources } from '../../city/domain/economy';

export function HireArmyDialog({ world, owner, cityId, now, busy, run, onClose, onCreated }: { world: World; owner: string; cityId: number; now: number; busy: boolean; run: (cmd: Command, message?: string) => void; onClose: () => void; onCreated: (id: number) => void }) {
    const [name, setName] = useState(''), [heroClass, setClass] = useState<HeroClass>('knight'), [chosenCity, setCity] = useState(cityId);
    const [pending, setPending] = useState<{ ids: number[]; name: string; heroClass: HeroClass }>();
    const cities = world.settlements.filter(s => s.owner_id === owner), city = cities.find(s => s.id === chosenCity) ?? cities[0];
    const armies = world.armies.filter(a => a.owner_id === owner), limit = armyLimit(world, owner), gold = city ? liveResources(city, now).gold : 0;
    useEffect(() => { if (!pending) return; const created = armies.find(a => { const hero = heroForArmy(world, a.id); return !pending.ids.includes(a.id) && hero?.name === pending.name && hero.class === pending.heroClass; }); if (created) onCreated(created.id); }, [world, pending]);
    const reason = !city ? 'Found a city before raising an army.' : armies.length >= limit ? 'Found another city to support more armies.' : gold < HERO_COST ? `${city.name} needs ${Math.ceil(HERO_COST - gold)} more gold.` : name.trim().length < 2 || name.trim().length > 24 ? 'Give your commander a name of 2–24 characters.' : null;
    const dialog = <Modal title="Raise a new army" className="raise-army-modal army-command-dialog" heading={false} onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (reason || busy || !city) return; setPending({ ids: armies.map(a => a.id), name: name.trim(), heroClass }); run({ type: 'recruitHero', settlementId: city.id, name: name.trim(), heroClass }, `${name.trim()} raised a new army`); }}>
        <div className="raise-army-heading"><span className="command-kicker">A new banner for your empire</span><h2>Choose your commander.</h2><p>Every army has a hero. Pick the way you want to fight.</p></div>
        <div className="raise-class-picker" role="group" aria-label="Commander class">{(Object.keys(HERO_CLASSES) as HeroClass[]).map(key => <button key={key} type="button" aria-pressed={heroClass === key} onClick={() => setClass(key)}><HeroPortrait heroClass={key} faction={city?.faction}/><strong>{HERO_CLASSES[key].name}</strong><small>{HERO_CLASSES[key].description}</small><span>{key === 'knight' ? '3 Attack · 2 Defence' : key === 'ranger' ? '+10% march speed' : '3 Power · 2 Knowledge'}</span></button>)}</div>
        <div className="raise-army-fields"><label>Commander name<input autoComplete="off" placeholder="e.g. Astra the Ashen" value={name} required minLength={2} maxLength={24} onChange={event => setName(event.target.value)}/></label><label>Raise in city<select aria-label="City for new army" value={city?.id ?? ''} onChange={event => setCity(Number(event.target.value))}>{cities.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
        <div className="command-note"><Icon name="army"/><p>Your new army starts with no soldiers. Recruit in its city or transfer troops from an army nearby.</p></div>
        <footer className="raise-army-footer"><div><strong>{armies.length} / {limit} armies raised</strong><small>Each city supports two armies.</small></div><button className="command-button primary" type="submit" disabled={busy || !!reason}>Raise army · {HERO_COST} gold<Icon name="arrow" size={17}/></button><p className="raise-army-reason">{busy ? 'Raising your army…' : reason ?? `${Math.floor(gold).toLocaleString()} gold in ${city?.name}`}</p></footer>
    </form></Modal>;
    return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

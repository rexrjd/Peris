import { useState } from 'react';
import type { World } from '../../../shared/model/world';
import type { Command } from '../../../shared/model/commands';
import type { Army } from '../../army/domain/types';
import { ARTIFACTS, EQUIPMENT_SLOTS, HERO_STATS, heroForArmy, type EquipmentSlot } from '../domain/heroes';
import { ArtifactGlyph } from './HeroPortrait';
import { SLOT_NAMES, STAT_NAMES, percent } from '../../army/domain/commandRoom';
import { Icon } from '../../../shared/ui/Icons';

export function EquipmentPanel({ world, army, run, busy, onArmy }: { world: World; army: Army; run: (cmd: Command, message?: string) => void; busy: boolean; onArmy?: (id: number) => void }) {
    const [slot, setSlot] = useState<EquipmentSlot>('weapon'), [chosen, setChosen] = useState<number>();
    const hero = heroForArmy(world, army.id), inventory = (world.hero_artifacts ?? []).filter(a => a.owner_id === army.owner_id && ARTIFACTS[a.artifact_id]);
    if (!hero) return <div className="command-empty"><Icon name="shield" size={34}/><h2>A hero is needed to equip artifacts</h2><p>Raise an army with a commander to start building a loadout.</p></div>;
    const equipped = inventory.find(a => a.hero_id === hero.id && ARTIFACTS[a.artifact_id].slot === slot);
    const items = inventory.filter(a => ARTIFACTS[a.artifact_id].slot === slot);
    const item = items.find(a => a.id === chosen) ?? equipped ?? items.find(a => a.hero_id === null) ?? items[0];
    const meta = item ? ARTIFACTS[item.artifact_id] : undefined, current = equipped ? ARTIFACTS[equipped.artifact_id] : undefined;
    const holder = item?.hero_id != null && item.hero_id !== hero.id ? world.heroes?.find(h => h.id === item.hero_id) : undefined;
    const unavailable = !!item && item.hero_id !== null && item.hero_id !== hero.id;
    const isEquipped = item?.id === equipped?.id && !!item;
    return <div className="equipment-layout"><section className="command-panel command-loadout"><div className="command-section-heading"><div><span className="command-kicker">{hero.name}</span><h2>Equipped artifacts</h2></div><span className="command-pill">{inventory.filter(a => a.hero_id === hero.id).length} / 5</span></div>
        <p className="command-muted">Choose a slot to browse your empire’s artifacts.</p><div className="command-equipment-slots">{EQUIPMENT_SLOTS.map(key => { const own = inventory.find(a => a.hero_id === hero.id && ARTIFACTS[a.artifact_id].slot === key), info = own ? ARTIFACTS[own.artifact_id] : null; return <button key={key} aria-pressed={slot === key} onClick={() => { setSlot(key); setChosen(undefined); }}><ArtifactGlyph slot={key} magic={!!info?.power}/><span><small>{SLOT_NAMES[key]}</small><strong>{info?.name ?? 'Empty slot'}</strong><em>{info?.description ?? 'No bonus equipped'}</em></span><Icon name="arrow" size={16}/></button>; })}</div>
        <div className="command-note"><Icon name="flag" size={18}/><p>First victories at campaign landmarks award artifacts. Your backpack is shared by all heroes.</p></div>
    </section><section className="command-panel command-backpack"><div className="command-section-heading"><div><span className="command-kicker">Shared backpack · {inventory.length} artifacts</span><h2>{SLOT_NAMES[slot]} artifacts</h2></div><span className="command-pill">{items.length} found</span></div>
        {items.length ? <><div className="command-artifact-grid">{items.map(entry => { const info = ARTIFACTS[entry.artifact_id], carrier = world.heroes?.find(h => h.id === entry.hero_id); return <button key={entry.id} aria-pressed={item?.id === entry.id} onClick={() => setChosen(entry.id)}><ArtifactGlyph slot={slot} magic={!!info.power}/><strong>{info.name}</strong><small>{info.description}</small><span className={entry.hero_id === hero.id ? 'equipped' : ''}>{entry.hero_id === hero.id ? 'Equipped' : carrier ? `With ${carrier.name}` : entry.hero_id !== null ? 'With another hero' : 'Available'}</span></button>; })}</div>
            {meta && <div className="command-artifact-detail"><div><ArtifactGlyph slot={slot} magic={!!meta.power}/><span><span className="command-kicker">{isEquipped ? 'Current artifact' : 'Selected artifact'}</span><h3>{meta.name}</h3><p>{meta.description}</p></span></div>
                {!isEquipped && <><small className="command-muted">Change compared with {current?.name ?? 'an empty slot'}</small><div className="artifact-comparison">{HERO_STATS.map(stat => { const change = (meta[stat] ?? 0) - (current?.[stat] ?? 0); return change ? <span key={stat} className={change < 0 ? 'loss' : 'gain'}>{STAT_NAMES[stat]} <b>{change > 0 ? '+' : ''}{change}</b></span> : null; })}{(meta.speed ?? 0) !== (current?.speed ?? 0) && <span className={(meta.speed ?? 0) < (current?.speed ?? 0) ? 'loss' : 'gain'}>March speed <b>{(meta.speed ?? 0) > (current?.speed ?? 0) ? '+' : '−'}{percent(Math.abs((meta.speed ?? 0) - (current?.speed ?? 0)))}</b></span>}</div></>}
                {unavailable ? <div className="command-note"><p>{holder?.name ?? 'Another hero'} is carrying this artifact. Unequip it there to make it available.</p>{holder && onArmy && <button className="command-text-button" onClick={() => onArmy(holder.army_id)}>View hero<Icon name="arrow" size={15}/></button>}</div> : <button className={`command-button ${isEquipped ? 'secondary' : 'primary'}`} disabled={busy} onClick={() => run({ type: 'equipArtifact', armyId: army.id, heroId: hero.id, artifactId: item!.id, equip: !isEquipped }, isEquipped ? `${meta.name} returned to the backpack` : `${hero.name} equipped ${meta.name}`)}>{isEquipped ? 'Return to backpack' : `Equip ${meta.name}`}<Icon name={isEquipped ? 'download' : 'check'} size={16}/></button>}
            </div>}
        </> : <div className="command-empty"><ArtifactGlyph slot={slot}/><h3>No {SLOT_NAMES[slot].toLowerCase()} artifacts yet</h3><p>Defeat campaign landmarks to discover equipment. Your artifacts will appear here, ready to equip.</p></div>}
    </section></div>;
}

import type { Faction } from '../../factions/domain/factions';
import { Modal } from '../../../shared/ui/Shared';
import { RALLY_FACTION_ORDER, RALLY_FACTION_THEMES, rallyFactionArt } from './rallyFactionTheme';

export function RallyThemeChooser({ faction, onSelect, onClose }: {
    faction: Faction;
    onSelect: (faction: Faction | undefined) => void;
    onClose: () => void;
}) {
    return <Modal title="Rally Point appearances" className="rp-faction-picker-modal" onClose={onClose}>
        <p>Choose an appearance for this screen.</p>
        <button className="button outline" onClick={() => onSelect(undefined)}>Follow city faction</button>
        <div className="rp-faction-gallery">{RALLY_FACTION_ORDER.map(id => {
            const theme = RALLY_FACTION_THEMES[id], Crest = theme.crest;
            return <button key={id} className="rp-faction-card" aria-label={`${theme.name} appearance`} aria-pressed={id === faction} onClick={() => onSelect(id)}>
                <img src={rallyFactionArt(id, 'background')} alt="" width={1672} height={941} loading="lazy" decoding="async"/>
                <span className="rp-faction-card-body"><Crest aria-hidden="true"/><span><strong>{theme.name}</strong><small>{theme.realm}</small></span></span>
            </button>;
        })}</div>
    </Modal>;
}

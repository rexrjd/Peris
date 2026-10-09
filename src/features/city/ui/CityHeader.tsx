import type { World } from '../../../shared/model/world';
import { Icon } from '../../../shared/ui/Icons';
import { FACTIONS, factionOf } from '../../factions/domain/factions';
import { cityOverview } from '../domain/overview';
import { CityOverview } from './CityOverview';

export function CityHeader({ world, owner, sid, now, onCity, onSelect }: {
    world: World; owner: string; sid: number; now: number; onCity?: (id: number) => void; onSelect: (key: string) => void;
}) {
    const model = cityOverview(world, sid, now), cities = world.settlements.filter(s => s.owner_id === owner);
    const canExpand = model.main < 5;
    return <header className="city-toolbar">
        <div className="city-identity"><span className="city-identity-icon"><Icon name="town" size={23}/></span><div className="city-identity-text">
            <h1 title={model.town.name}>{cities.length > 1 ? <span className="city-switcher"><select aria-label="Current city" value={sid} onChange={event => onCity?.(Number(event.target.value))}>{cities.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><Icon name="chevron" size={13}/></span> : model.town.name}</h1>
            <span className="city-identity-meta">{FACTIONS[factionOf(model.town.faction)].name}<i aria-hidden="true">·</i><span title={`Main building level ${model.main}`}>Main Lv. {model.main}</span></span>
        </div></div>
        <button className={`city-plot-shortcut ${model.freePlots ? 'has-plots' : ''}`} aria-label={model.freePlots ? `${model.freePlots} free building ${model.freePlots === 1 ? 'plot' : 'plots'}. Choose a plot to build.` : canExpand ? 'All building plots occupied. Upgrade the main building to expand.' : 'All building plots occupied. Manage the main building.'} onClick={() => onSelect(model.firstFreePlot !== undefined ? `slot:${model.firstFreePlot}` : 'market')}><Icon name={model.freePlots ? 'plus' : 'expand'} size={15}/><span>{model.freePlots ? `${model.freePlots} free ${model.freePlots === 1 ? 'plot' : 'plots'}` : canExpand ? 'Expand city' : 'City full'}</span></button>
        <CityOverview compact world={world} sid={sid} now={now} onSelect={onSelect}/>
    </header>;
}

import type { World } from '../../../shared/model/world';
import type { Army } from '../../army/domain/types';
import { heroForArmy, heroLevel } from '../../heroes/domain/heroes';
import { HeroPortrait } from '../../heroes/ui/HeroPortrait';
import { UNIT_ROLES, trainingOrders } from '../../army/domain/commandRoom';
import { UNIT_TYPES } from '../../army/domain/units';
import { Icon } from '../../../shared/ui/Icons';
import { clock } from '../../../shared/time/clock';
import { playerName } from '../../campaign/domain/players';
import { armyPosition } from '../domain/movement';
import { activityField } from '../domain/activity';

export function MapArmyDetails({ world, army, playerId, now, busy, outgoing, onMarch, onManage, onLocate, onChallenge }: {
    world: World; army: Army; playerId: string; now: number; busy: boolean; outgoing: boolean;
    onMarch: () => void; onManage: () => void; onLocate: () => void; onChallenge: () => void;
}) {
    const own = army.owner_id === playerId, hero = heroForArmy(world, army.id);
    const home = world.settlements.find(s => s.id === army.home_settlement_id);
    const fighting = world.battles.some(b => b.status === 'active' && (b.attacker_army_id === army.id || b.defender_army_id === army.id));
    const training = own ? trainingOrders(world, army).length : 0;
    const position = activityField(armyPosition(army, now));
    const moving = army.status === 'moving';
    const arrival = Date.parse(army.arrival_at);
    const status = fighting ? 'In battle' : moving ? army.march_returning ? 'Returning' : army.raid_target_id != null ? 'Raiding' : 'Marching' : training ? 'Training' : 'Ready for orders';
    return <div className="ops-army-details">
        <div className="ops-identity"><HeroPortrait compact heroId={hero?.id} heroClass={hero?.class} faction={army.faction ?? home?.faction}/>
            <div><span className="ops-kicker">{own ? 'YOUR LEGION' : 'RIVAL LEGION'}</span><h2>{army.name}</h2><p>{hero ? hero.name + ' · Level ' + heroLevel(hero) : playerName(world.players, army.owner_id)}</p></div>
        </div>
        <div className="ops-army-state"><span className={moving || fighting ? 'active' : ''}><i/>{status}</span><small>({position.col} | {position.row})</small></div>
        <div className="ops-troops" aria-label="Army troop composition">{UNIT_TYPES.map(type => <span key={type}><Icon name={UNIT_ROLES[type].icon} size={16}/><strong>{army[type].toLocaleString('en-US')}</strong><small>{UNIT_ROLES[type].name}</small></span>)}</div>
        {own ? <div className="ops-actions">
            <button className="button gold" type="button" disabled={busy || !!training || fighting} onClick={moving ? onLocate : onMarch} aria-label={moving ? 'Locate moving army' : 'Give marching orders'}><Icon name={moving ? 'focus' : 'flag'} size={15}/>{moving ? 'Follow army' : 'March'}</button>
            <button className="button outline" type="button" onClick={onManage} aria-label="Manage troops">Manage<Icon name="arrow" size={14}/></button>
        </div> : <button className="button outline" disabled={busy || outgoing} onClick={onChallenge}>Invite to a live duel</button>}
        {moving && <p className="ops-army-arrival">{!Number.isFinite(arrival) ? 'Waiting for arrival details.' : arrival <= now ? 'Arriving at its destination…' : <>{army.march_returning ? 'Back at its departure station' : 'Reaches its destination'} in <b>{clock((arrival - now) / 1000)}</b>.</>}</p>}
        {!!training && <p className="ops-army-arrival">Finish training before giving marching orders.</p>}
    </div>;
}

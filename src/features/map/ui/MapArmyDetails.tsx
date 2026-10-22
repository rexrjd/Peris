import type { World } from '../../../shared/model/world';
import type { Army } from '../../army/domain/types';
import { heroForArmy, heroLevel } from '../../heroes/domain/heroes';
import { HeroPortrait } from '../../heroes/ui/HeroPortrait';
import { UNIT_ROLES, trainingOrders } from '../../army/domain/commandRoom';
import { UNIT_TYPES } from '../../army/domain/units';
import { RECRUIT_UNITS, readRoster } from '../../army/domain/roster';
import { armyFaction } from '../../army/domain/faction';
import { TroopIcon } from '../../frontier/ui/TroopIcon';
import { factionTroopName } from '../../frontier/ui/roster';
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
    const faction = armyFaction(world, army), troops = readRoster(army);
    const home = world.settlements.find(city => city.id === army.home_settlement_id);
    const fighting = world.battles.some(b => b.status === 'active' && (b.attacker_army_id === army.id || b.defender_army_id === army.id));
    const training = own ? trainingOrders(world, army).length : 0;
    const position = activityField(armyPosition(army, now));
    const moving = army.status === 'moving';
    const arrival = Date.parse(army.arrival_at);
    const status = fighting ? 'In battle' : moving ? army.march_returning ? 'Returning' : army.raid_target_id != null||army.raid_city_id!=null ? 'Raiding' : 'Marching' : army.raid_city_id!=null?'Awaiting city battle':training ? 'Training' : 'Ready for orders';
    return <div className="ops-army-details">
        <div className="ops-identity"><HeroPortrait compact heroId={hero?.id} heroClass={hero?.class} faction={faction}/>
            <div><h2>{army.name}</h2><p>{hero ? hero.name + ' · Lv. ' + heroLevel(hero) : playerName(world.players, army.owner_id)}</p></div>
        </div>
        <div className="ops-army-state"><span><i/>{status}</span>{moving && <small>{!Number.isFinite(arrival) ? 'Pending' : arrival <= now ? 'Arriving' : clock((arrival - now) / 1000, world.game_clock?.rate ?? 1)}</small>}</div>
        <div className="ops-troops" aria-label="Army troop composition">{own || army.unit_roster != null
            ? RECRUIT_UNITS.filter(type => UNIT_TYPES.some(base => base === type) || troops[type] > 0).map(type => <span key={type} data-troop={type} title={troops[type] + ' ' + factionTroopName(faction,type)} aria-label={troops[type] + ' ' + factionTroopName(faction,type)}><TroopIcon unit={type} faction={faction}/><strong>{troops[type].toLocaleString('en-US')}</strong><small>{factionTroopName(faction,type)}</small></span>)
            : UNIT_TYPES.map(type => <span key={type} title={UNIT_ROLES[type].name} aria-label={army[type] + ' ' + UNIT_ROLES[type].name}><Icon name={UNIT_ROLES[type].icon} size={15}/><strong>{army[type].toLocaleString('en-US')}</strong><small>{UNIT_ROLES[type].name}</small></span>)}</div>
        {own ? <div className="ops-actions">
            <button className="button gold" type="button" disabled={busy || !!training || fighting} onClick={moving ? onLocate : onMarch} aria-label={moving ? 'Locate moving army' : 'Give marching orders'}><Icon name={moving ? 'focus' : 'flag'} size={15}/>{moving ? 'Follow army' : 'March'}</button>
            <button className="button outline" type="button" onClick={onManage} aria-label="Manage troops">Manage<Icon name="arrow" size={14}/></button>
        </div> : <button className="button outline" disabled={busy || outgoing} onClick={onChallenge}>Invite to a live duel</button>}
        <details className="ops-extra"><summary>Details</summary><p>Field ({position.col} | {position.row}){home ? ' · ' + home.name : ''}.{moving && (army.march_returning ? ' Returning to its departure station.' : ' On the march.')}{!!training && ' Finish training before marching.'}</p></details>
    </div>;
}

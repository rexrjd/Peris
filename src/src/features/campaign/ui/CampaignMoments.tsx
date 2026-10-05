import { Modal } from '../../../shared/ui/Shared';
import { Crest, Icon } from '../../../shared/ui/Icons';
import { type World } from '../../../shared/model/world';
import { campaignRank, conquered } from '../domain/progression';
export function Welcome({ name, onClose }: {
    name: string;
    onClose: () => void;
}) {
    return <Modal title="The six standards" heading={false} className="campaign-moment welcome-moment" onClose={onClose}><div className="moment-art"/><div className="moment-content"><Crest /><span className="eyebrow">YOUR CAMPAIGN BEGINS</span><h2>The six standards</h2><p>The roads lie broken. Six rebel hosts hold the province. A small keep, a loyal legion, and a name are all you have.</p><p>Bring the standards home, {name}. Restore Peris.</p><div className="moment-steps"><span><Icon name="town"/>Build your city</span><span><Icon name="army"/>Command your legion</span><span><Icon name="flag"/>Reclaim six hosts</span></div><button className="button gold" onClick={onClose}>Begin the restoration <Icon name="arrow"/></button><small>Your progress saves automatically. The General's Codex is always available.</small></div></Modal>;
}
export function CampaignEnding({ world, playerId, onClose }: {
    world: World;
    playerId: string;
    onClose: () => void;
}) {
    const p = world.players.find(p => p.id === playerId)!, count = conquered(world, playerId).size;
    return <Modal title="Peris restored" heading={false} className="campaign-moment ending-moment" onClose={onClose}><div className="moment-art"/><div className="moment-content"><div className="ending-laurel"><Icon name="crown" size={56}/></div><span className="eyebrow">THE SIX STANDARDS ARE HOME</span><h2>Peris restored</h2><p>The last rebel banner has fallen. From the western fields to the high country, the province answers to one ruler again.</p><h3>{p.display_name}<small>{campaignRank(count)}</small></h3><div className="ending-standards">{world.camps.map(c => <span key={c.id} title={c.name}><Icon name="flag" size={28}/><b>{c.id}</b></span>)}</div><div className="ending-stats"><span><b>{p.victories}</b>Victories</span><span><b>{p.prestige}</b>Prestige</span><span><b>{p.upgrades}</b>Upgrades</span></div><button className="button gold" onClick={onClose}>Rule the restored province <Icon name="arrow"/></button><small>Continue developing your realm, revisit the fields, or begin a new campaign.</small></div></Modal>;
}

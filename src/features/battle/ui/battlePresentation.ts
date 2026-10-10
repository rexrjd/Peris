import type { World } from '../../../shared/model/world';
import type { Battle, Formation } from '../domain/types';
import { armyFaction } from '../../army/domain/faction';
import { factionOf } from '../../factions/domain/factions';
import type { BattleArt } from '../rendering/Battle3DCanvas';
import { armyRole } from '../rendering/three/armyAssets';
import rosters from '../../../../assets/concepts/faction-sheets-v1/expanded-rosters.json';

export function battleArt(world: World, battle: Battle, playerId: string): BattleArt {
    const attacker = factionOf(battle.attacker_faction ?? armyFaction(world, world.armies.find(a => a.id === battle.attacker_army_id) ?? { owner_id: battle.attacker_owner_id, home_settlement_id: -1 }));
    const defender = factionOf(battle.defender_faction ?? armyFaction(world, world.armies.find(a => a.id === battle.defender_army_id) ?? { owner_id: battle.defender_owner_id ?? '', home_settlement_id: -1 }));
    const defending = playerId === battle.defender_owner_id;
    const faction = defending ? defender : attacker, enemy = defending ? attacker : defender;
    const profile = rosters.roster.find(item => item.id === faction)!;
    return { faction, enemy, quality: 'balanced', prototypes: true, enemyPrototypes: true, roles: [...profile.troops, ...profile.siege] };
}

/** Labels are presentation only; never rewrite authoritative formations or saves. */
export function battlePresentation(world: World, battle: Battle, playerId: string, art: BattleArt): World {
    const profiles = new Map(rosters.roster.map(profile => [profile.id, profile]));
    const formations = world.formations.filter(f => f.battle_id === battle.id);
    return { ...world, formations: world.formations.map((f: Formation) => {
        if (f.battle_id !== battle.id) return f;
        const role = armyRole(f, formations), faction = f.owner_id === playerId ? art.faction : art.enemy;
        const name = profiles.get(faction)?.troops.find(unit => unit.id === role)?.name ?? f.label;
        const peers = formations.filter(other => other.owner_id === f.owner_id && armyRole(other, formations) === role).sort((a, b) => a.id - b.id);
        return { ...f, label: peers.length > 1 ? `${name} ${peers.findIndex(other => other.id === f.id) + 1}` : name };
    }) };
}

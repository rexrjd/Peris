import { type Battle, type Effect, type Formation } from './types';
import { angleDiff, clamp, dist } from '../../../shared/math/geometry';
import { UNITS } from '../../army/domain/units';
import { terrainAt } from './terrain';
import { contactDistance } from './spacing';
export type PendingDamage = Map<number, {
    loss: number;
    morale: number;
}>;
export function resolveCombat(b: Battle, fs: Formation[], byId: Map<number, Formation>, dt: number, effects: Effect[]): PendingDamage {
    const pending = new Map<number, {
        loss: number;
        morale: number;
    }>();
    for (const f of fs) {
        if (f.status === 'routed' || f.soldiers <= 0 || !f.target_formation_id)
            continue;
        const t = byId.get(f.target_formation_id);
        if (!t || t.status === 'routed' || t.soldiers <= 0 || dist(f,t) > (f.unit_type==='archers'?UNITS.archers.range:contactDistance(f,t))+4)
            continue;
        const ranged=f.unit_type==='archers'&&dist(f,t)>contactDistance(f,t)+20;
        if(b.elapsed<(f.attack_ready_at??0)||ranged&&f.status==='moving')continue;
        const bearingToTarget=Math.atan2(t.y-f.y,t.x-f.x)*180/Math.PI;
        if(Math.abs(angleDiff(bearingToTarget,f.facing))>65)continue;
        const interval=ranged?2.5:f.unit_type==='cavalry'?1.4:1.2;
        f.attack_ready_at=b.elapsed+interval;
        if(f.damage_target_id!==t.id){f.damage_pool=0;f.damage_target_id=t.id;}
        const gt = terrainAt(b.terrain, t.x, t.y), gf = terrainAt(b.terrain, f.x, f.y);
        const bearing = Math.atan2(f.y - t.y, f.x - t.x) * 180 / Math.PI;
        const relative = Math.abs(angleDiff(bearing, t.facing));
        const flank = ranged ? 1 : relative > 135 ? 1.65 : relative > 65 ? 1.28 : 1;
        const charge = f.charge_ready && f.unit_type === 'cavalry' && gf.kind !== 'Forest' ? 2.4 : 1;
        const matchup = f.unit_type === 'cavalry' ? (t.unit_type === 'archers' ? 1.65 : .9) : f.unit_type === 'infantry' ? (t.unit_type === 'cavalry' ? 1.25 : 1) : t.unit_type === 'cavalry' ? .75 : 1;
        const stance = f.stance === 'aggressive' ? 1.22 : f.stance === 'guard' ? .9 : 1;
        const brace = t.stance === 'guard' && t.unit_type === 'infantry' && relative < 65 && f.unit_type === 'cavalry' ? .5 : 1;
        const cover = ranged ? gt.cover : 1;
        const elevation = ranged && gf.height > gt.height ? 1.25 : ranged && gf.height < gt.height ? .8 : 1;
        const meleeArcher = f.unit_type === 'archers' && !ranged ? .28 : 1;
        const defence = t.stance === 'guard' ? .8 : t.stance === 'aggressive' ? 1.15 : 1;
        const difficulty=1; // Composition and morale define NPC difficulty, not hidden ownership damage.
        f.damage_pool += (f.soldiers * (f.attack_multiplier ?? 1) * (f.magic_attack??1) * (1-(t.magic_defence??0)) * UNITS[f.unit_type].rate * matchup * stance * defence * brace * flank * charge * cover * elevation * meleeArcher * difficulty * (.55 + f.stamina / 220) * interval + (charge > 1 ? f.soldiers * .06 * brace * flank * (1-(t.magic_defence??0)) : 0)) / (t.defence_multiplier??1);
        const casualties = Math.min(Math.max(0, t.soldiers - (pending.get(t.id)?.loss ?? 0)), Math.floor(f.damage_pool));
        if (casualties > 0 || charge > 1) {
            f.damage_pool-=casualties;
            f.damage_pool%=1;
            f.kills += casualties;
            const p = pending.get(t.id) ?? { loss: 0, morale: 0 };
            p.loss += casualties;
            p.morale += casualties/Math.max(1,t.initial_soldiers)*(125+(flank>1?35:0))+(charge>1?8:0);
            pending.set(t.id, p);
            effects.push({ kind: 'death', x: t.x, y: t.y, side: t.side, at: b.elapsed });
        }
        if (charge > 1) {
            effects.push({ kind: 'charge', x: f.x, y: f.y, side: f.side, at: b.elapsed });
            f.charge_ready=false;f.charge_distance=0;
            f.stamina = clamp(f.stamina - 12, 0, 100);
        }
        if(ranged)
            effects.push({ kind: 'arrow', x: f.x, y: f.y, tx: t.x, ty: t.y, side: f.side, at: b.elapsed });
    }
    return pending;
}

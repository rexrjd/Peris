import { Group } from 'three';
import type { Faction } from '../../../factions/domain/factions';
import type { CityTraining } from '../../domain/training';
import type { CityPlot } from './layout';
import { RECRUIT_RULES } from '../../../army/domain/roster';
import type { Formation } from '../../../battle/domain/types';
import { armyIdleBounds, createArmyRoleVisual, loadBattleArmy, type Army, type ArmyRole } from '../../../battle/rendering/three/armyAssets';
import { createLowPolySoldiers, type SoldierVisual } from '../../../battle/rendering/three/soldiers';

type Trainee = { visual: SoldierVisual; formation: Formation; facing: number; instructor: boolean };
type Loader = (faction: Faction) => Promise<Army>;

/** A bounded decorative group, using the exact faction rigs and clips from the classic 3D battle. */
export class CityTrainingYard {
    readonly group = new Group();
    private queue: CityTraining = null;
    private faction: Faction = 'roman';
    private army?: Army;
    private people: Trainee[] = [];
    private loading = false;
    private fallback = false;
    private destroyed = false;
    private generation = 0;
    private signature = '';
    state: 'none' | 'loading' | 'ready' | 'fallback' = 'none';

    constructor(private readonly changed: () => void, private readonly load: Loader = faction => loadBattleArmy(faction)) {
        this.group.name = 'Active barracks training'; this.group.visible = false;
    }
    setTraining(queue: CityTraining, plots: readonly CityPlot[], faction: Faction) {
        if (this.destroyed) return;
        if (faction !== this.faction) {
            this.generation++; this.loading = false; this.clearPeople(); this.army?.dispose(); this.army = undefined;
            this.fallback = false; this.faction = faction; this.signature = '';
        }
        const barracks = plots.filter(plot => plot.type === 'barracks' && plot.level > 0).sort((a, b) => b.level - a.level || (a.slot ?? 0) - (b.slot ?? 0))[0];
        this.queue = barracks ? queue : null;
        this.group.visible = !!this.queue;
        if (barracks) this.group.position.set(barracks.x, .065, barracks.z);
        const signature = JSON.stringify([this.queue, barracks?.key]);
        if (signature !== this.signature) { this.signature = signature; this.rebuild(); this.changed(); }
        this.state = !this.queue ? 'none' : this.loading ? 'loading' : this.fallback ? 'fallback' : 'ready';
        if (!this.queue || this.army || this.loading || this.fallback) return;
        const generation = ++this.generation; this.loading = true; this.state = 'loading';
        void this.load(faction).then(army => {
            if (this.destroyed || generation !== this.generation) { army.dispose(); return; }
            this.army = army; this.loading = false; this.rebuild();
            this.state = this.queue ? 'ready' : 'none'; this.changed();
        }).catch(error => {
            if (this.destroyed || generation !== this.generation) return;
            this.clearPeople(); this.army?.dispose(); this.army = undefined; this.loading = false; this.fallback = true; this.rebuild();
            this.state = this.queue ? 'fallback' : 'none';
            console.warn('City training uses the battle compatibility models', error); this.changed();
        });
    }
    private clearPeople() { for (const person of this.people) person.visual.dispose(); this.people = []; this.group.clear(); }
    private rebuild() {
        this.clearPeople();
        if (!this.queue) return;
        const count = Math.max(1, Math.min(6, this.queue.quantity)), role = RECRUIT_RULES[this.queue.unit].role as ArmyRole;
        for (const instructor of [true, false]) {
            const currentRole = instructor ? 'elite' : role, soldiers = instructor ? 1 : count;
            const formation = { id: instructor ? 1 : 2, soldiers, initial_soldiers: soldiers, columns: Math.min(3,soldiers), status: instructor ? 'idle' : 'engaged', side: 'attacker', unit_type: role === 'archer' ? 'archers' : 'infantry' } as Formation;
            const visual = this.army ? createArmyRoleVisual(this.army, currentRole) : createLowPolySoldiers(formation);
            const bounds = this.army ? armyIdleBounds(this.army, currentRole) : undefined;
            const scale = .5 / (bounds ? bounds.max.y - bounds.min.y : 10);
            visual.object.scale.setScalar(scale);
            visual.object.position.set(instructor ? -1.03 : .2, bounds ? -bounds.min.y * scale : 0, instructor ? .9 : .8);
            // Both ranks practise toward the targets, with their instructor alongside.
            const facing = instructor ? 0 : -90;
            this.people.push({ visual, formation, facing, instructor }); this.group.add(visual.object);
        }
        this.animate(0, true);
    }
    animate(time: number, reduced: boolean) {
        if (!this.group.visible) return;
        for (const person of this.people) {
            const { visual, formation, facing, instructor } = person;
            // The instructor demonstrates between rounds. This never creates a gameplay formation.
            formation.status = instructor && Math.floor(time / 3) % 2 === 0 ? 'idle' : 'engaged';
            visual.update({ formation, pose: { x: 0, y: 0, facing }, time, dt: 0, animate: !reduced, height: () => 0 });
        }
    }
    dispose() {
        if (this.destroyed) return;
        this.destroyed = true; this.generation++; this.clearPeople(); this.army?.dispose(); this.army = undefined;
        this.group.removeFromParent();
    }
}

import * as THREE from 'three';
import { FACTIONS, type Faction } from '../../../factions/domain/factions';
import { cityRenderGrowth, cityFootprint, type CityPlot } from './layout';
import { cityStreetClearance } from './cityStreets';
import { cityKit } from './modelKit';
import type { CityEnvironment } from '../../domain/environment';
import { cityPlan, planContains } from './cityPlan';
import { cityPublicSpaces } from './cityPublicSpaces';
import { createCityLandmark } from './cityLandmarks';

type Placement = { x: number; z: number; y?: number; angle?: number; scale?: number; tone?: number };
type LanternPlacement = Placement & { kind: 'street' | 'gate' | 'square' };

/** Clear of walking surfaces and every reserved building lot, including empty ones. */
export function cityLanternPlacements(plots: CityPlot[], mainLevel: number, environment?:CityEnvironment): LanternPlacement[] {
    if (!plots.some(p => p.level > 0 && p.type !== 'wall')) return [];
    const g = cityRenderGrowth(mainLevel,environment), f = cityFootprint(mainLevel,environment), result: LanternPlacement[] = [];
    const landmark=cityPublicSpaces(mainLevel,environment).landmark;
    const add = (x: number, z: number, angle: number, kind: LanternPlacement['kind']) => {
        if(landmark&&Math.hypot(x-landmark.x,z-landmark.z)<landmark.radius+.5)return;
        x *= g; z *= g;
        if (cityStreetClearance(x / g, z / g, mainLevel,environment) * g < .1) return;
        if (plots.some(p => p.slot !== undefined && p.slot < 16 && Math.abs(x - p.x) < 1.69 && Math.abs(z - p.z) < 1.69)) return;
        result.push({ x, z, angle, kind });
    };
    const plan=cityPlan(environment);
    if(plan){
        for(const path of plan.routes)for(let i=1;i<path.length;i++){
            const a=path[i-1],b=path[i],length=Math.hypot(b.x-a.x,b.z-a.z);
            for(let d=1;d<length;d+=4){const x=a.x+(b.x-a.x)*d/length-(b.z-a.z)/length*.75,z=a.z+(b.z-a.z)*d/length+(b.x-a.x)/length*.75;
                if(!planContains(plan.boundary,{x,z})||result.some(p=>Math.hypot(p.x/g-x,p.z/g-z)<2))continue;
                add(x,z,Math.atan2(b.z-a.z,b.x-a.x),'street');
            }
        }
        return result;
    }
    const rows = Math.ceil(plots.filter(p => p.slot !== undefined && p.slot < 16).length / 4);
    for (let row = 0; row < rows; row++) for (const side of [-1, 1]) {
        add(side * .8, row * 4 + .23, side < 0 ? 0 : Math.PI, 'street');
        if (row % 2 === 0) add(side * 7.1, row * 4 + .23, side < 0 ? Math.PI : 0, 'street');
    }
    for (const side of [-1, 1]) add(side * 1.2, f.front + 1.12, side < 0 ? 0 : Math.PI, 'gate');
    return result;
}

/** Repeated props share geometry/materials; no separate light or draw per lantern. */
function instances(prototype: THREE.Group, positions: Placement[], name: string, petalColors?: readonly number[]) {
    const group = new THREE.Group(), transform = new THREE.Object3D(); group.name = name;
    for (const source of prototype.children) {
        if (!(source instanceof THREE.Mesh)) continue;
        const mesh = new THREE.InstancedMesh(source.geometry, source.material, positions.length);
        mesh.castShadow = name === 'Street lanterns'; mesh.receiveShadow = true;
        positions.forEach((p, i) => {
            transform.position.set(p.x, p.y ?? 0, p.z); transform.rotation.set(0, p.angle ?? 0, 0); transform.scale.setScalar(p.scale ?? 1); transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
            if (petalColors && !Array.isArray(source.material) && source.material.name === 'Town flower petals') mesh.setColorAt(i, new THREE.Color(petalColors[(p.tone ?? i) % petalColors.length]));
        });
        mesh.computeBoundingSphere(); group.add(mesh);
    }
    prototype.clear(); return group;
}

function lantern(faction: Faction) {
    const k = cityKit(faction), { m, box, cylinder, cone } = k;
    const glow = new THREE.MeshStandardMaterial({ color: faction === 'undead' ? 0xc6b8e4 : faction === 'demon' ? 0xf1ad73 : 0xffd998, emissive: faction === 'undead' ? 0x9e7bbf : 0xffb15c, emissiveIntensity: .8, roughness: .65, flatShading: true });
    glow.name = 'Town lantern glass';
    cylinder(.09, .12, 0, 0, 0, m.darkStone); cylinder(.045, 1.37, 0, .08, 0, faction === 'elf' || faction === 'orc' || faction === 'pandaren' ? m.wood : m.dark);
    box(.38, .055, .055, .15, 1.32, 0, m.dark); box(.035, .14, .035, .28, 1.19, 0, m.dark);
    if (faction === 'pandaren') {
        cylinder(.13, .25, .28, .94, 0, glow); cylinder(.145, .045, .28, 1.19, 0, m.roof); cylinder(.13, .04, .28, .91, 0, m.gold); cylinder(.012, .13, .28, .78, 0, m.roof);
    } else {
        box(.19, .24, .19, .28, .95, 0, glow);
        for (const dx of [-.105, .105]) for (const dz of [-.105, .105]) box(.023, .29, .023, .28 + dx, .92, dz, m.dark);
        box(.25, .045, .25, .28, .91, 0, m.dark); cone(.18, .12, .28, 1.2, 0, m.slate);
    }
    return { prototype: k.finish(), glow };
}

function flower(faction: Faction) {
    const k = cityKit(faction), { m, cylinder, box } = k;
    const petals = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }); petals.name = 'Town flower petals';
    cylinder(.012, .27, 0, 0, 0, m.leaf);
    for (const side of [-1, 1]) { const leaf = box(.1, .016, .05, side * .04, .12, 0, m.leaf); leaf.rotation.z = side * .35; }
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; box(.095, .033, .07, Math.cos(a) * .055, .27, Math.sin(a) * .055, petals, -a); }
    cylinder(.035, .038, 0, .28, 0, m.gold); return k.finish();
}

/** Native-city dressing only. Nothing is serialized or added to the economy. */
export function createCityLife(plots: CityPlot[], faction: Faction, mainLevel: number, environment?:CityEnvironment) {
    const group = new THREE.Group(); group.name = 'Living town details';
    const k = cityKit(faction, true), { m, box, cylinder, rock } = k, g = cityRenderGrowth(mainLevel,environment), f = cityFootprint(mainLevel,environment);
    const flowers: Placement[] = [], lanterns = cityLanternPlacements(plots, mainLevel,environment), gestures: THREE.Group[] = [];
    const flowersAllowed=!['orc','undead','demon'].includes(faction);
    const colors = [0xc95d68, 0xe8be79, 0xe9daca, 0xa68ab4];
    let bouquetIndex = 0;
    const bouquet = (x: number, y: number, z: number, n = 5) => {
        if(!flowersAllowed)return;
        const tone = bouquetIndex++ % colors.length;
        for (let i = 0; i < n; i++) { const a = i * Math.PI * 2 / n; flowers.push({ x: x + Math.cos(a) * .1, z: z + Math.sin(a) * .1, y, scale: .85 + i % 3 * .12, angle: a, tone }); }
    };
    const pot = (x: number, z: number, y = 0) => { if(!flowersAllowed)return; cylinder(.145, .23, x, y, z, m.roofLight); cylinder(.18, .045, x, y + .2, z, m.roof); cylinder(.13, .025, x, y + .23, z, m.earth); bouquet(x, y + .24, z); };
    const barrel = (x: number, z: number) => { cylinder(.15, .35, x, 0, z, m.timber); for (const y of [.07,.26]) cylinder(.16, .035, x, y, z, m.dark); };
    const crate = (x: number, z: number, y = 0) => { box(.3, .28, .3, x, y, z, m.timber); for (const side of [-1,1]) box(.035, .28, .32, x + side * .12, y, z, m.wood); box(.32,.04,.32,x,y+.25,z,m.wood); };
    // Blooms sit above the existing shrubs, following their existing courtyards.
    for (const plot of plots) {
        if (!plot.level || plot.type === 'wall' || ['lumber','quarry','farm','fishery'].includes(plot.type ?? '')) continue;
        const main = plot.type === 'market', w = main ? 4.3 : 3.2, d = main ? 3.65 : 3.2;
        for (const side of [-1,1]) bouquet(plot.x + side * (w / 2 - .3), .4, plot.z + d / 2 - .34, 4);
        if (plot.type === 'housing') { pot(plot.x - .65, plot.z + 1.0); barrel(plot.x + .85,plot.z + 1.0); }
        if (plot.type === 'warehouse' || plot.type === 'granary') { crate(plot.x + 1.05,plot.z + .8); crate(plot.x + 1.05,plot.z + .8,.28); barrel(plot.x - .95,plot.z + .8); }
        if (plot.type === 'academy') { pot(plot.x + .8,plot.z + 1.0); box(.22,.025,.16,plot.x-1.2,.235,plot.z+1.1,m.roof); }
        if (main) {
            for (const side of [-1,1]) {
                pot(plot.x + side * 1.92,plot.z + 3.1);
                // Backrests complete the benches already built into the square.
                box(.85,.18,.045,plot.x+side*1.1,.43,plot.z+3.0,m.timber);
                for(const dx of [-.3,.3])box(.035,.43,.045,plot.x+side*1.1+dx,.18,plot.z+3.0,m.wood);
            }
            if (plot.level >= 2) {
                // A reader occupies one of the existing benches, clear of its approach.
                const rx=plot.x+1.1,rz=plot.z+3.1,sit=FACTIONS[faction].scale;
                box(.17*sit,.22*sit,.14*sit,rx,.28,rz,m.roof);rock(.09*sit,rx,.28+.25*sit,rz,m.skin);
                for(const side of [-1,1]){box(.055*sit,.055,.2*sit,rx+side*.05*sit,.25,rz+.09*sit,m.wood);box(.055*sit,.23,.055*sit,rx+side*.05*sit,.02,rz+.18*sit,m.wood);box(.05*sit,.17*sit,.055*sit,rx+side*.11*sit,.31,rz+.035*sit,m.skin);}
                box(.17,.025,.14,rx,.4,rz+.12,m.light);box(.015,.03,.14,rx,.4,rz+.12,m.roof);
                const x = plot.x - 1.25, z = plot.z + 1.7;
                // A small striped produce stall belongs to the existing civic square.
                for(const dx of [-.49,.49])for(const dz of [-.37,.37])box(.045,1.08,.045,x+dx,0,z+dz,m.wood);
                for(let i=0;i<7;i++){const cloth=box(1.16/7,.04,.94,x-.58+(i+.5)*1.16/7,1.08,z,i%2?m.light:m.roofLight);cloth.rotation.x=.12;box(1.16/7,.12,.035,x-.58+(i+.5)*1.16/7,.92,z+.47,i%2?m.light:m.roofLight);}
                box(.93,.4,.42,x,0,z+.14,m.wood);box(1.02,.065,.5,x,.4,z+.14,m.timber);
                for(const dx of [-.29,0,.29]){cylinder(.1,.045,x+dx,.465,z+.14,m.timber);for(let i=0;i<3;i++)rock(.045,x+dx+(i-1)*.04,.51,z+.14,i%2?m.gold:m.roofLight);}
                barrel(x-.7,z+.12);crate(x+.65,z+.12);
                // One shopkeeper gestures gently, using the existing tiny resident style.
                const vx=x,vz=z-.16,s=FACTIONS[faction].scale;
                box(.17*s,.24*s,.14*s,vx,.18*s,vz,m.slate);rock(.09*s,vx,.45*s,vz,m.skin);
                for(const dx of [-.05,.05])box(.055*s,.18*s,.06*s,vx+dx*s,0,vz,m.wood);
                const arm=new THREE.Group();arm.position.set(vx+.11*s,.36*s,vz);k.group.add(arm);arm.add(box(.055*s,.21*s,.055*s,0,-.17*s,0,m.skin));k.motion(arm,'townGreeting');gestures.push(arm);
            }
        }
    }
    // The avenue gets roses in its existing beds, never on an unoccupied lot.
    if (!environment?.layout&&plots.some(p=>p.level>0&&p.type!=='wall')) for(const side of [-1,1])for(let z=.9;z<f.front-1;z+=4) {
        const x=side*.76*g,pz=z*g;
        if(plots.some(p=>p.slot!==undefined&&p.slot<16&&Math.abs(x-p.x)<1.8&&Math.abs(pz-p.z)<1.8))continue;
        for(const dz of [-.16,.16])bouquet(x,.28,pz+dz*g,3);
    }
    // Hanging baskets give a few street lamps a softer silhouette.
    lanterns.forEach((p,i)=>{if(i%4)return;const a=p.angle??0;pot(p.x-Math.cos(a)*.15,p.z+Math.sin(a)*.15,.72);});
    const dressed = k.finish(); group.add(dressed);
    const placement=cityPublicSpaces(mainLevel,environment).landmark;
    const landmark=placement?createCityLandmark(placement,faction,g):undefined;
    if(landmark)group.add(landmark.group);
    group.userData.cityLandmark=placement?.kind;
    let glow: THREE.MeshStandardMaterial | undefined;
    if (lanterns.length) { const lamp=lantern(faction);glow=lamp.glow;group.add(instances(lamp.prototype,lanterns,'Street lanterns')); }
    if (flowers.length) group.add(instances(flower(faction),flowers,'Town flowers',colors));
    group.userData.cityLife = { lanterns: lanterns.length, flowers: flowers.length, shopkeepers: gestures.length };
    return { group, animate(seconds: number, reduced: boolean) {
        landmark?.animate(seconds,reduced);
        if (glow) glow.emissiveIntensity = reduced ? .8 : .8 + Math.sin(seconds*2.1)*.035;
        gestures.forEach((arm,i)=>{arm.rotation.z=reduced?0:Math.max(0,Math.sin(seconds*.85+i))*.5;});
    } };
}

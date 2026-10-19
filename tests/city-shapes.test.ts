import test from 'node:test';
import assert from 'node:assert/strict';
import { cityPlan, planContains, type PlanPoint } from '../src/features/city/rendering/three/cityPlan';
import { cityLayout, cityRenderGrowth, riverX } from '../src/features/city/rendering/three/layout';
import { cityWalkRoute } from '../src/features/city/rendering/three/cityStreets';
import type { CityEnvironment } from '../src/features/city/domain/environment';

const styles = ['roman', 'elf', 'orc'] as const;
const environment = (layout: typeof styles[number], seed: number): CityEnvironment & { layout: typeof layout } => ({ layout, seed, terrain: 'forest', water: 'river' });

test('faction plans and individual city seeds have distinct repeatable silhouettes', () => {
    const signatures = new Set<string>();
    for (const style of styles) for (const seed of [170, 739]) {
        const env = environment(style, seed), plan = cityPlan(env)!;
        assert.deepEqual(cityPlan({ ...env }), plan);
        signatures.add(JSON.stringify(plan.boundary));
        assert.equal(plan.sites.length, 16);
        assert.ok(plan.boundary.length >= 8);
    }
    assert.equal(signatures.size, 6);
    assert.equal(cityPlan({ seed: 1, terrain: 'forest', water: 'none' }), undefined);
});

test('reserved sites stay separated, inside walls and clear of river banks across seeds', () => {
    for (const style of styles) for (let seed = 1; seed <= 16; seed++) {
        const env = environment(style, seed), plan = cityPlan(env)!;
        const sites = [plan.market, ...plan.sites];
        sites.forEach((point, index) => {
            const half = index ? 1.75 : 2.4;
            for (const dx of [-half, half]) for (const dz of [-1.75, 1.75]) {
                assert.ok(planContains(plan.boundary, { x: point.x + dx, z: point.z + dz }), `${style}/${seed}: site ${index} outside wall`);
                assert.ok(point.x + dx < riverX(point.z + dz, env) - 1.1, `${style}/${seed}: wet site ${index}`);
            }
            for (const other of sites.slice(index + 1)) assert.ok(Math.abs(point.x - other.x) >= 3.6 || Math.abs(point.z - other.z) >= 3.6, `${style}/${seed}: overlapping sites`);
        });
    }
});

test('every reserved doorway has a continuous route from the civic square clear of building footprints', () => {
    for (const style of styles) for (const seed of [1, 170, 739, 1501]) {
        const plan = cityPlan(environment(style, seed))!;
        const buildings = [plan.market, ...plan.sites];
        for (const [index, route] of plan.routes.entries()) {
            assert.deepEqual(route[0], plan.hub);
            assert.deepEqual(route.at(-1), { x: plan.sites[index].x, z: plan.sites[index].z + 2 });
            for (let j = 1; j < route.length; j++) {
                const a = route[j - 1], b = route[j], steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 12);
                for (let n = 0; n <= steps; n++) {
                    const p: PlanPoint = { x: a.x + (b.x - a.x) * n / steps, z: a.z + (b.z - a.z) * n / steps };
                    assert.ok(planContains(plan.boundary, p), `${style}/${seed}: route outside wall`);
                    buildings.forEach((site, k) => assert.ok(Math.abs(p.x - site.x) >= (k ? 1.65 : 2.3) || Math.abs(p.z - site.z) >= (k ? 1.65 : 1.95), `${style}/${seed}: route crosses building`));
                }
            }
        }
    }
});

test('growth and slot construction keep existing plot identities and world positions unchanged', () => {
    for (const style of styles) {
        const env = environment(style, 739), before = cityLayout({ market: 0 }, [], env);
        for (let level = 1; level <= 5; level++) {
            const after = cityLayout({ market: level }, [], env);
            for (const old of before) {
                const next = after.find(p => p.key === old.key)!;
                assert.equal(next.x, old.x); assert.equal(next.z, old.z);
            }
        }
        const built = cityLayout({ market: 5 }, [{ settlement_id: 1, slot_index: 0, building_type: 'housing', level: 3 }], env);
        assert.equal(built.find(p => p.key === 'slot:0')!.type, 'housing');
        for (const p of built.filter(p => p.slot !== undefined && p.slot < 16)) {
            const route = cityWalkRoute(p, cityRenderGrowth(5, env), 5, env);
            assert.ok(route.length >= 2);
            assert.ok(Math.hypot(route.at(-1)![0] - p.x / cityRenderGrowth(5, env), route.at(-1)![1] - p.z / cityRenderGrowth(5, env)) >= 1.3);
        }
    }
});

test('lumber service routes clear the farm silo and its working yard', () => {
    for (const style of styles) {
        const env=environment(style,739),g=cityRenderGrowth(5,env),plots=cityLayout({market:5,farm:5,lumber:5},[],env);
        const farm=plots.find(p=>p.type==='farm')!,lumber=plots.find(p=>p.type==='lumber')!;
        const silo={x:farm.x+1.4*1.05,z:farm.z-.75*1.05};
        const route=cityWalkRoute(lumber,g,5,env);
        for(let i=1;i<route.length;i++){
            const [ax,az]=route[i-1].map(n=>n*g),[bx,bz]=route[i].map(n=>n*g),dx=bx-ax,dz=bz-az;
            const t=Math.max(0,Math.min(1,((silo.x-ax)*dx+(silo.z-az)*dz)/(dx*dx+dz*dz)));
            assert.ok(Math.hypot(ax+dx*t-silo.x,az+dz*t-silo.z)>.8,`${style}: service road intersects silo`);
        }
    }
});

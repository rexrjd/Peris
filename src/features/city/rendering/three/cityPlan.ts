import { cityRandom, type CityEnvironment } from '../../domain/environment';

export type PlanPoint = Readonly<{ x: number; z: number }>;
export type PlanStreet = Readonly<{ from: PlanPoint; to: PlanPoint; width: number }>;
type Gate = Readonly<{ point: PlanPoint; angle: number }>;
export type CityPlan = Readonly<{
    boundary: readonly PlanPoint[]; sites: readonly PlanPoint[]; market: PlanPoint;
    hub: PlanPoint; front: Gate; rear: Gate; routes: readonly (readonly PlanPoint[])[];
    streets: readonly PlanStreet[]; walls: readonly PlanStreet[]; gateRoutes: readonly (readonly PlanPoint[])[]; serviceLane: number;
    bounds: Readonly<{ left: number; right: number; back: number; front: number }>;
}>;

const cache = new Map<string, CityPlan>();
const point = (x: number, z: number): PlanPoint => ({ x, z });
const snap = (n: number) => Math.round(n * 2) / 2;
const distance = (a: PlanPoint, b: PlanPoint) => Math.hypot(b.x - a.x, b.z - a.z);

export function planContains(boundary: readonly PlanPoint[], p: PlanPoint) {
    let inside = false;
    for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
        const a = boundary[i], b = boundary[j];
        if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
}

/** Pure, geography-seeded presentation geometry. All sixteen sites are reserved
 * before unlocking any of them, so growth cannot reroll existing buildings. */
export function cityPlan(environment?: CityEnvironment): CityPlan | undefined {
    if (!environment?.layout) return undefined;
    const key = `${environment.layout}:${environment.seed}:${environment.terrain}:${environment.water}`;
    const old = cache.get(key); if (old) return old;
    const style = environment.layout, noise = (i: number) => cityRandom(environment, 6000 + i);
    const highland=environment.terrain==='mountain'||environment.terrain==='snow';
    const sx = (.96 + noise(0) * .08)*(highland?.96:1), sz = (.96 + noise(1) * .1)*(highland?1.04:1);
    const shear = style === 'roman' ? 0 : (noise(2) - .5) * .08;
    const transform = (x: number, z: number) => point(snap(-6 + (x + 6) * sx + (z - 2) * shear), snap(2 + (z - 2) * sz));
    let boundary: PlanPoint[], sites: PlanPoint[], market: PlanPoint;
    if (style === 'elf') {
        boundary = Array.from({ length: 40 }, (_, i) => {
            const angle = i * Math.PI / 20;
            const contour=1+.035*Math.sin(angle*3+noise(4)*Math.PI*2)+.02*Math.cos(angle*5+noise(5)*Math.PI*2);
            return transform(-6 + Math.cos(angle) * 12.5*contour, 2 + Math.sin(angle) * (18.5 + noise(3))*contour);
        });
        sites = Array.from({ length: 16 }, (_, i) => {
            const outer = i >= 8, angle = (i % 8) * Math.PI / 4 + (outer ? Math.PI / 8 : 0);
            return transform(-6 + Math.cos(angle) * (outer ? 9.5 : 6.2), 2 + Math.sin(angle) * (outer ? 14 : 8));
        });
        market = transform(-6, 2);
    } else if (style === 'orc') {
        boundary = [[-16,-14],[-7,-13],[5,-15],[7,-8],[6,1],[7,12],[1,17],[-6,16],[-16,17],[-20,10],[-18,0],[-20,-8]].map(([x,z]) => transform(x,z));
        sites = Array.from({ length: 16 }, (_, i) => {
            const district = Math.floor(i / 4), dx = (noise(10 + district) - .5) * .65, dz = (noise(20 + district) - .5) * .65;
            return transform((district % 2 ? 1 : -12) + (i % 2 ? 2.25 : -2.25) + dx, (district < 2 ? -7 : 7) + (i % 4 < 2 ? -2.25 : 2.25) + dz);
        });
        market = transform(-5.5, -3.5);
    } else {
        const cuts=Array.from({length:4},(_,i)=>2+noise(3+i)*2.5),[nw,ne,se,sw]=cuts;
        boundary = [[-17+nw,-14],[-5.5,-14],[6-ne,-14],[6,-14+ne],[6,16-se],[6-se,16],[-5.5,16],[-17+sw,16],[-17,16-sw],[-17,-14+nw]].map(([x,z]) => transform(x,z));
        sites = Array.from({ length: 16 }, (_, i) => transform([-12.5,-8,-3.5,1][i % 4], -3.5 + Math.floor(i / 4) * 4.5));
        market = transform(-5.5, -9);
    }
    // Start with the central gate on horizontal Roman runs, or the extreme
    // southern/northern vertex of the organic perimeter.
    const frontIndex = boundary.reduce((best, p, i) => p.z > boundary[best].z || p.z === boundary[best].z && Math.abs(p.x + 6) < Math.abs(boundary[best].x + 6) ? i : best, 0);
    const rearIndex = boundary.reduce((best, p, i) => p.z < boundary[best].z || p.z === boundary[best].z && Math.abs(p.x + 6) < Math.abs(boundary[best].x + 6) ? i : best, 0);
    const gate = (index: number): Gate => {
        const before = boundary[(index + boundary.length - 1) % boundary.length], after = boundary[(index + 1) % boundary.length];
        return { point: boundary[index], angle: -Math.atan2(after.z - before.z, after.x - before.x) };
    };
    const front = gate(frontIndex), rear = gate(rearIndex), hub = point(market.x, market.z + 3.5);
    const bounds = { left: Math.min(...boundary.map(p=>p.x)), right: Math.max(...boundary.map(p=>p.x)), back: Math.min(...boundary.map(p=>p.z)), front: Math.max(...boundary.map(p=>p.z)) };
    const buildings = [market, ...sites];
    const clear = (p: PlanPoint) => planContains(boundary, p) && buildings.every((b, i) => Math.abs(p.x - b.x) >= (i ? 1.9 : 2.55) || Math.abs(p.z - b.z) >= (i ? 1.9 : 2.2));
    const approach = (end:PlanPoint) => {
        const path=route(hub,end,bounds,clear,style==='roman');
        return style==='elf'?roundRoute(path,clear):path;
    };
    const routes = sites.map(p => approach(point(p.x, p.z + 2)));
    const streets: PlanStreet[] = [];
    const add = (path: readonly PlanPoint[], width = .45) => path.slice(1).forEach((to, i) => { if (distance(path[i], to) > .01) streets.push({ from: path[i], to, width }); });
    routes.forEach(path => add(path));
    const gateRoutes = [front, rear].map(entry => {
        const p = entry.point, inward = point(snap(p.x + (market.x - p.x) / distance(p, market) * 2), snap(p.z + (market.z - p.z) / distance(p, market) * 2));
        const path = [...approach(inward), p];
        add(path, 1.25); return path;
    });
    add([hub, point(market.x, market.z + 2.2)], 1.25);
    const outside = bounds.front + 4, lane = bounds.left - 1.5;
    add([front.point, point(front.point.x, outside), point(front.point.x, 96)], 1);
    add([rear.point, point(rear.point.x, -96)], .8);
    add([point(-96, outside), point(96, outside)], .8);
    add([point(front.point.x, outside), point(lane, outside), point(lane, -3.3), point(bounds.left - 4, -3.3)], .65);
    add([point(lane, 9.7), point(bounds.left - 4, 9.7)], .65);
    add([point(13, outside), point(13, -2.3)], .65);
    const walls = boundaryWalls(boundary, [frontIndex, rearIndex]);
    const result: CityPlan = { boundary, sites, market, hub, front, rear, routes, streets, walls, gateRoutes, bounds, serviceLane: lane };
    // Plans are shared by thumbnails, scenery and the interactive renderer.
    freezePlan(result);
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, result); return result;
}

function freezePlan(value: unknown) {
    if(value&&typeof value==='object'&&!Object.isFrozen(value)){
        Object.values(value).forEach(freezePlan);Object.freeze(value);
    }
}

function boundaryWalls(boundary: readonly PlanPoint[], gates: number[]): PlanStreet[] {
    const lengths = boundary.map((p, i) => distance(p, boundary[(i + 1) % boundary.length]));
    const offsets = [0]; lengths.forEach(length => offsets.push(offsets.at(-1)! + length));
    const perimeter = offsets.at(-1)!;
    const cuts = gates.flatMap(i => [-perimeter, 0, perimeter].map(shift => [offsets[i] + shift - 1.65, offsets[i] + shift + 1.65]));
    return boundary.flatMap((a, i) => {
        const b = boundary[(i + 1) % boundary.length], start = offsets[i], end = offsets[i + 1];
        let spans = [[start, end]];
        for (const [lo, hi] of cuts) spans = spans.flatMap(([x, y]) => hi <= x || lo >= y ? [[x,y]] : [[x,Math.min(lo,y)],[Math.max(hi,x),y]].filter(([u,v])=>v-u>.03));
        const at = (d: number) => point(a.x + (b.x-a.x)*(d-start)/lengths[i], a.z + (b.z-a.z)*(d-start)/lengths[i]);
        return spans.map(([x,y])=>({from:at(x),to:at(y),width:.55}));
    });
}

/** A bounded half-unit navigation grid keeps approaches away from every future
 * building. Simplification tests complete segments, so diagonals cannot cut lots. */
function route(start: PlanPoint, end: PlanPoint, bounds: CityPlan['bounds'], clear: (p: PlanPoint)=>boolean, orthogonal: boolean): PlanPoint[] {
    const left = Math.floor(bounds.left*2), back = Math.floor(bounds.back*2), width = Math.ceil(bounds.right*2)-left+1, height = Math.ceil(bounds.front*2)-back+1;
    const index = (p: PlanPoint) => (Math.round(p.z*2)-back)*width+Math.round(p.x*2)-left;
    const position = (id: number) => point((id%width+left)/2,(Math.floor(id/width)+back)/2);
    const source = index(start), goal = index(end), costs = new Float64Array(width*height).fill(Infinity), previous = new Int32Array(width*height).fill(-1);
    const queue: {id:number;priority:number}[] = [];
    const push = (id:number,priority:number) => { let i=queue.length;queue.push({id,priority});while(i){const p=(i-1)>>1;if(queue[p].priority<=priority)break;queue[i]=queue[p];i=p;}queue[i]={id,priority}; };
    const pop = () => {const first=queue[0],last=queue.pop()!;if(queue.length){let i=0;while(i*2+1<queue.length){let c=i*2+1;if(c+1<queue.length&&queue[c+1].priority<queue[c].priority)c++;if(queue[c].priority>=last.priority)break;queue[i]=queue[c];i=c;}queue[i]=last;}return first;};
    const segmentClear = (a:PlanPoint,b:PlanPoint) => { const n=Math.ceil(distance(a,b)*8);for(let i=0;i<=n;i++)if(!clear(point(a.x+(b.x-a.x)*i/n,a.z+(b.z-a.z)*i/n)))return false;return true; };
    if(orthogonal){
        for(const corner of [point(start.x,end.z),point(end.x,start.z)])if(segmentClear(start,corner)&&segmentClear(corner,end))return [start,corner,end].filter((p,i,path)=>!i||distance(p,path[i-1])>.01);
    }
    costs[source]=0;push(source,0);
    const moves = orthogonal ? [[1,0],[-1,0],[0,1],[0,-1]] : [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    while(queue.length){
        const {id}=pop();if(id===goal)break;
        const a=position(id),x=id%width,z=Math.floor(id/width);
        for(const [dx,dz] of moves){
            if(x+dx<0||x+dx>=width||z+dz<0||z+dz>=height)continue;
            const next=id+dx+dz*width,b=position(next),cost=costs[id]+Math.hypot(dx,dz);
            if(cost>=costs[next]||!segmentClear(a,b))continue;
            costs[next]=cost;previous[next]=id;push(next,cost+distance(b,end)*2);
        }
    }
    if(previous[goal]===-1&&source!==goal) throw new Error('City layout has an unreachable entrance');
    const raw:PlanPoint[]=[];for(let id=goal;id!==-1;id=previous[id]){raw.push(position(id));if(id===source)break;}raw.reverse();raw[0]=start;raw[raw.length-1]=end;
    const result=[start];let anchor=0;
    while(anchor<raw.length-1){let next=anchor+1;while(next+1<raw.length&&(!orthogonal||raw[next+1].x===raw[anchor].x||raw[next+1].z===raw[anchor].z)&&segmentClear(raw[anchor],raw[next+1]))next++;result.push(raw[next]);anchor=next;}
    return result;
}

function roundRoute(path:PlanPoint[],clear:(p:PlanPoint)=>boolean):PlanPoint[]{
    const result=[path[0]];
    for(let i=1;i<path.length-1;i++){
        const a=path[i-1],b=path[i],c=path[i+1];let bend:PlanPoint[]|undefined;
        for(const radius of [1,.5,.2]){
            const d=Math.min(radius,distance(a,b)*.35,distance(b,c)*.35);
            const entry=point(b.x+(a.x-b.x)*d/distance(a,b),b.z+(a.z-b.z)*d/distance(a,b));
            const exit=point(b.x+(c.x-b.x)*d/distance(b,c),b.z+(c.z-b.z)*d/distance(b,c));
            const curve=Array.from({length:9},(_,j)=>{const t=j/8,u=1-t;return point(u*u*entry.x+2*u*t*b.x+t*t*exit.x,u*u*entry.z+2*u*t*b.z+t*t*exit.z);});
            if(curve.every(clear)){bend=curve;break;}
        }
        result.push(...(bend??[b]));
    }
    result.push(path.at(-1)!);return result;
}

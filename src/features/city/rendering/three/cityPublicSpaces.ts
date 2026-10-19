import { cityPlan, planContains, type PlanPoint } from './cityPlan';
import { cityLayout, cityRenderGrowth } from './layout';
import { cityStreets, type CityStreet } from './cityStreets';
import type { CityEnvironment } from '../../domain/environment';

export type PublicSpace = Readonly<PlanPoint & { radius: number }>;
export type LandmarkSpace = PublicSpace & { kind: 'fountain' | 'grove' | 'fire' };
type PublicSpaces = { landmark?: LandmarkSpace; squares: PublicSpace[] };
const cache = new Map<string, PublicSpaces>();
const distance = (p:PlanPoint,a:PlanPoint,b:PlanPoint) => {
    const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));
    return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);
};

/** Presentation spaces reserve every future site, not just today's buildings.
 * Roads remain the authority for both walking and decorative clearance. */
export function cityPublicSpaces(main:number,environment?:CityEnvironment):PublicSpaces {
    if(main<1)return {squares:[]};
    const key=JSON.stringify(environment?.layout?environment:[main,environment]);
    const cached=cache.get(key);if(cached)return cached;
    const plan=cityPlan(environment),g=cityRenderGrowth(main,environment),streets=cityStreets(main,environment);
    const plots=cityLayout({market:plan?5:main},[],environment).filter(p=>p.type==='market'||p.slot!==undefined&&p.slot<16);
    const buildingClearance=(p:PlanPoint,forecourt=false)=>Math.min(...plots.map(plot=>{
        const x=plot.x/g,z=plot.z/g,market=plot.type==='market',half=(market?2.4:1.7)/g;
        const lo=z-(market?2:1.7)/g,hi=z+(market&&forecourt?3.7:market?2:1.7)/g;
        return Math.hypot(Math.max(0,Math.abs(p.x-x)-half),Math.max(0,lo-p.z,p.z-hi));
    }));
    const edgeClearance=(p:PlanPoint)=>plan&&!planContains(plan.boundary,p)?-1:plan?Math.min(...plan.boundary.map((a,i)=>distance(p,a,plan.boundary[(i+1)%plan.boundary.length])))-.5:Infinity;
    const roadClearance=(p:PlanPoint)=>Math.min(...streets.map(s=>distance(p,{x:s.from[0],z:s.from[1]},{x:s.to[0],z:s.to[1]})-s.width/2));
    const squares:PublicSpace[]=[];
    const candidates=plan?[plan.hub,...plan.streets.flatMap(s=>[s.from,s.to])]:streets.flatMap(s=>s.from[0]===s.to[0]&&s.from[0]===0?[{x:0,z:-.25},{x:0,z:3.75},{x:0,z:7.75}]:[]);
    for(const p of candidates){
        if(squares.length>=3||squares.some(s=>Math.hypot(s.x-p.x,s.z-p.z)<4))continue;
        const directions:number[]=[];
        for(const s of streets){
            const a={x:s.from[0],z:s.from[1]},b={x:s.to[0],z:s.to[1]};
            if(distance(p,a,b)>.04)continue;
            for(const end of [a,b]){
                if(Math.hypot(end.x-p.x,end.z-p.z)<.08)continue;
                const angle=Math.atan2(end.z-p.z,end.x-p.x);
                if(directions.every(old=>Math.abs(Math.atan2(Math.sin(old-angle),Math.cos(old-angle)))>.25))directions.push(angle);
            }
        }
        if(directions.length<3)continue;
        const radius=Math.min(squares.length?.78:1.05,buildingClearance(p)-.12,edgeClearance(p)-.1);
        if(radius>=.55)squares.push({x:p.x,z:p.z,radius});
    }
    let landmark:LandmarkSpace|undefined;
    if(plan){
        const radius=environment!.layout==='elf'?1.55:1.3;
        let best=-Infinity;
        for(let z=plan.bounds.back+2;z<plan.bounds.front-2;z+=.5)for(let x=plan.bounds.left+2;x<plan.bounds.right-2;x+=.5){
            const p={x,z},clearance=Math.min(buildingClearance(p,true)-.15,edgeClearance(p),roadClearance(p)-.2);
            if(clearance<radius||squares.some(s=>Math.hypot(s.x-x,s.z-z)<s.radius+radius+.2))continue;
            const score=Math.min(clearance,radius+.8)*.5-Math.hypot(x-plan.market.x,z-plan.market.z)*.18;
            if(score>best){best=score;landmark={x,z,radius,kind:environment!.layout==='roman'?'fountain':environment!.layout==='elf'?'grove':'fire'};}
        }
    }
    const result={landmark,squares};
    if(cache.size>=64)cache.delete(cache.keys().next().value!);
    cache.set(key,result);return result;
}

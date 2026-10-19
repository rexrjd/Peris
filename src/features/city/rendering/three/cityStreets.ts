import { cityFootprint, cityRenderGrowth, riverX, cityShoreX, type CityPlot } from './layout';
import { slotCount } from '../../domain/slots';
import { cityRandom, type CityEnvironment } from '../../domain/environment';
import { cityPlan } from './cityPlan';

export type CityStreet = { from: [number, number]; to: [number, number]; width: number };
export const CITY_LANDSCAPE_EDGE = 96;
/** Landscape coordinates. Buildings face their cross-street instead of a radial hub. */
export function cityStreets(mainLevel: number, environment?:CityEnvironment): CityStreet[] {
    const plan=cityPlan(environment);
    if(plan){
        const streets:CityStreet[]=plan.streets.map(({from,to,width})=>({from:[from.x,from.z],to:[to.x,to.z],width}));
        if(environment?.water!=='none')streets.push({from:[plan.front.point.x,plan.bounds.front+4],to:[riverX(plan.bounds.front+5.5,environment)-.85,plan.bounds.front+5.5],width:.6});
        return streets;
    }
    const footprint = cityFootprint(mainLevel,environment), rows = Math.ceil(slotCount(mainLevel) / 4);
    const streets: CityStreet[] = [];
    const road = (x: number, z: number, x2: number, z2: number, width = .5) => streets.push({ from: [x, z], to: [x2, z2], width });
    const avenue=Math.min(1.05,4-3.2/cityRenderGrowth(mainLevel,environment)-.18);
    road(0, -4.2, 0, footprint.front, avenue);
    road(-.4, -CITY_LANDSCAPE_EDGE, -.4, -7.6, .8);
    for (let row = 0; row < rows; row++) road(-7.6, -.25 + row * 4, 7.6, -.25 + row * 4, .48);
    road(-7.6, -.25, -7.6, footprint.front - 1.2, .42);
    road(7.6, -.25, 7.6, footprint.front - 1.2, .42);
    road(7.6, 2.4, 11.4, 2.4, .58);
    road(0, footprint.front, 0, CITY_LANDSCAPE_EDGE, 1.05);
    road(-CITY_LANDSCAPE_EDGE, footprint.outsideRoad, CITY_LANDSCAPE_EDGE, footprint.outsideRoad, .85);
    road(-9.9, -2.3, -9.9, footprint.outsideRoad, .6);
    road(-9.9, -2.3, -12, -2.3, .5);
    road(-9.9, 6.7, -12, 6.7, .5);
    road(11.6, -2.3, 11.6, footprint.outsideRoad, .6);
    road(11.6, -2.3, 13, -2.3, .5);
    if(!environment||environment.water!=='none')road(0, footprint.outsideRoad, riverX(footprint.fishingZ,environment)-.85, footprint.fishingZ, .6);
    return streets;
}

export function cityStreetClearance(x: number, z: number, mainLevel: number, environment?:CityEnvironment) {
    return Math.min(...cityStreets(mainLevel,environment).map(({ from, to, width }) => {
        const dx = to[0] - from[0], dz = to[1] - from[1];
        const t = Math.max(0, Math.min(1, ((x - from[0]) * dx + (z - from[1]) * dz) / (dx * dx + dz * dz)));
        return Math.hypot(x - from[0] - t * dx, z - from[1] - t * dz) - width / 2;
    }));
}

/** The same streets guide visual walkers; they stop at entrances, clear of roofs. */
export function cityWalkRoute(plot: CityPlot, growth: number, mainLevel: number, environment?:CityEnvironment): [number, number][] {
    const f = cityFootprint(mainLevel,environment), x = plot.x / growth, z = plot.z / growth;
    const plan=cityPlan(environment),coordinates=(path:readonly {x:number;z:number}[]):[number,number][]=>path.map(p=>[p.x,p.z]);
    if(plan){
        if(plot.type==='market')return coordinates([plan.hub,{x:plan.market.x,z:plan.market.z+2.2}]);
        if(plot.slot!==undefined&&plot.slot<16)return coordinates(plan.routes[plot.slot]);
        const approach=coordinates(plan.gateRoutes[0]),gate=plan.front.point;
        approach.push([gate.x,f.outsideRoad]);
        if(plot.slot===16)return [...approach,[x-.85,z]];
        const lane=x<0?plan.serviceLane:13;
        return [...approach,[lane,f.outsideRoad],[lane,z+1.7],[x,z+1.7]];
    }
    if (plot.type === 'market') return [[0, -.25], [0, -4.2]];
    if (plot.slot !== undefined && plot.slot < 16) return [[0, -.25], [0, z + 1.75], [x, z + 1.75], [x, z + 1.35]];
    if (plot.slot === 16) return [[0, -.25], [0, f.front], [0, f.outsideRoad], [x-.85, z]];
    const lane = x < 0 ? -9.9 : 11.6;
    return [[0, -.25], [0, f.front], [0, f.outsideRoad], [lane, f.outsideRoad], [lane, z + 1.7], [x, z + 1.7]];
}
export function cityTerrainHeight(x: number, z: number, mainLevel: number, environment?:CityEnvironment) {
    if(environment?.water==='coast'&&x>cityShoreX(z,mainLevel,environment))return -.12;
    const footprint=cityFootprint(mainLevel,environment);
    const flat = (environment?.layout ? x>footprint.left-10&&x<18&&z>footprint.back-4 : Math.abs(x) < 18 && z > -12) && z < footprint.fishingZ + 2;
    if (flat || (!environment||environment.water==='river')&&Math.abs(x - riverX(z,environment)) < 1.3) return -.04;
    if(environment){
        const relief=environment.terrain==='mountain'?.15:environment.terrain==='snow'?.10:environment.terrain==='marsh'?.02:.04;
        const distance=Math.max(0,-z-14,Math.abs(x)-18,z-cityFootprint(mainLevel,environment).fishingZ-3);
        const phase=cityRandom(environment,12)*Math.PI*2;
        return distance*relief*(1+Math.sin(x*.07+phase)*Math.cos(z*.055-phase)*.55)+Math.sin(x*.12+phase)*Math.sin(z*.16-phase)*Math.min(.5,distance*.03)-.04;
    }
    return Math.max(0, -z - 14) * .07 + Math.max(0, Math.abs(x) - 18) * .035 + Math.sin(x * .12) * Math.sin(z * .16) * .1 - .04;
}

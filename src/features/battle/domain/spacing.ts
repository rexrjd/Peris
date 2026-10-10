import type { Formation } from './types';
import { formationSize } from './formations';
/** Project the visible formation footprint onto the direction of contact. */
export function extent(f: Formation, dx: number, dy: number) {
    const length=Math.hypot(dx,dy)||1,a=f.facing*Math.PI/180,size=formationSize({...f,soldiers:f.initial_soldiers});
    const front=(dx*Math.cos(a)+dy*Math.sin(a))/length,side=(-dx*Math.sin(a)+dy*Math.cos(a))/length;
    return Math.hypot(front*size.depth/2,side*size.width/2);
}
export const contactDistance=(f:Formation,t:Formation)=>extent(f,t.x-f.x,t.y-f.y)+extent(t,f.x-t.x,f.y-t.y)+8;

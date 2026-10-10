import type { Battle, Formation } from './types';
import { dist } from '../../../shared/math/geometry';
import { contactDistance } from './spacing';
/** Ownership never implies manual control. Both armies use the same policy. */
export function chooseAI(_b: Battle, fs: Formation[]) {
    const live=fs.filter(f=>f.soldiers>0&&f.status!=='routed').sort((a,b)=>a.id-b.id);
    const assigned=new Map<number,number>();
    for(const f of live){
        const enemies=live.filter(e=>e.side!==f.side);if(!enemies.length)continue;
        const score=(t:Formation)=>Math.max(0,dist(f,t)-contactDistance(f,t))+(assigned.get(t.id)??0)*45-(f.unit_type==='cavalry'&&t.unit_type==='archers'?110:0);
        const candidate=[...enemies].sort((a,b)=>score(a)-score(b)||a.id-b.id)[0];
        const previous=enemies.find(t=>t.id===f.target_formation_id);
        const target=previous&&(dist(f,previous)<=contactDistance(f,previous)+30||score(previous)<=score(candidate)*1.3+15)?previous:candidate;
        if(f.target_formation_id!==target.id){f.damage_pool=0;f.damage_target_id=target.id;}
        f.target_formation_id=target.id;f.target_x=target.x;f.target_y=target.y;f.fire_at_will=true;
        f.running=f.unit_type==='cavalry'&&dist(f,target)>contactDistance(f,target)+70&&f.stamina>35;
        f.stance=f.unit_type==='infantry'&&target.unit_type==='cavalry'&&dist(f,target)<180?'guard':'balanced';
        assigned.set(target.id,(assigned.get(target.id)??0)+1);
    }
}

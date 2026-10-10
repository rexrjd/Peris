import { FIELD_W, FIELD_H } from './dimensions';
import type { Battle, BattleOrder, Formation } from './types';
import { angleDiff, clamp, dist } from '../../../shared/math/geometry';
import { UNITS } from '../../army/domain/units';
import { terrainAt } from './terrain';
import { contactDistance, extent } from './spacing';
export function moveTargets(selected:Formation[],order:BattleOrder){
    const cx=selected.reduce((n,f)=>n+f.x,0)/selected.length,cy=selected.reduce((n,f)=>n+f.y,0)/selected.length;
    const spacing=Math.min(620/Math.max(1,selected.length-1),(order.columns??10)*8+24),angle=(order.facing??0)*Math.PI/180;
    return selected.map((f,i)=>({id:f.id,x:clamp((order.x??cx)+(order.facing===undefined?f.x-cx:-Math.sin(angle)*(i-(selected.length-1)/2)*spacing),35,FIELD_W-35),y:clamp((order.y??cy)+(order.facing===undefined?f.y-cy:Math.cos(angle)*(i-(selected.length-1)/2)*spacing),40,FIELD_H-40)}));
}
/** Read one position snapshot; commit movement for both sides before combat. */
export function moveFormations(b:Battle,fs:Formation[],_byId:Map<number,Formation>,dt:number){
    const start=new Map(fs.map(f=>[f.id,{...f}]));
    for(const f of fs){
        if(f.soldiers<=0)continue;
        if(f.status==='routed'){f.x=clamp(f.x+(f.side==='attacker'?-1:1)*64*dt,12,FIELD_W-12);f.facing=f.side==='attacker'?180:0;continue;}
        const enemy=f.target_formation_id?start.get(f.target_formation_id):undefined;
        if(!enemy||enemy.soldiers<=0||enemy.status==='routed'){f.target_formation_id=null;f.target_x=f.x;f.target_y=f.y;f.status='idle';continue;}
        const distance=dist(f,enemy),contact=contactDistance(f,enemy);
        let tx=enemy.x,ty=enemy.y,reach=f.unit_type==='archers'?UNITS.archers.range-12:contact;
        const threat=[...start.values()].filter(t=>t.side!==f.side&&t.soldiers>0&&t.status!=='routed'&&t.unit_type!=='archers').sort((a,c)=>dist(f,a)-dist(f,c)||a.id-c.id)[0];
        if(f.unit_type==='archers'&&threat&&dist(f,threat)<contactDistance(f,threat)+65){
            const d=dist(f,threat)||1;
            tx=clamp(f.x+(f.x-threat.x)/d*85,40,FIELD_W-40);ty=clamp(f.y+(f.y-threat.y)/d*85,45,FIELD_H-45);
            if(dist(f,{x:tx,y:ty})>12)reach=0;else {tx=enemy.x;ty=enemy.y;reach=contact;}
        }else if(f.unit_type==='cavalry'&&distance>240&&Math.abs(f.y-enemy.y)<85){
            ty=clamp(enemy.y+(f.y<FIELD_H/2?-120:120),65,FIELD_H-65);tx=enemy.x+(f.side==='attacker'?-145:145);reach=0;
        }
        f.target_x=tx;f.target_y=ty;
        const dx=tx-f.x,dy=ty-f.y,d=Math.hypot(dx,dy),moving=d>reach+2;
        const desired=Math.atan2(moving?dy:enemy.y-f.y,moving?dx:enemy.x-f.x)*180/Math.PI;
        f.facing+=clamp(angleDiff(desired,f.facing),-120*dt,120*dt);
        const ground=terrainAt(b.terrain,f.x,f.y);
        if(moving){
            const turn=Math.abs(angleDiff(desired,f.facing));
            const speed=UNITS[f.unit_type].speed*(f.magic_speed??1)*ground.speed*(f.unit_type==='cavalry'&&ground.kind==='Forest'?.65:1)*(f.running&&f.stamina>8?1.35:1)*(f.stamina<15?.75:1)*(turn>75?.25:turn>40?.65:1);
            const step=Math.min(speed*dt,Math.max(0,d-reach));
            f.x=clamp(f.x+dx/d*step,35,FIELD_W-35);f.y=clamp(f.y+dy/d*step,45,FIELD_H-45);f.status='moving';
            f.stamina=clamp(f.stamina-(f.running?1.4:.1)*dt,0,100);
            if(f.unit_type==='cavalry'&&f.running&&ground.kind!=='Forest'&&turn<40){f.charge_distance=(f.charge_distance??0)+step;if(f.charge_distance>=100&&f.stamina>35)f.charge_ready=true;}
        }else{f.status='engaged';f.running=false;f.stamina=clamp(f.stamina-(f.unit_type==='archers'?.12:.3)*dt,0,100);}
    }
    const correction=new Map<number,{x:number;y:number}>();
    const active=fs.filter(f=>f.soldiers>0&&f.status!=='routed').sort((a,c)=>a.id-c.id);
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
        const a=active[i],c=active[j];let dx=c.x-a.x,dy=c.y-a.y,d=Math.hypot(dx,dy);
        if(d<.001){dx=0;dy=a.id<c.id?1:-1;d=1;}
        const min=extent(a,dx,dy)+extent(c,-dx,-dy)+(a.side===c.side?10:4);
        if(d>=min)continue;
        const push=Math.min((min-d)*.5,50*dt),nx=dx/d*push,ny=dy/d*push;
        for(const [f,x,y] of [[a,-nx,-ny],[c,nx,ny]] as const){const v=correction.get(f.id)??{x:0,y:0};v.x+=x;v.y+=y;correction.set(f.id,v);}
    }
    for(const f of active){const v=correction.get(f.id);if(v){f.x=clamp(f.x+v.x,35,FIELD_W-35);f.y=clamp(f.y+v.y,45,FIELD_H-45);}}
}

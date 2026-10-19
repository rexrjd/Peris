import * as THREE from 'three';
import type { Faction } from '../../../factions/domain/factions';
import { cityKit } from './modelKit';
import type { LandmarkSpace } from './cityPublicSpaces';

/** Shared by the live city and its portrait; all solid geometry fits its reserved clearing. */
export function createCityLandmark(space:LandmarkSpace,faction:Faction,growth:number){
    const k=cityKit(faction),{m,box,cylinder,cone,rock}=k,r=space.radius*growth;
    const motions:{mesh:THREE.Object3D;y:number;scale:number}[]=[];
    let flame:THREE.MeshStandardMaterial|undefined;
    if(space.kind==='fountain'){
        box(r*1.38,.055,r*1.38,0,-.015,0,m.road);
        for(const side of [-1,1]){
            box(r*1.34,.045,.07,0,.04,side*r*.67,m.darkStone);
            box(.07,.045,r*1.34,side*r*.67,.04,0,m.darkStone);
        }
        cylinder(r*.72,.12,0,.05,0,m.darkStone);
        cylinder(r*.67,.18,0,.16,0,m.light);
        const water=new THREE.MeshStandardMaterial({color:0x6cbbc6,roughness:.3,metalness:.12});water.name='Civic fountain water';
        cylinder(r*.58,.025,0,.33,0,water);
        cylinder(.14,.54,0,.34,0,m.stone);cylinder(.42,.07,0,.82,0,m.light);cylinder(.35,.025,0,.89,0,water);
        const jet=cylinder(.035,.36,0,.91,0,water);motions.push({mesh:jet,y:jet.position.y,scale:jet.scale.y});
        for(let i=0;i<6;i++){
            const angle=i*Math.PI/3,x=Math.cos(angle)*.31,z=Math.sin(angle)*.31;
            const stream=cylinder(.018,.46,x,.4,z,water);motions.push({mesh:stream,y:stream.position.y,scale:stream.scale.y});
        }
        for(const side of [-1,1]){
            box(.7,.12,.3,side*r*.7,.24,0,m.light);
            for(const dz of [-.09,.09])box(.12,.24,.12,side*r*.7,0,dz,m.stone);
        }
    }else if(space.kind==='grove'){
        cylinder(r*.9,.045,0,-.018,0,m.earth);
        for(let i=0;i<12;i++){const a=i*Math.PI/6;rock(.12,Math.cos(a)*r*.86,.015,Math.sin(a)*r*.86,m.stone);}
        const tree=(x:number,z:number,height:number)=>{
            const trunk=cylinder(.105,height,x,.02,z,m.wood);trunk.rotation.z=x*.09;
            const crown=rock(.66,x,height*.68,z,m.leaf);crown.scale.y=.72;
            const upper=rock(.49,x+.12,height*.92,z-.08,m.green);upper.scale.y=.78;
            for(const side of [-1,1]){const branch=box(.065,.52,.065,x+side*.1,height*.5,z,m.timber);branch.rotation.z=-side*.48;}
        };
        tree(-.65,-.38,2.15);tree(.65,-.45,2.45);tree(.12,.72,1.9);
        const stone=rock(.38,0,.03,-.15,m.light);stone.scale.y=.65;
        const rune=new THREE.MeshStandardMaterial({color:0xd1e7ba,emissive:0x789d64,emissiveIntensity:.35,roughness:1});
        for(const y of [.22,.35,.48])box(.12,.025,.025,0,y,.17,rune);
    }else{
        cylinder(r*.9,.04,0,-.01,0,m.earth);
        for(let i=0;i<10;i++){const a=i*Math.PI/5;rock(.16,Math.cos(a)*.64,.025,Math.sin(a)*.64,m.darkStone);}
        for(const angle of [Math.PI/5,-Math.PI/5])box(.95,.12,.12,0,.12,0,m.timber,angle);
        flame=new THREE.MeshStandardMaterial({color:0xffb34f,emissive:0xff7629,emissiveIntensity:1,roughness:1});flame.name='Gathering flame';
        const outer=cone(.36,.86,0,.21,0,flame);motions.push({mesh:outer,y:outer.position.y,scale:outer.scale.y});
        const coreMaterial=new THREE.MeshStandardMaterial({color:0xffe6a0,emissive:0xffc363,emissiveIntensity:1.2,roughness:1});
        const core=cone(.18,.6,.04,.23,.03,coreMaterial);motions.push({mesh:core,y:core.position.y,scale:core.scale.y});
        for(let i=0;i<5;i++){
            const a=i*Math.PI*2/5,x=Math.cos(a)*r*.73,z=Math.sin(a)*r*.73;
            cylinder(.22,.27,x,.015,z,m.wood);cylinder(.25,.05,x,.285,z,m.timber);
        }
        for(const side of [-1,1]){
            cylinder(.04,1.1,side*r*.7,0,-.65,m.wood);
            const trophy=rock(.12,side*r*.7,1.05,-.65,m.light);trophy.scale.y=.15;
        }
    }
    motions.forEach(({mesh})=>{mesh.userData.cityMotion='civicLandmark';});
    const group=k.finish();group.name=`Civic ${space.kind}`;group.position.set(space.x*growth,0,space.z*growth);
    group.userData.landmark=space.kind;
    return {group,animate(time:number,reduced:boolean){
        if(flame)flame.emissiveIntensity=reduced?1:1+Math.sin(time*4.1)*.12;
        motions.forEach(({mesh,y,scale},i)=>{mesh.scale.y=scale*(reduced?1:1+Math.sin(time*(space.kind==='fire'?3.8:1.7)+i)*.055);mesh.position.y=y;});
    }};
}

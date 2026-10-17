import {FACTIONS,type Faction} from '../../../factions/domain/factions';
import * as THREE from 'three';
import { type CityPlot } from './layout';
import { cityWalkRoute } from './cityStreets';
/** Small moving silhouettes; paths follow streets and use the southern gate. */
export function createVillagers(faction:Faction='roman') {
 const palette=FACTIONS[faction];
 const group=new THREE.Group(),count=22,bodyShape=new THREE.BoxGeometry(.16,.25,.13),headShape=new THREE.IcosahedronGeometry(.09,0),legShape=new THREE.BoxGeometry(.055,.19,.055);
 const body=new THREE.InstancedMesh(bodyShape,new THREE.MeshStandardMaterial({color:0xffffff,flatShading:true}),count);
 const head=new THREE.InstancedMesh(headShape,new THREE.MeshStandardMaterial({color:palette.skin,flatShading:true}),count);
 const legs=new THREE.InstancedMesh(legShape,new THREE.MeshStandardMaterial({color:0x65503b,flatShading:true}),count*2);
 const ears=faction==='pandaren'?new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.05,0),new THREE.MeshStandardMaterial({color:0x292a27,flatShading:true}),count*2):null;
 if(ears){ears.frustumCulled=false;group.add(ears);}
 const parcels=new THREE.InstancedMesh(new THREE.BoxGeometry(.13,.13,.13),new THREE.MeshStandardMaterial({color:0x9c784e,flatShading:true}),count);
 for(let i=0;i<count;i++)body.setColorAt(i,new THREE.Color([palette.green,palette.roof,palette.slate,palette.gold][i%4]));
 for(const mesh of [body,head,legs,parcels]) {mesh.frustumCulled=false;group.add(mesh);}
 let paths:{points:THREE.Vector3[];lengths:number[];total:number}[]=[];const dummy=new THREE.Object3D(),position=new THREE.Vector3();
 return {group,setPlots(plots:CityPlot[],growth:number,mainLevel:number){
  paths=plots.filter(p=>p.type!=='wall'&&p.level>0).map(plot=>{
   const points=cityWalkRoute(plot,growth,mainLevel).map(([x,z])=>new THREE.Vector3(x*growth,0,z*growth));
   const lengths=points.slice(1).map((point,j)=>point.distanceTo(points[j]));
   return {points,lengths,total:lengths.reduce((sum,length)=>sum+length,0)};
  });
  if(!paths.length)paths=[{points:[new THREE.Vector3(0,0,-.25),new THREE.Vector3(0,0,2)],lengths:[2.25],total:2.25}];
 },animate(time:number){
  if(!paths.length)return;
  for(let i=0;i<count;i++){
   const {points:path,lengths,total}=paths[i%paths.length];
   if(!path)continue;
   // Different paces and short stops at each destination keep the town from marching in sync.
   const pause=.65+(i%3)*.2,phase=(time*(.00048+(i%5)*.000035)+i*2.173)%(total*2+pause*2);
   const returning=phase>total+pause*2,waiting=phase<pause||phase>total+pause&&phase<=total+pause*2;
   const distance=phase<pause?0:phase<=total+pause?phase-pause:phase<=total+pause*2?total:total*2+pause*2-phase;
   let remaining=distance,index=0;while(index<lengths.length-1&&remaining>lengths[index])remaining-=lengths[index++];
   const from=path[index],to=path[index+1];position.lerpVectors(from,to,remaining/Math.max(.001,lengths[index]));
   const angle=Math.atan2(to.x-from.x,to.z-from.z)+(returning?Math.PI:0),step=waiting?0:Math.sin(time*.009+i)*.045;
   dummy.scale.set(palette.scale,palette.scale,palette.scale);dummy.rotation.set(0,angle,0);dummy.position.set(position.x,.32*palette.scale,position.z);dummy.updateMatrix();body.setMatrixAt(i,dummy.matrix);
   dummy.position.y=.53*palette.scale;dummy.updateMatrix();head.setMatrixAt(i,dummy.matrix);
   for(let side=0;side<2;side++){dummy.position.set(position.x+(side?1:-1)*.047,.105*palette.scale,position.z+(side?step:-step));dummy.updateMatrix();legs.setMatrixAt(i*2+side,dummy.matrix);}
   if(ears)for(const side of [-1,1]){dummy.position.set(position.x+side*.065*palette.scale,.6*palette.scale,position.z);dummy.updateMatrix();ears.setMatrixAt(i*2+(side+1)/2,dummy.matrix);}
   dummy.position.set(position.x+Math.cos(angle)*.12,.32*palette.scale,position.z-Math.sin(angle)*.12);if(i%3)dummy.scale.setScalar(0);dummy.updateMatrix();parcels.setMatrixAt(i,dummy.matrix);
  }
  for(const mesh of [body,head,legs,parcels])mesh.instanceMatrix.needsUpdate=true;
  if(ears)ears.instanceMatrix.needsUpdate=true;
 }};
}

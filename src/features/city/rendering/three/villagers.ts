import * as THREE from 'three';
import type { CityPlot } from './layout';
/** Small moving silhouettes; paths follow streets and use the southern gate. */
export function createVillagers() {
 const group=new THREE.Group(),count=12,bodyShape=new THREE.BoxGeometry(.16,.25,.13),headShape=new THREE.IcosahedronGeometry(.09,0),legShape=new THREE.BoxGeometry(.055,.19,.055);
 const body=new THREE.InstancedMesh(bodyShape,new THREE.MeshStandardMaterial({color:0xffffff,flatShading:true}),count);
 const head=new THREE.InstancedMesh(headShape,new THREE.MeshStandardMaterial({color:0xbdaa85,flatShading:true}),count);
 const legs=new THREE.InstancedMesh(legShape,new THREE.MeshStandardMaterial({color:0x65503b,flatShading:true}),count*2);
 const parcels=new THREE.InstancedMesh(new THREE.BoxGeometry(.13,.13,.13),new THREE.MeshStandardMaterial({color:0x9c784e,flatShading:true}),count);
 for(let i=0;i<count;i++)body.setColorAt(i,new THREE.Color([0x547442,0x995536,0x5c7274,0xb8a477][i%4]));
 for(const mesh of [body,head,legs,parcels]) {mesh.frustumCulled=false;group.add(mesh);}
 let paths:THREE.Vector3[][]=[];const dummy=new THREE.Object3D();
 return {group,setPlots(plots:CityPlot[],growth:number){paths=plots.filter(p=>p.type!=='wall').map(p=>(Math.abs(p.x)>11*growth||p.slot===16)?[new THREE.Vector3(0,0,.1),new THREE.Vector3(.1*growth,0,11*growth),new THREE.Vector3(p.x,0,13*growth),new THREE.Vector3(p.x,0,p.z)]:[new THREE.Vector3(0,0,.1),new THREE.Vector3(p.x,0,p.z)]);},animate(time:number){
  if(!paths.length)return;
  for(let i=0;i<count;i++){
   const path=paths[i%paths.length],lengths=path.slice(1).map((p,j)=>p.distanceTo(path[j])),total=lengths.reduce((a,b)=>a+b,0);
   const phase=((time*.0008+i*.73)%(total*2)),distance=phase>total?total*2-phase:phase;
   let remaining=distance,index=0;while(index<lengths.length-1&&remaining>lengths[index])remaining-=lengths[index++];
   const from=path[index],to=path[index+1],position=from.clone().lerp(to,remaining/Math.max(.001,lengths[index]));
   const angle=Math.atan2(to.x-from.x,to.z-from.z)+(phase>total?Math.PI:0),step=Math.sin(time*.009+i)*.045;
   dummy.rotation.set(0,angle,0);dummy.position.set(position.x,.32,position.z);dummy.updateMatrix();body.setMatrixAt(i,dummy.matrix);
   dummy.position.y=.53;dummy.updateMatrix();head.setMatrixAt(i,dummy.matrix);
   for(let side=0;side<2;side++){dummy.position.set(position.x+(side?1:-1)*.047,.105,position.z+(side?step:-step));dummy.updateMatrix();legs.setMatrixAt(i*2+side,dummy.matrix);}
   dummy.position.set(position.x+.12,.32,position.z+.06);dummy.updateMatrix();parcels.setMatrixAt(i,dummy.matrix);
  }
  for(const mesh of [body,head,legs,parcels])mesh.instanceMatrix.needsUpdate=true;
 }};
}

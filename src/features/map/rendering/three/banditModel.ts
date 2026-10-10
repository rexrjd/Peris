import { Group,Mesh,ConeGeometry,CylinderGeometry,BoxGeometry,MeshStandardMaterial } from 'three';
import { FACTIONS,type Faction } from '../../../factions/domain/factions';
export function createBanditCampModel(faction:Faction){
 const group=new Group(),cloth=new MeshStandardMaterial({color:FACTIONS[faction].roof,roughness:1}),wood=new MeshStandardMaterial({color:0x6a4d38,roughness:1}),stone=new MeshStandardMaterial({color:0x797471,roughness:1});
 for(const [x,z]of [[-.2,-.14],[.18,-.12],[0,.2]]){const tent=new Mesh(new ConeGeometry(.12,.19,4),cloth);tent.position.set(x,.095,z);tent.rotation.y=Math.PI/4;tent.castShadow=true;group.add(tent);}
 const hearth=new Mesh(new CylinderGeometry(.065,.065,.025,8),stone);hearth.position.y=.013;group.add(hearth);
 const flame=new Mesh(new ConeGeometry(.035,.075,5),new MeshStandardMaterial({color:0xea9b42,emissive:0xb13e1c,emissiveIntensity:.6}));flame.position.y=.055;group.add(flame);
 const pole=new Mesh(new BoxGeometry(.012,.35,.012),wood);pole.position.set(-.3,.175,.05);group.add(pole);
 const flag=new Mesh(new BoxGeometry(.1,.075,.006),cloth);flag.position.set(-.25,.3,.05);group.add(flag);
 return group;
}

import * as THREE from 'three';
import type {Faction} from '../../../factions/domain/factions';
import {createBuildingModel} from '../../../city/rendering/three/buildingModels';
import {cityKit} from '../../../city/rendering/three/modelKit';
/** Strategic miniatures reuse the city's architecture, with no simulation state. */
export function createFactionSettlement(faction:Faction){
 const group=new THREE.Group(),hall=createBuildingModel('market',3,faction);hall.scale.setScalar(.23);hall.position.set(0,0,-.09);group.add(hall);
 const k=cityKit(faction);for(const [x,z] of [[-.3,.2],[.3,.23],[-.32,-.24],[.3,-.29]])k.house(x,z,.18,.2,.15,true);
 for(const x of [-.46,.46])k.box(.03,.08,.88,x,0,0,k.m.stone);k.box(.9,.08,.03,0,0,-.43,k.m.stone);
 for(const x of [-.3,.3])k.box(.3,.08,.03,x,0,.43,k.m.stone);
 group.add(k.finish());group.name=`${faction} strategic city`;return group;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FACTIONS } from '../src/features/factions/domain/factions';
import { ARMY_ROLES, armyRole } from '../src/features/battle/rendering/three/armyAssets';
import { newBattle } from '../src/features/battle/domain/creation';
import { createSolo } from '../src/features/campaign/domain/newRealm';

function metadata(path:string) {
    const data=readFileSync(path); assert.equal(data.toString('ascii',0,4),'glTF');assert.equal(data.readUInt32LE(8),data.length);
    return JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));
}
test('each faction ships nine skinned archetypes and matching near/far rig clips without decoder requirements',()=>{
    for(const faction of Object.keys(FACTIONS)) {
        for(const suffix of ['','-lod']) {
            const gltf=metadata(`public/models/battle/${faction}-army${suffix}.glb`);
            assert.equal(gltf.skins.length,9,faction);assert.equal(gltf.animations.length,27,faction);
            assert.ok(!(gltf.extensionsRequired || []).includes('KHR_draco_mesh_compression'));
            assert.ok(!(gltf.extensionsRequired || []).includes('EXT_meshopt_compression'));
            for(const role of ARMY_ROLES) {
                assert.ok(gltf.nodes.some((node:{name:string;skin?:number})=>node.name?.startsWith(role)&&node.skin!==undefined),`${faction} ${role} skin`);
                for(const clip of ['idle','walk','attack']) assert.ok(gltf.animations.some((a:{name:string;channels:unknown[]})=>a.name===`${role}_${clip}`&&a.channels.length>0));
                if(['scout','light_cavalry','heavy_cavalry'].includes(role)) {
                    const mesh=gltf.nodes.find((n:{name:string;skin?:number})=>n.name?.startsWith(role)&&n.skin!==undefined);
                    assert.equal(mesh.extras.peris_seated_bind_pose,true,`${faction} ${role} must use a seated rig`);
                    assert.ok(Math.abs(mesh.extras.peris_rider_hip_height-mesh.extras.peris_saddle_height-.5)<.001,'Pelvis must rest on the saddle');
                }
            }
        }
    }
});
test('presentation maps the seven formation looks without changing simulation data',()=>{
    const world=createSolo('test'), army={...world.armies[0],infantry:180,archers:30,cavalry:60};
    const {formations}=newBattle(7,'solo-ruler',army,army,'plains','normal','test','practice');
    const before=JSON.stringify(formations),own=formations.filter(f=>f.owner_id);
    assert.equal(new Set(own.map(f=>armyRole(f,formations))).size,7);
    assert.equal(new Set(formations.filter(f=>!f.owner_id).map(f=>armyRole(f,formations))).size,7);
    assert.equal(JSON.stringify(formations),before);
});

test('licensed prototype exports retain embedded textures and animation channels for infantry, horse and rider at both detail levels',()=>{
    const roles=['line_infantry','heavy_cavalry'];
    for(const suffix of ['','-lod']) {
        const gltf=metadata(`public/models/battle/reference-prototypes${suffix}.glb`);
        assert.equal(gltf.skins.length,3,'Infantry, rider and horse need distinct skeletons');
        assert.equal(gltf.animations.length,6,'Both roles need idle, walk and attack clips');
        assert.ok(!gltf.extensionsRequired?.includes('KHR_draco_mesh_compression'));
        assert.ok(!gltf.extensionsRequired?.includes('EXT_meshopt_compression'));
        assert.ok(gltf.images.length>0,'Imported texture images must survive export');
        for(const image of gltf.images) assert.ok(image.bufferView!==undefined&&!image.uri,'Textures must travel inside the GLB');
        for(const role of roles) {
            const parts=gltf.nodes.filter((node:{name?:string;mesh?:number})=>node.name?.startsWith(role)&&node.mesh!==undefined);
            assert.ok(parts.length>1,`${role} needs its assembled body and equipment`);
            const skins=new Set<number>(parts.map((node:{skin:number})=>node.skin));
            assert.equal(skins.size,role==='heavy_cavalry'?2:1,`${role} keeps the matching source rigs`);
            for(const part of parts) {
                assert.equal(part.extras.asset_author,'Wildfire Games');
                assert.equal(part.extras.asset_license,'CC-BY-SA-3.0');
                for(const primitive of gltf.meshes[part.mesh].primitives) {
                    assert.ok(primitive.attributes.JOINTS_0!==undefined&&primitive.attributes.WEIGHTS_0!==undefined,`${part.name} must follow its skeleton`);
                    assert.ok(gltf.materials[primitive.material].pbrMetallicRoughness.baseColorTexture,`${part.name} needs its imported surface texture`);
                }
            }
            for(const name of ['idle','walk','attack']) {
                const clip=gltf.animations.find((animation:{name:string})=>animation.name===`${role}_${name}`);
                assert.ok(clip,`${role} ${name} clip`);
                const targets=new Set(clip.channels.map((channel:{target:{node:number}})=>channel.target.node));
                for(const skin of skins) assert.ok(gltf.skins[skin].joints.some((joint:number)=>targets.has(joint)),`${role} ${name} must animate every participating rig`);
            }
        }
    }
    const credits=readFileSync('public/licenses/peris-unit-prototypes.txt','utf8');
    assert.match(credits,/Wildfire Games/);assert.match(credits,/https:\/\/wildfiregames\.com\//);
    assert.match(credits,/CC BY-SA 3\.0/);assert.match(credits,/https:\/\/creativecommons\.org\/licenses\/by-sa\/3\.0\//);
});

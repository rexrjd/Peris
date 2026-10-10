import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { FACTIONS } from '../src/features/factions/domain/factions';
import { ARMY_ROLES, armyRole } from '../src/features/battle/rendering/three/armyAssets';
import { newBattle } from '../src/features/battle/domain/creation';
import { createSolo } from '../src/features/campaign/domain/newRealm';

function metadata(path:string) {
    const data=readFileSync(path); assert.ok(data.length>=28,'GLB contains its header and JSON chunk');
    assert.equal(data.toString('ascii',0,4),'glTF');assert.equal(data.readUInt32LE(4),2);assert.equal(data.readUInt32LE(8),data.length);
    assert.equal(data.readUInt32LE(16),0x4e4f534a,'First GLB chunk is JSON');assert.ok(20+data.readUInt32LE(12)<=data.length);
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

// The report controls which textured prototypes are available in the preview.
// Technical export availability does not constitute visual art approval.
const rosterReport=JSON.parse(readFileSync('public/models/battle/faction-rosters.json','utf8'));
for(const faction of Object.keys(rosterReport.factions))test(`available textured faction ${faction} ships nine licensed roles, embedded PBR surfaces and matched independent rigs`,()=>{
    const report=rosterReport;
    for(const detail of ['near','far']){
        const suffix=detail==='near'?'':'-lod',path=`public/models/battle/${faction}-roster${suffix}.glb`,gltf=metadata(path);
        assert.ok(gltf.skins.length>=9,`${faction}: every role needs a rig; mounts may have separate skeletons`);
        assert.equal(gltf.animations.length,27,`${faction}: nine roles with idle, walk and attack`);
        assert.ok(!(gltf.extensionsRequired||[]).some((extension:string)=>['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'].includes(extension)));
        assert.ok(gltf.images.length>0);
        for(const image of gltf.images)assert.ok(image.bufferView!==undefined&&!image.uri,'All surfaces must travel inside each GLB');
        assert.ok(gltf.materials.some((material:{alphaMode?:string;alphaCutoff?:number})=>material.alphaMode==='MASK'&&(material.alphaCutoff??.5)>0&&(material.alphaCutoff??.5)<1),'Mane, tail and helmet crest cards retain alpha cutouts');
        assert.equal(report.factions[faction][detail].bytes,readFileSync(path).length,'Published availability tracks the validated output');
        for(const role of ARMY_ROLES){
            const parts=gltf.nodes.filter((node:{name?:string;mesh?:number})=>node.name?.startsWith(role)&&node.mesh!==undefined);
            assert.ok(parts.length>0,`${faction} ${role} geometry`);
            const skins=new Set<number>();
            for(const part of parts){
                assert.ok(part.skin!==undefined,`${faction} ${role} part must be rigged`);skins.add(part.skin);
                if(part.extras.asset_license==='CC-BY-4.0'){
                    const credit=JSON.parse(part.extras.peris_component_credit);
                    assert.ok(typeof credit.author==='string'&&credit.author.trim(),'Adapted components retain the original artist');
                    assert.ok(part.extras.asset_author.includes(credit.author),'Mesh attribution includes its credited artist');
                    assert.match(part.extras.source_url,/^https:\/\//);assert.match(part.extras.source_file_sha256,/^[a-f0-9]{64}$/);
                    assert.equal(credit.license,'CC-BY-4.0');assert.equal(credit.sourceUrl,part.extras.source_url);assert.equal(credit.sourceFileSha256,part.extras.source_file_sha256);
                    assert.equal(part.extras.peris_unit_finished,false,'Technical availability is separate from finished art approval');
                }else{
                    assert.equal(part.extras.asset_license,'CC-BY-SA-3.0');assert.match(part.extras.asset_author,/Wildfire Games/);
                }
                assert.equal(part.extras.peris_role,role);
                for(const primitive of gltf.meshes[part.mesh].primitives){
                    assert.ok(primitive.attributes.JOINTS_0!==undefined&&primitive.attributes.WEIGHTS_0!==undefined);
                    if(gltf.extensionsRequired?.includes('KHR_mesh_quantization')){
                        assert.equal(gltf.accessors[primitive.attributes.POSITION].componentType,5126,'Budget packing preserves authored float32 positions and bind-space transforms');
                        for(const semantic of ['NORMAL','TEXCOORD_0','WEIGHTS_0'])assert.equal(gltf.accessors[primitive.attributes[semantic]].normalized,true,'Packed surface/weight attributes require native normalization');
                    }
                    assert.ok(gltf.materials[primitive.material].pbrMetallicRoughness.baseColorTexture,`${faction} ${role} surface needs its textured atlas`);
                    assert.ok(gltf.materials[primitive.material].normalTexture&&gltf.materials[primitive.material].pbrMetallicRoughness.metallicRoughnessTexture,`${faction} ${role} preserves the atlas normal and metal/roughness surfaces`);
                }
            }
            if(['scout','light_cavalry','heavy_cavalry'].includes(role)){
                assert.ok(skins.size>=2,`${faction} ${role} preserves independent mount and rider rigs`);
                assert.ok(parts.some((part:{extras:{peris_seated_bind_pose?:boolean}})=>part.extras.peris_seated_bind_pose),`${faction} ${role} is assembled with a seated rider`);
                const customMount=parts.some((part:{extras:{peris_mount_species?:string}})=>part.extras.peris_mount_species);
                if(role==='heavy_cavalry'&&!['roman','spartan','persian','egyptian'].includes(faction))assert.ok(customMount,'Fantasy heavy cavalry retains its specific mount anatomy');
                // Custom species, including a scout warg, have evaluated fitting.
                // Source horse/rider pairs retain their original socket binding.
                if(customMount){
                    const fitted=gltf.nodes.filter((node:{extras?:{peris_role?:string;peris_seat_fit_error?:number}})=>node.extras?.peris_role===role&&node.extras.peris_seat_fit_error!==undefined);
                    assert.ok(fitted.length>=2,`${faction} ${role} records evaluated mount and rider seat fitting`);
                    for(const rig of fitted){
                        assert.ok(Number.isFinite(rig.extras.peris_seat_fit_error)&&rig.extras.peris_seat_fit_error>=0&&rig.extras.peris_seat_fit_error<=.005,'Evaluated idle pelvis must fit the animated saddle target');
                    }
                    const rider=fitted.find((rig:{extras:{peris_seat_hip_world?:number[]}})=>rig.extras.peris_seat_hip_world);
                    assert.ok(rider,'Rider records its actual evaluated hip position');
                    for(const field of ['peris_seat_hip_world','peris_seat_target_world'])assert.ok(Array.isArray(rider.extras[field])&&rider.extras[field].length===3&&rider.extras[field].every(Number.isFinite));
                }
            }
            for(const state of ['idle','walk','attack']){
                const clip=gltf.animations.find((animation:{name:string})=>animation.name===`${role}_${state}`);
                assert.ok(clip?.channels.length,`${faction} ${role} ${state} clip`);
                const targets=new Set(clip.channels.map((channel:{target:{node:number}})=>channel.target.node));
                for(const skin of skins)assert.ok(gltf.skins[skin].joints.some((joint:number)=>targets.has(joint)),`${faction} ${role} ${state} animates every participating rig`);
            }
        }
    }
});

for(const faction of Object.keys(rosterReport.withheld||{}))test(`withheld textured faction ${faction} retains its complete licensed archive without enabling preview availability`,()=>{
    const record=rosterReport.withheld[faction];
    assert.ok(typeof record.reason==='string'&&record.reason.trim().length>=20,'Withholding explains the unresolved review failure');
    assert.ok(typeof record.evidence==='string'&&/^(assets|artifacts)\//.test(record.evidence)&&existsSync(record.evidence),'Withholding links local review evidence');
    assert.ok(!Object.hasOwn(rosterReport.factions,faction),'A withheld faction cannot appear in the preview availability map');
    assert.ok(!Object.hasOwn(record,'near')&&!Object.hasOwn(record,'far'),'Preserved files remain nested archive records, not enabled packs');
    assert.ok(existsSync(`assets/source/battle/${rosterReport.edition}/peris-${faction}-army.blend`),'Earlier editable source remains preserved');
    for(const detail of ['near','far']){
        const archive=record.retained?.[detail],suffix=detail==='near'?'':'-lod',path=`public/models/battle/${faction}-roster${suffix}.glb`;
        assert.ok(archive,`${faction} retains its ${detail} archive record`);
        assert.equal(archive.path,path,'Archive paths identify the existing retained edition');
        const data=readFileSync(path),gltf=metadata(path);
        assert.equal(archive.bytes,data.length);assert.match(archive.sha256,/^[a-f0-9]{64}$/);
        assert.equal(archive.sha256,createHash('sha256').update(data).digest('hex'),'Retained geometry is fingerprinted, not silently replaced by a partial pilot');
        assert.ok(gltf.skins.length>=9,'The complete retained roster keeps its participating rigs');
        assert.equal(gltf.animations.length,27,'The retained nine roles keep their three clips');
        assert.ok(!(gltf.extensionsRequired||[]).some((extension:string)=>['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'].includes(extension)));
        assert.ok(gltf.images.length>0);for(const image of gltf.images)assert.ok(image.bufferView!==undefined&&!image.uri);
        for(const role of ARMY_ROLES){
            const parts=gltf.nodes.filter((node:{name?:string;mesh?:number})=>node.name?.startsWith(role)&&node.mesh!==undefined);
            assert.ok(parts.length>0,`${faction} archive retains ${role} geometry`);
            const skins=new Set<number>();
            for(const part of parts){
                assert.ok(Number.isInteger(part.skin)&&gltf.skins[part.skin]?.joints.length>0,`${role} archive part follows a retained skeleton`);skins.add(part.skin);
                assert.equal(part.extras.peris_role,role);assert.equal(part.extras.asset_license,'CC-BY-SA-3.0');assert.match(part.extras.asset_author,/Wildfire Games/);
                for(const primitive of gltf.meshes[part.mesh].primitives){
                    assert.ok(primitive.attributes.JOINTS_0!==undefined&&primitive.attributes.WEIGHTS_0!==undefined);
                    assert.equal(gltf.accessors[primitive.attributes.JOINTS_0].count,gltf.accessors[primitive.attributes.POSITION].count);
                    assert.equal(gltf.accessors[primitive.attributes.WEIGHTS_0].count,gltf.accessors[primitive.attributes.POSITION].count);
                }
            }
            for(const state of ['idle','walk','attack']){
                const clip=gltf.animations.find((animation:{name:string})=>animation.name===`${role}_${state}`);assert.ok(clip?.channels.length,`${role} archive keeps ${state}`);
                const targets=new Set(clip.channels.map((channel:{target:{node:number}})=>channel.target.node));
                for(const skin of skins)assert.ok(gltf.skins[skin].joints.some((joint:number)=>targets.has(joint)),`${role} ${state} keeps every participating rig animated`);
            }
        }
    }
});

test('actual roster publisher refuses a withheld faction before changing its retained packs or report',{skip:!Object.keys(rosterReport.withheld||{}).length},()=>{
    const faction=Object.keys(rosterReport.withheld||{})[0];assert.ok(faction,'Current quality review retains an explicitly withheld faction');
    const record=rosterReport.withheld[faction],paths=['public/models/battle/faction-rosters.json',record.retained.near.path,record.retained.far.path];
    const fingerprint=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
    const before=paths.map(fingerprint);
    const result=spawnSync(process.execPath,['scripts/prepare-faction-rosters.mjs',faction],{
        env:{...process.env,PERIS_ROSTER_EDITION:rosterReport.edition,PERIS_ROSTER_STAGE_ONLY:'0'},encoding:'utf8',timeout:15000,
    });
    assert.equal(result.error,undefined,'The real publication guard finishes without a timeout or spawn failure');
    assert.equal(result.status,1);assert.match(result.stderr,/Withheld factions require completed quality review before publication/);
    assert.ok(result.stderr.includes(faction),'The refusal identifies the selected withheld faction');
    assert.deepEqual(paths.map(fingerprint),before,'Rejected publication preserves both complete archives and their availability/withholding report');
});

test('legacy roster publisher cannot overwrite a newer immutable prototype edition',()=>{
    const faction=Object.keys(rosterReport.factions).find(key=>rosterReport.factions[key].sourceEdition&&rosterReport.factions[key].sourceEdition!==rosterReport.edition);
    assert.ok(faction,'The active upgraded prototypes retain their own source edition');
    const paths=['public/models/battle/faction-rosters.json',`public/models/battle/${faction}-roster.glb`,`public/models/battle/${faction}-roster-lod.glb`];
    const fingerprint=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');const before=paths.map(fingerprint);
    const result=spawnSync(process.execPath,['scripts/prepare-faction-rosters.mjs',faction],{env:{...process.env,PERIS_ROSTER_EDITION:rosterReport.edition,PERIS_ROSTER_STAGE_ONLY:'0'},encoding:'utf8',timeout:15000});
    assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,/Active prototype editions require their matching source publisher/);
    assert.ok(result.stderr.includes(faction));assert.deepEqual(paths.map(fingerprint),before,'Both packs and the availability report remain unchanged');
});

test('textured roster report accounts for all eleven factions through disjoint availability and explicit withholding, with editable source credits',()=>{
    const report=rosterReport,published=Object.keys(report.factions),withheld=Object.keys(report.withheld||{});
    assert.deepEqual(report.roles,[...ARMY_ROLES]);assert.equal(report.edition,'roster-v3');
    assert.ok(withheld.every(faction=>!published.includes(faction)),'A retained archive cannot also enable the rejected pack');
    assert.deepEqual([...published,...withheld].sort(),Object.keys(FACTIONS).sort(),'Every faction needs an available pack or a documented retained archive');
    const credits=readFileSync('public/licenses/peris-faction-rosters.txt','utf8');
    assert.match(credits,/Wildfire Games[\s\S]+CC BY-SA 3\.0/);
    assert.match(credits,/inventory-roster-v3\.json/);assert.match(credits,/roster-sources-v3\.json/);
    assert.match(credits,/https:\/\/creativecommons\.org\/licenses\/by-sa\/3\.0\//);
});

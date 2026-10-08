import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldScene, worldMinimapFootprints, FIELD_DETAIL_BUDGET, FIELD_MARKER_BUDGET } from '../src/features/map/rendering/three/WorldScene';
import { PreviewCamera } from '../src/features/map/preview/PreviewCamera';
import { MapSettlementModels } from '../src/features/map/rendering/three/factionSettlement';
import { CELL_SIZE, WORLD_W } from '../src/features/map/domain/dimensions';
import { sampleHeight } from '../src/features/map/rendering/three/landscape';
import { RenderContext } from '../src/shared/rendering/RenderContext';
import { MapRenderer } from '../src/features/map/rendering/MapRenderer';

test('live completed fields repeat over seams, preserve canonical picking and borrow cached geometry', () => {
    const view=new PreviewCamera(sampleHeight);view.setSize(1200,800);view.target.set(99,0,0);view.span=12;view.azimuth=.8;view.update();
    const models=new MapSettlementModels(),selected:unknown[]=[],cleared:Set<string>[]=[];
    const world={settlements:[{id:1,x:64,y:64,owner_id:'me',faction:'roman'}],players:[{id:'me',upgrades:0}],map_plots:[{col:-100,row:0,settlement_id:1,owner_id:'me',building_type:'farm',level:1,faction:'roman'}]};
    const fixture=Object.create(WorldScene.prototype) as {
        syncFields():void;hit(x:number,y:number):unknown;publishViewport():void;disposeGroup(group:THREE.Group):void;
        fields:Map<string,THREE.Group>;fieldCopies:Map<string,THREE.Group[]>;
    };
    const fieldGeometry=new THREE.BoxGeometry(.16,.11,.16),fieldMaterial=new THREE.MeshBasicMaterial();
    const fieldMarkers=new THREE.InstancedMesh(fieldGeometry,fieldMaterial,FIELD_MARKER_BUDGET);
    Object.assign(fixture,{view,scene:new THREE.Scene(),settlementModels:models,fields:new Map(),fieldCopies:new Map(),fieldKey:'',fieldMarkers,fieldMarkerSelections:[],entities:new Map(),entityCopies:new Map(),hittable:new Set(),hittableImages:new Map(),pickingRay:new THREE.Raycaster(),occlusion:new Map(),occlusionViewKey:'',viewportKey:'',landscape:{setConstructionCells:(cells:Set<string>)=>cleared.push(cells)},state:()=>({world,playerId:'me'}),actions:()=>({mapViewport:(bounds:unknown)=>selected.push(bounds)})});
    fixture.syncFields();const field=fixture.fields.get('-100,0')!;
    assert.ok(field.visible);assert.ok(field.position.x>100,'the live field appears across the east seam');
    assert.deepEqual(field.userData.mapSelection,{kind:'cell',col:-100,row:0});
    assert.ok(cleared[0].has('-100,0'));
    const projected=view.project(field.position.x*CELL_SIZE,field.position.z*CELL_SIZE,.12);
    assert.deepEqual(fixture.hit(projected.x,projected.y),{kind:'cell',col:-100,row:0});
    fixture.publishViewport();assert.ok((selected[0] as {maxX:number}).maxX>WORLD_W/2,'the live query must include the opposite edge');
    view.target.set(0,0,0);view.span=69;view.azimuth=0;view.setSize(3200,800);view.update();fixture.syncFields();
    const copies=fixture.fieldCopies.get('-100,0')!;assert.ok(copies.length>0,'a wide live viewport can show periodic images');
    const sourceMesh=field.children.find(child=>child instanceof THREE.Mesh) as THREE.Mesh;
    const copyMesh=copies[0].children.find(child=>child instanceof THREE.Mesh) as THREE.Mesh;
    assert.equal(copyMesh.geometry,sourceMesh.geometry);assert.equal(copyMesh.material,sourceMesh.material);
    view.overview();fixture.syncFields();assert.ok(!field.visible&&copies.every(copy=>!copy.visible));
    world.settlements=[];world.map_plots[0].faction='elf';fixture.syncFields();
    assert.equal(fixture.fields.size,0,'overview must not mint detailed models');
    view.focus((-100+.5)*CELL_SIZE,.5*CELL_SIZE,1);fixture.syncFields();
    assert.equal(fixture.fields.get('-100,0')!.userData.faction,'elf','public fields retain culture when the owning town is outside the loaded viewport');
    let disposed=0;sourceMesh.geometry.addEventListener('dispose',()=>disposed++);
    fixture.disposeGroup(field);assert.equal(disposed,0,'removing a live instance must retain the cache asset');
    models.dispose();models.dispose();assert.equal(disposed,1,'scene cache releases the asset exactly once');fieldMarkers.dispose();fieldGeometry.dispose();fieldMaterial.dispose();
});

test('dense live fields keep a fixed model budget, prioritize selected and owned plots, and retain pickable markers',()=>{
    const view=new PreviewCamera(sampleHeight);view.setSize(1200,800);view.target.set(20,0,0);view.span=69;view.update();
    const plots=Array.from({length:2000},(_,index)=>({col:index%40,row:Math.floor(index/40)-25,settlement_id:1,owner_id:index===0?'me':'rival',building_type:'farm',level:1,faction:'roman'}));
    const world={settlements:[],players:[],map_plots:plots},selected={kind:'cell',col:39,row:24};
    const models=new MapSettlementModels(),geometry=new THREE.BoxGeometry(.16,.11,.16),material=new THREE.MeshBasicMaterial(),markers=new THREE.InstancedMesh(geometry,material,FIELD_MARKER_BUDGET);
    let minted=0;const getField=models.getField.bind(models);models.getField=(...args)=>{minted++;return getField(...args);};
    const fixture=Object.create(WorldScene.prototype) as {syncFields():void;hit(x:number,y:number):unknown;fields:Map<string,THREE.Group>;fieldCopies:Map<string,THREE.Group[]>;fieldMarkerSelections:{kind:'cell';col:number;row:number}[]};
    Object.assign(fixture,{view,scene:new THREE.Scene(),settlementModels:models,fields:new Map(),fieldCopies:new Map(),fieldKey:'',fieldMarkers:markers,fieldMarkerSelections:[],entities:new Map(),entityCopies:new Map(),hittable:new Set(),hittableImages:new Map(),pickingRay:new THREE.Raycaster(),occlusion:new Map(),occlusionViewKey:'',landscape:{setConstructionCells:()=>{}},state:()=>({world,playerId:'me',selection:selected})});
    fixture.syncFields();
    assert.equal(fixture.fields.size,FIELD_DETAIL_BUDGET);assert.equal(minted,FIELD_DETAIL_BUDGET,'only visible budgeted fields may mint native compounds');
    assert.ok(fixture.fields.has('39,24'),'selected field must win over nearer rivals');assert.ok(fixture.fields.has('0,-25'),'owned field must win over nearer rivals');
    assert.ok(markers.count>0&&markers.count<=FIELD_MARKER_BUDGET,'undetailed fields must stay visible through bounded instancing');
    const cell=fixture.fieldMarkerSelections[0],point=view.project((cell.col+.5)*CELL_SIZE,(cell.row+.5)*CELL_SIZE,.16);
    assert.deepEqual(fixture.hit(point.x,point.y),cell,'a simple completed field marker still selects its canonical inspector cell');
    fixture.syncFields();assert.equal(minted,FIELD_DETAIL_BUDGET,'stationary frames must reuse models');
    view.target.set(-60,0,-60);view.update();fixture.syncFields();assert.equal(fixture.fields.size,0,'offscreen fields must release model instances');assert.equal(markers.count,0);
    view.overview();fixture.syncFields();assert.equal(fixture.fields.size,0);assert.ok(markers.count>0,'world overview retains lightweight completed-field markers');
    models.dispose();markers.dispose();geometry.dispose();material.dispose();
});

test('public settlement development changes the real cached silhouette without private city buildings',()=>{
    const view=new PreviewCamera(sampleHeight);view.setSize(1000,700);view.focus(64,64,1);
    const models=new MapSettlementModels(),world={settlements:[{id:7,x:64,y:64,owner_id:'rival',faction:'demon',map_development:4}],armies:[],camps:[],buildings:[]};
    const geometry=new THREE.OctahedronGeometry(.12),material=new THREE.MeshBasicMaterial();
    const fixture=Object.create(WorldScene.prototype) as {syncEntities():void;entities:Map<string,{model:THREE.Group;development:number}>};
    Object.assign(fixture,{view,scene:new THREE.Scene(),settlementModels:models,entities:new Map(),entityCopies:new Map(),hittable:new Set(),hittableImages:new Map(),markers:new THREE.InstancedMesh(geometry,material,2048),landscape:{setSettlementCells:()=>{}},state:()=>({world,playerId:'me'}),shadowKey:''});
    fixture.syncEntities();let entity=fixture.entities.get('settlement:7')!;
    assert.equal(entity.development,4);assert.equal(entity.model.children[0].userData.development,4);assert.equal(entity.model.children[0].userData.faction,'demon');
    world.settlements[0].map_development=999;fixture.syncEntities();entity=fixture.entities.get('settlement:7')!;
    assert.equal(entity.development,5);assert.equal(entity.model.children[0].userData.development,5,'public metadata is clamped before becoming a cache key');
    models.dispose();geometry.dispose();material.dispose();
});

test('live minimap footprints repeat without diagonal seam jumps',()=>{
    const corners=[{x:12000,y:-1000},{x:14000,y:-1000},{x:14000,y:1000},{x:12000,y:1000}];
    const footprints=worldMinimapFootprints(corners);assert.equal(footprints.length,9);assert.equal(worldMinimapFootprints(corners,true).length,1);
    assert.ok(footprints.some(points=>points.some(point=>point.x<-12000)));
    for(const points of footprints)for(let index=0;index<4;index++)assert.ok(Math.hypot(points[index].x-points[(index+1)%4].x,points[index].y-points[(index+1)%4].y)<3000);
});

test('compatibility camera and entity picking cross the seam without changing battle bounds',()=>{
    let mode='world';
    const context=Object.create(RenderContext.prototype) as RenderContext;
    Object.assign(context,{w:800,h:500,zoomBase:1,camera:{x:WORLD_W/2+64,y:64,zoom:1},state:()=>({mode,playerId:'me',world:{armies:[],camps:[],settlements:[{id:7,x:-WORLD_W/2+64,y:64,owner_id:'me'}]}})});
    context.constrainMapCamera();assert.equal(context.camera.x,-WORLD_W/2+64);
    const map=new MapRenderer(context);
    assert.deepEqual(map.hit(WORLD_W/2+64,64),{kind:'settlement',id:7});
    assert.equal(map.hit(Infinity,64),null);
    const paths=map as unknown as {routeImages(points:[number,number][]):{x:number;y:number}[]};
    const route=paths.routeImages([[WORLD_W/2-64,64],[-WORLD_W/2+64,64]]);
    assert.equal(Math.abs(route[1].x-route[0].x),128,'fallback route stays short over the seam');
    mode='battle';context.camera.x=14000;context.camera.y=-14000;context.constrainMapCamera();
    assert.equal(context.camera.x,14000);assert.equal(context.camera.y,-14000,'world wrap must not alter battle camera logic');
});
